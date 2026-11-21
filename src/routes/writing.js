// Quy định đăng bài (văn phong, xưng hô, từ cấm...) và AI viết bài theo quy định (Cloudflare Workers AI).
import { HttpError, json, readJson, now } from '../lib/http.js';
import { requireRole, allowedPageIds } from '../lib/auth.js';
import { generate, PROVIDER_LABELS } from '../lib/ai.js';
import { audit } from '../lib/audit.js';

const MAX_RULES = 8000;
export const LENGTHS = { ngan: 'ngắn, khoảng 40 đến 70 từ', vua: 'vừa phải, khoảng 80 đến 150 từ', dai: 'dài, khoảng 180 đến 300 từ' };

export async function getRules(env) {
  const { results } = await env.DB.prepare("SELECT key, value, updated_at, updated_by FROM social_settings WHERE key IN ('post_rules', 'post_contact', 'post_hashtags')").all();
  const by = Object.fromEntries(results.map((r) => [r.key, r]));
  const r = by.post_rules || { value: '', updated_at: null, updated_by: null };
  return { ...r, contact: by.post_contact?.value || '', hashtags: by.post_hashtags?.value || '' };
}

// ---------- Ép bài AI theo quy định (không phụ thuộc AI có nghe lời hay không) ----------
const PHONE = /(?:\+?84|0)(?:[\s.-]?\d){8,10}/g;
const TAG = /#[\p{L}\p{N}_]+/gu;
const EMOJI = /\p{Extended_Pictographic}\uFE0F?/gu;
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^84/, '0');
const foldTag = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
export const parseTags = (s) => [...new Set(String(s || '').match(TAG) || [])].slice(0, 30);

// Đọc giới hạn trong quy định: "tối đa 3 biểu tượng", "2 đến 4 hashtag".
export function ruleLimits(rules) {
  const e = String(rules || '').match(/(?:tối đa|đến|tới)\s+(\d+)\s+biểu tượng/i);
  const e2 = String(rules || '').match(/(\d+)\s*(?:đến|-|tới)\s*\d+\s*biểu tượng/i);
  const h = String(rules || '').match(/(\d+)\s*(?:đến|-|tới)\s*(\d+)\s*hashtag/i);
  return { minEmoji: e2 ? Number(e2[1]) : 0, maxEmoji: e ? Number(e[1]) : null, minTags: h ? Number(h[1]) : 2, maxTags: h ? Number(h[2]) : 4 };
}

// Bỏ số điện thoại, câu liên hệ, hashtag AI tự viết; giới hạn biểu tượng; rồi gắn nguồn, liên hệ và hashtag đúng quy định.
export function enforceStyle(text, { rules = '', contact = '', hashtags = '', source = '', strip = false } = {}) {
  // strip: chỉ lấy phần thân bài (bỏ liên hệ, hashtag AI tự viết); footer riêng từng Trang gắn ở khung soạn.
  if (strip) contact = contact || ' '; // có giá trị để bỏ câu liên hệ AI tự viết
  const allowedPhones = new Set([...(`${rules}\n${contact}`.match(PHONE) || [])].map(digits));
  const lim = ruleLimits(rules);
  const modelTags = parseTags(text);
  const contactWords = /(hotline|liên hệ|điện thoại|zalo|website|trang web|truy cập|inbox|nhắn tin)/i;
  const hasLink = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:vn|com|net)\b)/i;
  let body = String(text || '').replace(/^\s*Nguồn:.*$/gim, '').split('\n').map((line) => {
    let l = line.replace(TAG, '').replace(/[ \t]+$/g, '');
    const sentences = l.split(/(?<=[.!?…])\s+/);
    const keep = sentences.filter((s) => {
      const phones = s.match(PHONE) || [];
      if (phones.some((p) => contact || !allowedPhones.has(digits(p)))) return false; // số bịa, hoặc đã có phần liên hệ chuẩn
      if (contact && contactWords.test(s) && hasLink.test(s)) return false;
      return true;
    });
    return keep.join(' ').replace(/[ \t]+$/g, '');
  }).join('\n');
  // Biểu tượng: không đặt liền nhau, không quá giới hạn; thiếu thì thêm một biểu tượng ở câu mở đầu.
  body = body.replace(/(\p{Extended_Pictographic}\uFE0F?)(?:\s*\p{Extended_Pictographic}\uFE0F?)+/gu, '$1');
  if (lim.maxEmoji !== null) { let n = 0; body = body.replace(EMOJI, (m) => (++n > lim.maxEmoji ? '' : m)); }
  if (lim.minEmoji > 0 && !/\p{Extended_Pictographic}/u.test(body) && body.trim()) body = `🌱 ${body.trimStart()}`;
  body = body.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const allowed = parseTags(hashtags);
  let tags = [];
  if (strip) tags = [];
  else if (allowed.length) {
    const map = new Map(allowed.map((t) => [foldTag(t), t]));
    const farm = allowed.find((t) => foldTag(t) === '#farmbase') || '#FarmBase';
    tags = [farm, ...modelTags.map((t) => map.get(foldTag(t))).filter(Boolean)];
    for (const t of allowed) if (tags.length < lim.minTags) tags.push(t);
    tags = [...new Set(tags)].slice(0, Math.max(lim.maxTags, 1));
  } else if (modelTags.length) tags = modelTags.slice(0, lim.maxTags);
  const tail = [source ? `Nguồn: ${source}` : '', contact.trim()].filter(Boolean).join('\n');
  return [body, tail, tags.join(' ')].filter(Boolean).join('\n\n');
}

// GET /api/rules
export async function readRules(request, env, user) {
  const r = await getRules(env);
  const by = r.updated_by ? await env.DB.prepare('SELECT name, email FROM social_users WHERE id = ?').bind(r.updated_by).first() : null;
  return json({ text: r.value, contact: r.contact, hashtags: r.hashtags, updated_at: r.updated_at, updated_by_name: by ? by.name || by.email : null, can_edit: user.role === 'owner' || user.role === 'manager' });
}

// PUT /api/rules { text }
export async function saveRules(request, env, user) {
  requireRole(user, 'owner', 'manager');
  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length > MAX_RULES) throw new HttpError(400, `Quy định tối đa ${MAX_RULES} ký tự`, 'too_long');
  const contact = typeof body.contact === 'string' ? body.contact.trim().slice(0, 500) : null;
  const hashtags = typeof body.hashtags === 'string' ? parseTags(body.hashtags).join(' ') : null;
  const t = now();
  const put = (key, value) => env.DB.prepare(
    "INSERT INTO social_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at"
  ).bind(key, value, user.id, t);
  await env.DB.batch([put('post_rules', text), ...(contact !== null ? [put('post_contact', contact)] : []), ...(hashtags !== null ? [put('post_hashtags', hashtags)] : [])]);
  await audit(env, request, user.id, 'rules_updated', `${text.length} ký tự`);
  return json({ ok: true, updated_at: t });
}

// ---------- Thiết lập riêng từng Fanpage: lời kêu gọi, hotline, website, hashtag, lưu ý nội dung ----------
const STYLE_FIELDS = { cta: 300, hotline: 200, website: 200, hashtags: 600, note: 1500 };
export async function getPageStyles(env, pageIds) {
  if (!pageIds.length) return {};
  const keys = pageIds.map((id) => `page_style:${id}`);
  const { results } = await env.DB.prepare(`SELECT key, value FROM social_settings WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
  const out = {};
  for (const r of results) { try { out[r.key.slice(11)] = JSON.parse(r.value); } catch { /* bỏ qua */ } }
  return out;
}

// GET /api/styles
export async function listStyles(request, env, user) {
  if (user.role === 'agent') throw new HttpError(403, 'Không có quyền', 'forbidden');
  const ids = await allowedPageIds(env, user);
  const pages = ids.length ? (await env.DB.prepare(`SELECT id, name FROM social_pages WHERE id IN (${ids.map(() => '?').join(',')}) AND status != 'disconnected' ORDER BY name`).bind(...ids).all()).results : [];
  const styles = await getPageStyles(env, pages.map((p) => p.id));
  const r = await getRules(env);
  return json({ global: { contact: r.contact, hashtags: r.hashtags }, pages: pages.map((p) => ({ id: p.id, name: p.name, style: styles[p.id] || {} })), can_edit: user.role === 'owner' || user.role === 'manager' });
}

// PUT /api/styles/:pageId { cta, hotline, website, hashtags, note }
export async function saveStyle(request, env, user, pageId) {
  requireRole(user, 'owner', 'manager');
  if (!(await allowedPageIds(env, user)).includes(String(pageId))) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
  const body = await readJson(request);
  const style = {};
  for (const [k, max] of Object.entries(STYLE_FIELDS)) style[k] = typeof body[k] === 'string' ? body[k].trim().slice(0, max) : '';
  style.hashtags = parseTags(style.hashtags).join(' ');
  if (style.website && !/^https?:\/\//i.test(style.website)) style.website = `https://${style.website}`;
  const t = now();
  await env.DB.prepare("INSERT INTO social_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(`page_style:${pageId}`, JSON.stringify(style), user.id, t).run();
  await audit(env, request, user.id, 'page_style_updated', String(pageId));
  return json({ style });
}

// POST /api/ai/adapt { text, page_id }: chỉnh thân bài cho hợp một Trang (theo lưu ý riêng của Trang đó)
export async function aiAdapt(request, env, user) {
  if (user.role === 'agent') throw new HttpError(403, 'Không có quyền', 'forbidden');
  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 5000) : '';
  const pageId = String(body.page_id || '');
  if (!text) throw new HttpError(400, 'Chưa có nội dung để chỉnh', 'empty');
  if (!(await allowedPageIds(env, user)).includes(pageId)) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
  const page = await env.DB.prepare('SELECT name FROM social_pages WHERE id = ?').bind(pageId).first();
  const style = (await getPageStyles(env, [pageId]))[pageId] || {};
  const st = await getRules(env);
  const prompt = `Chỉnh bài dưới đây cho phù hợp với Fanpage "${page.name}"${style.note ? `, theo lưu ý riêng của Trang: ${style.note}` : ''}. Giữ nguyên ý và thông tin, không thêm số liệu mới, độ dài tương đương. Không viết phần liên hệ, hotline, website, hashtag (hệ thống tự thêm).\n\nBài gốc:\n${text}`;
  const { text: out, provider } = await generate(env, { system: systemPrompt(st.value, [page.name], { bodyOnly: true }), prompt, maxTokens: 1200 });
  const src = text.match(/^\s*Nguồn:\s*(\S+)\s*$/im);
  const res = enforceStyle(tidy(provider === 'fake' ? `${out} [${page.name}]` : out), { rules: st.value, strip: true, source: src ? src[1] : '' });
  if (!res) throw new HttpError(502, 'AI chưa trả về nội dung, vui lòng thử lại', 'ai_empty');
  await audit(env, request, user.id, 'ai_written', `Chỉnh cho Trang: ${page.name}`.slice(0, 80));
  return json({ body: res.slice(0, 5000), provider: PROVIDER_LABELS[provider] });
}

export function systemPrompt(rules, pageNames, style = {}) {
  const lim = ruleLimits(rules);
  const emo = lim.maxEmoji !== null
    ? `Dùng ${lim.minEmoji ? `${lim.minEmoji} đến ` : 'tối đa '}${lim.maxEmoji} biểu tượng cảm xúc phù hợp chủ đề (ví dụ 🌱 🌿 🍈 ☕ ✅ 📌 📲 👉) cho bài sinh động: đặt ở đầu câu mở đầu, trước ý chính hoặc lời kêu gọi; không đặt hai biểu tượng liền nhau, không rải mỗi câu một biểu tượng.`
    : 'Có thể dùng vài biểu tượng cảm xúc phù hợp cho sinh động, không lạm dụng.';
  let tail;
  if (style.bodyOnly) tail = 'Không tự viết số điện thoại, website, hashtag hay câu "liên hệ qua số..."; hệ thống tự thêm phần cuối bài riêng cho từng Trang. Kết bài bằng một câu kêu gọi ngắn không kèm số.';
  else if (style.contact || style.hashtags) tail = `Không tự viết số điện thoại, website hay câu "liên hệ qua số..." vì hệ thống tự thêm phần liên hệ chuẩn ở cuối bài${style.contact ? ` (${style.contact})` : ''}. Kết bài bằng một câu kêu gọi ngắn không kèm số.${style.hashtags ? ` Dòng cuối ghi 2 đến 4 hashtag chọn trong danh sách: ${style.hashtags}.` : ''}`;
  else tail = 'Không tự bịa số điện thoại hay địa chỉ website.';
  return [
    'Bạn là người viết nội dung Fanpage Facebook cho doanh nghiệp Việt Nam.',
    'Viết bằng tiếng Việt có dấu, tự nhiên, đúng chính tả. Chỉ trả về đúng nội dung bài đăng, không giải thích, không tiêu đề kiểu Markdown, không dùng ** hay #.',
    'Không bịa số liệu, giá, ngày tháng, tên người hoặc cam kết không có trong ý chính. Thiếu thông tin thì viết chung, không tự thêm.',
    emo,
    pageNames.length ? `Bài sẽ đăng trên Fanpage: ${pageNames.join(', ')}.` : '',
    rules ? `QUY ĐỊNH ĐĂNG BÀI CỦA DOANH NGHIỆP (bắt buộc tuân theo, ưu tiên cao nhất):\n${rules}` : '',
    style.note ? `LƯU Ý RIÊNG CỦA FANPAGE (áp dụng cho bài này): ${style.note}` : '',
    tail,
  ].filter(Boolean).join('\n\n');
}

// Bỏ dấu Markdown còn sót, giữ xuống dòng.
export const tidy = (s) => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^["“](.*)["”]$/s, '$1').trim();

// POST /api/ai/write { brief, current?, length?, page_ids? }
export async function aiWrite(request, env, user) {
  if (user.role === 'agent') throw new HttpError(403, 'Tài khoản Chăm sóc khách hàng không dùng được AI viết bài', 'forbidden');
  const body = await readJson(request);
  const brief = typeof body.brief === 'string' ? body.brief.trim().slice(0, 2000) : '';
  const current = typeof body.current === 'string' ? body.current.trim().slice(0, 5000) : '';
  if (!brief && !current) throw new HttpError(400, 'Vui lòng nhập ý chính cần viết', 'empty');
  const length = LENGTHS[body.length] || LENGTHS.vua;

  let pageNames = [];
  let note = '';
  if (Array.isArray(body.page_ids) && body.page_ids.length) {
    const allowed = await allowedPageIds(env, user);
    const ids = body.page_ids.map(String).filter((p) => allowed.includes(p)).slice(0, 20);
    if (ids.length) {
      const { results } = await env.DB.prepare(`SELECT name FROM social_pages WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
      pageNames = results.map((r) => r.name);
      if (ids.length === 1) note = (await getPageStyles(env, ids))[ids[0]]?.note || '';
    }
  }
  const st = await getRules(env);
  const rules = st.value;
  const task = current
    ? `Viết lại bài dưới đây cho hay hơn, độ dài ${length}.${brief ? `\nYêu cầu thêm: ${brief}` : ''}\n\nBài hiện tại:\n${current}`
    : `Viết một bài đăng Facebook, độ dài ${length}, từ ý chính sau:\n${brief}`;

  const bodyOnly = body.body_only === true;
  let { text, provider } = await generate(env, { system: systemPrompt(rules, pageNames, bodyOnly ? { bodyOnly: true, note } : { ...st, note }), prompt: task, maxTokens: 1200 });
  if (provider === 'fake' && rules) text += ' [theo quy định]'; // chỉ dùng khi chạy thử trên máy
  const raw = tidy(text);
  const bodyText = enforceStyle(raw, { rules, strip: true }).slice(0, 5000);
  text = enforceStyle(raw, { rules, contact: st.contact, hashtags: st.hashtags }).slice(0, 5000);
  if (!text) throw new HttpError(502, 'AI chưa trả về nội dung, vui lòng thử lại', 'ai_empty');
  await audit(env, request, user.id, 'ai_written', brief.slice(0, 80) || '(viết lại)');
  return json({ text, body: bodyText, provider: PROVIDER_LABELS[provider] });
}
