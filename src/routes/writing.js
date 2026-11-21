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
export function enforceStyle(text, { rules = '', contact = '', hashtags = '', source = '' } = {}) {
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
  if (allowed.length) {
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

export function systemPrompt(rules, pageNames, style = {}) {
  const auto = style.contact || style.hashtags;
  const lim = ruleLimits(rules);
  const emo = lim.maxEmoji !== null
    ? `Dùng ${lim.minEmoji ? `${lim.minEmoji} đến ` : 'tối đa '}${lim.maxEmoji} biểu tượng cảm xúc phù hợp chủ đề (ví dụ 🌱 🌿 🍈 ☕ ✅ 📌 📲 👉) cho bài sinh động: đặt ở đầu câu mở đầu, trước ý chính hoặc lời kêu gọi; không đặt hai biểu tượng liền nhau, không rải mỗi câu một biểu tượng.`
    : 'Có thể dùng vài biểu tượng cảm xúc phù hợp cho sinh động, không lạm dụng.';
  return [
    'Bạn là người viết nội dung Fanpage Facebook cho doanh nghiệp Việt Nam.',
    'Viết bằng tiếng Việt có dấu, tự nhiên, đúng chính tả. Chỉ trả về đúng nội dung bài đăng, không giải thích, không tiêu đề kiểu Markdown, không dùng ** hay #.',
    'Không bịa số liệu, giá, ngày tháng, tên người hoặc cam kết không có trong ý chính. Thiếu thông tin thì viết chung, không tự thêm.',
    emo,
    pageNames.length ? `Bài sẽ đăng trên Fanpage: ${pageNames.join(', ')}.` : '',
    rules ? `QUY ĐỊNH ĐĂNG BÀI CỦA DOANH NGHIỆP (bắt buộc tuân theo, ưu tiên cao nhất):\n${rules}` : '',
    auto ? `Không tự viết số điện thoại, website hay câu "liên hệ qua số..." vì hệ thống tự thêm phần liên hệ chuẩn ở cuối bài${style.contact ? ` (${style.contact})` : ''}. Kết bài bằng một câu kêu gọi ngắn không kèm số.${style.hashtags ? ` Dòng cuối ghi 2 đến 4 hashtag chọn trong danh sách: ${style.hashtags}.` : ''}` : 'Không tự bịa số điện thoại hay địa chỉ website.',
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
  if (Array.isArray(body.page_ids) && body.page_ids.length) {
    const allowed = await allowedPageIds(env, user);
    const ids = body.page_ids.map(String).filter((p) => allowed.includes(p)).slice(0, 20);
    if (ids.length) {
      const { results } = await env.DB.prepare(`SELECT name FROM social_pages WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
      pageNames = results.map((r) => r.name);
    }
  }
  const st = await getRules(env);
  const rules = st.value;
  const task = current
    ? `Viết lại bài dưới đây cho hay hơn, độ dài ${length}.${brief ? `\nYêu cầu thêm: ${brief}` : ''}\n\nBài hiện tại:\n${current}`
    : `Viết một bài đăng Facebook, độ dài ${length}, từ ý chính sau:\n${brief}`;

  let { text, provider } = await generate(env, { system: systemPrompt(rules, pageNames, st), prompt: task, maxTokens: 1200 });
  if (provider === 'fake' && rules) text += ' [theo quy định]'; // chỉ dùng khi chạy thử trên máy
  text = enforceStyle(tidy(text), { rules, contact: st.contact, hashtags: st.hashtags }).slice(0, 5000);
  if (!text) throw new HttpError(502, 'AI chưa trả về nội dung, vui lòng thử lại', 'ai_empty');
  await audit(env, request, user.id, 'ai_written', brief.slice(0, 80) || '(viết lại)');
  return json({ text, provider: PROVIDER_LABELS[provider] });
}
