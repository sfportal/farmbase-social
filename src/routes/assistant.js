// Trợ lý nội dung hằng ngày (chạy 7h00 sáng giờ Việt Nam bằng Cron Trigger, hoặc bấm "Chạy ngay"):
//  1. Đọc tin mới từ các nguồn tin, tóm tắt những tin liên quan chủ đề vào kho kiến thức (Claude Haiku).
//  2. Lập kế hoạch tuần cho từng Fanpage nếu chưa có (Claude Sonnet, một lần mỗi tuần).
//  3. Soạn 1–2 bài cho ngày mai theo kế hoạch, tự kiểm tra (quy tắc cứng + Claude Haiku), ghi lý do,
//     rồi để ở trạng thái "Chờ duyệt" kèm giờ hẹn. Không bài nào lên Fanpage khi chưa được người dùng duyệt.
//  4. Thứ Hai: đề xuất cập nhật chủ đề từ tin tức, tài liệu và góp ý.
import { HttpError, json, readJson, now } from '../lib/http.js';
import { allowedPageIds, requireRole } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { generate, parseJson, aiProvider, PROVIDER_LABELS, PRICES, claudeModels, MODEL_CHOICES, costPerPost } from '../lib/ai.js';
import { getRules, getPageStyles, enforceStyle, tidy, ruleLimits } from './writing.js';
import { loadTopics, getBrief } from './topics.js';
import { fetchText, parseFeed, parseWp, parseNews } from './sources.js';
import { pageEngagement, cachedEngagement } from './engagement.js';
import { PROMPT_LIB } from '../lib/prompt-lib.js';

const VN = 7 * 3600;
const DAY = 86400;
const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const DEFAULT_TIMES = ['19:30', '11:30'];

// ---------- Ngày giờ Việt Nam ----------
export const vnDate = (ts) => new Date((ts + VN) * 1000).toISOString().slice(0, 10);
export function weekStart(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7; // thứ Hai = 0
  return new Date(d.getTime() - wd * DAY * 1000).toISOString().slice(0, 10);
}
export const addDays = (date, n) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY * 1000).toISOString().slice(0, 10);
export function tsAt(date, hhmm) {
  const [h, m] = String(hhmm || '19:30').split(':').map(Number);
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) + (h || 0) * 3600 + (m || 0) * 60 - VN;
}
const weekday = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t; };

// ---------- Cài đặt ----------
async function getSetting(env, key, fallback) {
  const r = await env.DB.prepare('SELECT value FROM social_settings WHERE key = ?').bind(key).first();
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
}
async function putSetting(env, key, value, userId = null) {
  await env.DB.prepare('INSERT INTO social_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify(value), userId, now()).run();
}
function pageCfg(settings, pageId, hasTopics) {
  const c = settings.pages?.[pageId] || {};
  const per = [1, 2].includes(c.per_day) ? c.per_day : 1;
  const times = Array.isArray(c.times) && c.times.length ? c.times.filter((t) => /^\d{2}:\d{2}$/.test(t)).slice(0, 2) : DEFAULT_TIMES;
  // options: số phương án cho mỗi chỗ đăng (mặc định 2 để Quý khách chọn); share: thêm 1 bài chia sẻ tin báo mỗi ngày.
  return { on: c.on === undefined ? hasTopics : !!c.on, per_day: per, times: times.length ? times : DEFAULT_TIMES, website: c.website !== false, options: c.options === 1 ? 1 : 2, share: c.share !== false };
}

// ---------- Ngữ cảnh gọn cho AI (tiết kiệm token: chỉ chủ đề con đang bật, tóm tắt kiến thức, tiêu đề bài gần đây) ----------
async function pageContext(env, page) {
  const eng = await cachedEngagement(env, page.id);
  const [topics, brief, know, recent] = await Promise.all([
    loadTopics(env, page.id),
    getBrief(env, page.id),
    // Tài liệu (doc) luôn dùng, không giới hạn ngày; tin tức và góp ý lấy 30 ngày gần nhất.
    env.DB.prepare("SELECT kind, title, digest, url FROM social_knowledge WHERE (page_id = ? OR page_id IS NULL) AND (kind = 'doc' OR created_at >= ?) ORDER BY (kind = 'doc') DESC, created_at DESC LIMIT 20").bind(page.id, now() - 30 * DAY).all(),
    env.DB.prepare("SELECT message, topic_id FROM social_content WHERE page_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 10").bind(page.id, now() - 21 * DAY).all(),
  ]);
  const subs = [];
  const lines = [];
  for (const t of topics) {
    if (t.status === 'paused') continue;
    const kids = t.children.filter((c) => c.status !== 'paused');
    if (!kids.length) continue;
    lines.push(`# ${t.title}${t.share ? ` (${t.share}% số bài)` : ''}${t.goal ? `: ${cut(t.goal, 120)}` : ''}`);
    for (const c of kids) {
      subs.push({ ...c, parent_title: t.title, share: t.share || 0 });
      lines.push(`- (id ${c.id}) ${c.title} | mục tiêu: ${cut(c.goal, 100)} | hook: ${cut(c.hook.split('\n')[0], 110)} | thông điệp: ${cut(c.message, 200)} | CTA: ${cut(c.cta, 100)} | dữ kiện: ${cut(c.facts.replace(/\n/g, '; '), 450)} | định dạng: ${cut(c.formats, 80)} | prompt: ${c.prompt_ids || '-'}`);
    }
  }
  const docs = know.results.filter((k) => k.kind !== 'feedback').slice(0, 12).map((k) => `- [${k.kind === 'news' ? 'Tin' : 'Tài liệu'}] ${cut(k.title, 90)}: ${cut(k.digest, k.kind === 'doc' ? 700 : 260)}${k.url ? ` (Nguồn: ${k.url})` : ''}`);
  const fb = know.results.filter((k) => k.kind === 'feedback').slice(0, 6).map((k) => `- ${cut(k.digest || k.title, 200)}`);
  const rec = recent.results.map((r) => `- ${cut(r.message.split('\n')[0], 90)}`);
  const text = [
    `HỒ SƠ FANPAGE "${page.name}":\n${brief || '(chưa có)'}`,
    `CHỦ ĐỀ VÀ CHỦ ĐỀ CON (chỉ viết theo các chủ đề con này, ghi đúng id):\n${lines.join('\n') || '(chưa có)'}`,
    docs.length ? `KIẾN THỨC MỚI (chỉ dùng dữ kiện có ở đây hoặc trong "dữ kiện" của chủ đề):\n${docs.join('\n')}` : '',
    fb.length ? `GÓP Ý CỦA NGƯỜI DUYỆT (làm theo):\n${fb.join('\n')}` : '',
    rec.length ? `BÀI ĐÃ CÓ GẦN ĐÂY (tránh lặp lại góc viết):\n${rec.join('\n')}` : '',
    eng?.text ? `${eng.text}\n(Học từ số liệu này: ưu tiên góc viết, định dạng của bài tương tác cao; giảm kiểu bài tương tác thấp; vẫn giữ tỷ trọng chủ đề.)` : '',
  ].filter(Boolean).join('\n\n');
  return { text, subs, topics };
}

function assistantSystem(rules, page, note) {
  const lim = ruleLimits(rules);
  return [
    'Bạn là trợ lý biên tập nội dung Fanpage nông nghiệp tại Đắk Lắk. Viết tiếng Việt có dấu, rõ ràng, thực tế, gần gũi với bà con, chuyên nghiệp với doanh nghiệp.',
    'Mỗi bài phải có: câu móc (hook) cụ thể ở dòng đầu, một thông điệp rõ theo chủ đề con, và một câu kêu gọi hành động theo CTA của chủ đề (không kèm số điện thoại, website).',
    'Chỉ dùng dữ kiện có trong hồ sơ Fanpage, dữ kiện chủ đề và kiến thức được cung cấp. Không bịa số liệu, ngày, tên người, giá, cam kết. Thiếu dữ kiện thì viết chung, không tự thêm. Tránh câu sáo rỗng, chung chung.',
    'Không nêu số nông hộ, diện tích (ha), số vùng trồng mà FarmBase hoặc BVI đã triển khai, trừ khi góp ý của người duyệt yêu cầu. Không nhắc CCCD, sổ đỏ, giấy tờ đất hay dữ liệu cá nhân của bà con, khách hàng. Tránh nội dung pháp lý như ủy quyền, tranh chấp đất, thủ tục pháp lý về mã số vùng trồng.',
    `Đoạn văn ngắn: mỗi đoạn tối đa 2 câu, các đoạn cách nhau một dòng trống. ${lim.maxEmoji !== null ? `Dùng ${lim.minEmoji ? `${lim.minEmoji} đến ` : 'tối đa '}${lim.maxEmoji} biểu tượng cảm xúc, không đặt liền nhau.` : 'Biểu tượng cảm xúc tiết chế.'}`,
    'Không viết số điện thoại, website, hashtag trong thân bài: hệ thống tự thêm phần cuối bài. Không dùng Markdown (**, #).',
    rules ? `QUY ĐỊNH ĐĂNG BÀI CỦA DOANH NGHIỆP (bắt buộc):\n${rules}` : '',
    note ? `LƯU Ý RIÊNG CỦA FANPAGE "${page.name}": ${note}` : '',
    'Khi được yêu cầu trả JSON: chỉ trả đúng một đối tượng JSON hợp lệ, không giải thích thêm.',
  ].filter(Boolean).join('\n\n');
}

// Thư viện prompt: mẫu có sẵn (public/prompt) và mẫu bổ sung Quý khách đã duyệt (social_settings 'prompt_extra').
export async function promptLibrary(env) {
  const extra = await getSetting(env, 'prompt_extra', []);
  const out = { ...PROMPT_LIB };
  for (const x of Array.isArray(extra) ? extra : []) if (x?.id && x.text) out[x.id] = { n: x.name, k: x.kind, t: x.text };
  return out;
}

// ---------- Kiểm tra cứng theo quy tắc nội dung (không tốn token) ----------
export function ruleCheck(text, { campaign = false, stats = false } = {}) {
  const issues = [];
  const t = String(text || '');
  if (/(BVI|FarmBase|chúng tôi|hệ thống|ứng dụng|app)[^.!?\n]{0,40}cấp mã/i.test(t) && !/thẩm quyền/i.test(t)) issues.push('Có ý BVI, FarmBase hoặc ứng dụng "cấp mã" (việc cấp mã thuộc thẩm quyền cơ quan nhà nước)');
  if (/durian\s*base/i.test(t)) issues.push('Dùng tên DurianBase (chỉ dùng FarmBase)');
  if (/100\s?%\s*(nông hộ|hộ|bà con)/i.test(t)) issues.push('Có câu "100% nông hộ"');
  if (/\b(số 1|duy nhất|hàng đầu)\b/i.test(t)) issues.push('Dùng từ tuyệt đối "số 1", "duy nhất", "hàng đầu"');
  if (/(chắc chắn|cam kết|bảo đảm|đảm bảo|bao đậu)[^.!?\n]{0,25}(cấp mã|đầu ra|tăng giá|tăng năng suất|GACC)/i.test(t)) issues.push('Có lời hứa cấp mã, đầu ra, tăng giá hoặc năng suất');
  if (/~?\s?2\.000\s*(nông hộ|hộ)/i.test(t)) issues.push('Dùng số ~2.000 nông hộ (đúng là trên 1.500 nông hộ)');
  // Không nêu số hộ, diện tích, số vùng FarmBase đã triển khai (trừ khi người duyệt yêu cầu). Fanpage chiến dịch được nêu mục tiêu 10.000 ha, 20.000 bà con.
  if (!stats) {
    const hits = [...t.matchAll(/(\d[\d.,]*)\s*(nông hộ|hộ dân|hộ|ha|hecta|héc-ta|vùng trồng|vùng)(?!\p{L})/giu)]
      .filter((m) => !/^(10|20)\.?000$/.test(m[1])); // 10.000 ha, 20.000 bà con là mục tiêu Chiến dịch, không phải số đã triển khai
    if (hits.length) issues.push(`Nêu số hộ, diện tích hoặc số vùng đã triển khai (${hits.slice(0, 3).map((m) => m[0]).join(', ')}): chỉ nêu khi được yêu cầu`);
  }
  if (/(CCCD|căn cước|chứng minh (nhân dân|thư)|sổ đỏ|sổ hồng|giấy chứng nhận quyền sử dụng đất)/i.test(t)) issues.push('Nhắc tới giấy tờ cá nhân (CCCD, sổ đỏ): hạn chế trong bài đăng');
  if (/(ủy|uỷ)\s*quyền/i.test(t)) issues.push('Nhắc tới "ủy quyền" (nội dung pháp lý): tránh trong bài đăng');
  if (campaign) {
    if (/(8,2\s*tỷ|\d+\s*(tỷ|triệu)\s*(đồng)?|gói\s*(vàng|bạc|đồng|kim cương|bạch kim))/i.test(t)) issues.push('Có chi phí, gói tài trợ (không công khai trên Fanpage)');
    if (/(đã|vừa)\s*(đạt|hoàn thành|số hóa)[^.!?\n]{0,20}10\.000/i.test(t)) issues.push('Viết mục tiêu 10.000 ha như kết quả đã đạt');
  }
  if (t.length > 2200) issues.push('Bài quá dài (trên 2.200 ký tự)');
  return issues;
}

function footerFor(st, style) {
  const has = style.cta || style.hotline || style.website || style.hashtags;
  if (!has) return null;
  const contact = [style.cta, style.hotline, style.website ? `Website: ${style.website}` : ''].filter(Boolean).join('\n');
  return [contact, style.hashtags].filter(Boolean).join('\n\n');
}
function compose(st, style, body, source = '') {
  const clean = enforceStyle(body, { rules: st.value, strip: true, source });
  const foot = footerFor(st, style);
  if (foot) return [clean, foot].filter(Boolean).join('\n\n').slice(0, 4800);
  return enforceStyle(body, { rules: st.value, contact: st.contact, hashtags: st.hashtags, source }).slice(0, 4800);
}

// Tự kiểm tra một bài: quy tắc cứng trước, rồi Claude Haiku đối chiếu dữ kiện và quy định (rẻ). Lỗi thì nhận bản sửa.
async function selfCheck(env, { body, sub, st, campaign, stats = false }) {
  let text = body;
  let issues = ruleCheck(text, { campaign, stats });
  let by = 'Quy tắc nội dung';
  if (aiProvider(env) && aiProvider(env) !== 'workers') {
    try {
      const { text: out } = await generate(env, {
        tier: 'fast', maxTokens: 2500,
        system: 'Bạn là người kiểm duyệt bài đăng Fanpage. Đối chiếu bài với quy định và dữ kiện được phép dùng. Chỉ báo lỗi thật: bịa số liệu hoặc dữ kiện không có trong danh sách, sai quy định, thiếu hook hoặc CTA, câu sáo rỗng vô nghĩa, đoạn dài quá 2 câu. Trả JSON.',
        prompt: `[VIEC:check] QUY ĐỊNH:\n${cut(st.value, 2500)}\n\nDỮ KIỆN ĐƯỢC PHÉP DÙNG:\n${cut(sub?.facts || '', 1200)}\n\nCTA CỦA CHỦ ĐỀ: ${sub?.cta || '-'}\n\nLỖI ĐÃ PHÁT HIỆN BẰNG QUY TẮC: ${issues.join('; ') || 'không'}\n\nBÀI CẦN KIỂM TRA:\n${text}\n\nTrả JSON {"ok": true|false, "issues": ["lỗi ngắn gọn"], "fixed": "thân bài đã sửa nếu có lỗi, để trống nếu ok"}`,
      });
      const r = parseJson(out) || {};
      by = 'Quy tắc nội dung và Claude Haiku';
      if (Array.isArray(r.issues)) issues = [...new Set([...issues, ...r.issues.map((x) => cut(x, 160)).filter(Boolean)])].slice(0, 8);
      if (r.ok === false && typeof r.fixed === 'string' && r.fixed.trim().length > 40) {
        const fixed = tidy(r.fixed);
        const left = ruleCheck(fixed, { campaign, stats });
        if (left.length < ruleCheck(text, { campaign, stats }).length || !left.length) return { text: fixed, check: { ok: !left.length, issues, fixed: true, remaining: left, by } };
      }
      if (r.ok === true && !ruleCheck(text, { campaign, stats }).length) return { text, check: { ok: true, issues: [], by } };
    } catch (e) { console.error('check', e?.message); }
  }
  return { text, check: { ok: !issues.length, issues, by } };
}

// ---------- 1. Đọc tin mới vào kho kiến thức ----------
export async function learnNews(env, log = []) {
  if (!aiProvider(env)) return log;
  const { results: sources } = await env.DB.prepare("SELECT * FROM social_sources WHERE kind = 'website' ORDER BY (feed_type = 'news') DESC, created_at DESC LIMIT 4").all();
  if (!sources.length) return log;
  const { results: topicRows } = await env.DB.prepare("SELECT page_id, keywords FROM social_topics WHERE keywords != '' AND status = 'active'").all();
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const kwByPage = {};
  for (const r of topicRows) for (const k of r.keywords.split(',').map((x) => fold(x).trim()).filter((x) => x.length > 2)) (kwByPage[r.page_id] ||= new Set()).add(k);
  const since = now() - 4 * DAY;
  const items = [];
  for (const s of sources) {
    try {
      const r = await fetchText(s.feed_url, s.feed_type === 'wp' ? 'application/json' : 'application/rss+xml,application/xml,*/*');
      const list = s.feed_type === 'wp' ? parseWp(JSON.parse(r.text)) : s.feed_type === 'news' ? parseNews(r.text) : parseFeed(r.text);
      for (const it of list.slice(0, 15)) if (!it.date || it.date >= since) items.push({ ...it, source: s.name });
    } catch (e) { log.push(`Không đọc được nguồn "${s.name}": ${cut(e.message, 80)}`); }
  }
  if (!items.length) return log;
  // Bỏ tin đã có trong kho, chấm điểm theo từ khóa của chủ đề.
  const urls = [...new Set(items.map((i) => i.url))];
  const seen = new Set();
  for (let i = 0; i < urls.length; i += 50) {
    const part = urls.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT url FROM social_knowledge WHERE url IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const r of results) seen.add(r.url);
  }
  const fresh = [];
  for (const it of items) {
    if (seen.has(it.url) || fresh.some((f) => f.url === it.url)) continue;
    const text = fold(`${it.title} ${it.summary}`);
    let best = null; let score = 0;
    for (const [pid, kws] of Object.entries(kwByPage)) {
      const n = [...kws].filter((k) => text.includes(k)).length;
      if (n > score) { score = n; best = pid; }
    }
    if (score > 0) fresh.push({ ...it, page_id: best, score });
  }
  fresh.sort((a, b) => b.score - a.score || (b.date || 0) - (a.date || 0));
  const pick = fresh.slice(0, 6);
  if (!pick.length) { log.push('Không có tin mới khớp từ khóa chủ đề'); return log; }
  const digestReq = (tier) => generate(env, {
    tier, maxTokens: 2000,
    system: 'Bạn đọc tin tức nông nghiệp cho người viết Fanpage FarmBase và Chiến dịch 10.000 ha (Đắk Lắk). Tóm tắt dữ kiện cụ thể dùng được (ai, làm gì, ở đâu, khi nào, số liệu). Không thêm ý ngoài tin. Tiếng Việt có dấu.',
    prompt: `[VIEC:digest] Với mỗi tin, viết tóm tắt 1–2 câu và cho biết có liên quan đến mã số vùng trồng, truy xuất, sầu riêng, cà phê, HTX, xuất khẩu nông sản Tây Nguyên không. Trả JSON {"items":[{"n":1,"digest":"...","relevant":true}]}\n\n${pick.map((it, i) => `[TIN ${i + 1}] ${cut(it.title, 160)} — ${cut(it.summary, 320)} — ${it.publisher || it.source}`).join('\n')}`,
  });
  // Workers AI miễn phí đọc trước; trả sai định dạng thì nhờ Claude Haiku đọc lại.
  let r = await digestReq('cheap').catch(() => null);
  let out = parseJson(r?.text)?.items;
  if (!Array.isArray(out) && r?.provider === 'workers') { r = await digestReq('fast'); out = parseJson(r.text)?.items; }
  out = Array.isArray(out) ? out : [];
  const t = now();
  const stmts = [];
  for (const o of out) {
    const it = pick[Number(o.n) - 1];
    if (!it || o.relevant === false || !o.digest) continue;
    stmts.push(env.DB.prepare("INSERT INTO social_knowledge (page_id, kind, title, body, digest, url, created_at) VALUES (?, 'news', ?, ?, ?, ?, ?)")
      .bind(it.page_id || null, cut(it.title, 200), cut(`${it.summary}${it.publisher || it.source ? `\nNguồn: ${it.publisher || it.source}` : ''}`, 1500), cut(o.digest, 600), it.url, t));
  }
  if (stmts.length) await env.DB.batch(stmts);
  log.push(`Đã đọc ${items.length} tin, lưu ${stmts.length} tin liên quan vào kho kiến thức (${r?.provider === 'workers' ? 'Workers AI' : 'Claude Haiku'})`);
  return log;
}

// ---------- 2. Kế hoạch tuần ----------
export async function makePlan(env, page, ws, cfg, { feedback = '' } = {}) {
  const st = await getRules(env);
  const style = (await getPageStyles(env, [page.id]))[page.id] || {};
  const ctx = await pageContext(env, page);
  if (!ctx.subs.length) throw new HttpError(400, `Fanpage "${page.name}" chưa có chủ đề con`, 'no_topics');
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const prev = await env.DB.prepare('SELECT body FROM social_plans WHERE page_id = ? AND week_start = ?').bind(page.id, ws).first();
  const prompt = `[VIEC:plan] Lập kế hoạch nội dung Facebook tuần ${ws} đến ${days[6]} cho Fanpage "${page.name}", mỗi ngày ${cfg.per_day} bài, giờ đăng gợi ý ${cfg.times.slice(0, cfg.per_day).join(' và ')}.
Phân bổ theo tỷ trọng chủ đề, xen kẽ định dạng (ảnh, carousel, video ngắn), ngày đầu tuần ưu tiên bài kiến thức, cuối tuần ưu tiên câu chuyện, hình ảnh thật. Bám mùa vụ hiện tại và tin tức mới nếu có.
${days.map((d) => `NGAY ${d} (${weekday(d)})`).join('\n')}
${feedback ? `\nGÓP Ý CỦA NGƯỜI DUYỆT CHO KẾ HOẠCH (bắt buộc làm theo): ${feedback}\n` : ''}${prev && feedback ? `\nKẾ HOẠCH CŨ:\n${cut(prev.body, 2500)}\n` : ''}
Trả JSON {"focus":"định hướng tuần 1–2 câu: muốn đạt gì","note":"điều có thể thay đổi theo dữ liệu hoặc tin tức","website":[{"title":"tiêu đề bài website gợi ý (dưới 60 ký tự)","outline":"dàn ý 3–5 ý","topic_id":0}],"days":[{"date":"YYYY-MM-DD","posts":[{"topic_id":0,"angle":"góc bài cụ thể","format":"định dạng","visual":"hình ảnh/video cần thiết kế","prompt_id":"mã prompt của chủ đề","time":"HH:MM","why":"vì sao bài này vào ngày này"}]}]}`;
  const { text, provider } = await generate(env, { tier: 'write', maxTokens: 6000, system: `${assistantSystem(st.value, page, style.note)}\n\n${ctx.text}`, prompt });
  const plan = parseJson(text);
  if (!plan || !Array.isArray(plan.days)) throw new HttpError(502, 'AI chưa trả về kế hoạch hợp lệ, vui lòng thử lại', 'ai_bad');
  const valid = new Set(ctx.subs.map((s) => s.id));
  plan.days = days.map((d) => {
    const day = plan.days.find((x) => x.date === d) || { date: d, posts: [] };
    const posts = (Array.isArray(day.posts) ? day.posts : []).slice(0, cfg.per_day).map((p, i) => ({
      topic_id: valid.has(Number(p.topic_id)) ? Number(p.topic_id) : ctx.subs[(days.indexOf(d) + i) % ctx.subs.length].id,
      angle: cut(p.angle, 300), format: cut(p.format, 100), visual: cut(p.visual, 300), prompt_id: /^[a-z]{2}-\d{2}$/.test(p.prompt_id || '') ? p.prompt_id : '',
      time: /^\d{2}:\d{2}$/.test(p.time || '') ? p.time : cfg.times[i] || DEFAULT_TIMES[0], why: cut(p.why, 300),
    })).map((p) => ({ ...p, topic_title: ctx.subs.find((s) => s.id === p.topic_id)?.title || '' }));
    return { date: d, weekday: weekday(d), posts };
  });
  plan.focus = cut(plan.focus, 400); plan.note = cut(plan.note, 400);
  plan.website = cfg.website && Array.isArray(plan.website) ? plan.website.slice(0, 2).map((w) => ({ title: cut(w.title, 90), outline: cut(w.outline, 600), topic_id: valid.has(Number(w.topic_id)) ? Number(w.topic_id) : null })) : [];
  plan.provider = PROVIDER_LABELS[provider];
  plan.feedback = feedback || undefined;
  const t = now();
  await env.DB.prepare('INSERT INTO social_plans (page_id, week_start, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(page_id, week_start) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at')
    .bind(page.id, ws, JSON.stringify(plan), t, t).run();
  return plan;
}

async function loadPlan(env, pageId, ws) {
  const r = await env.DB.prepare('SELECT body, updated_at FROM social_plans WHERE page_id = ? AND week_start = ?').bind(pageId, ws).first();
  if (!r) return null;
  return { ...(parseJson(r.body) || {}), week_start: ws, updated_at: r.updated_at };
}

// Hướng dẫn viết prompt hình ảnh, video thật chi tiết (Quý khách dán thẳng vào Claude hoặc công cụ tạo hình).
const MEDIA_GUIDE = `CÁCH VIẾT "media_prompt" (chi tiết, chuyên nghiệp, dán thẳng vào công cụ tạo hình; tiếng Việt, 150–320 chữ), theo đúng 8 mục, mỗi mục một dòng:
1. Mục đích và khổ: loại (ảnh đơn, carousel, video ngắn), khổ 4:5 hoặc 1:1 hoặc 9:16, độ phân giải 1080 px.
2. Chủ thể và bối cảnh: cảnh cụ thể tại Đắk Lắk (vườn sầu riêng, cà phê, nhà sơ chế, điện thoại quét QR...), thời điểm, cảm xúc.
3. Bố cục: tiền cảnh, trung cảnh, hậu cảnh; vị trí chữ (vùng an toàn 10% mép); điểm nhìn chính.
4. Chữ trên hình (tiếng Việt có dấu, ghi trong ngoặc kép): tiêu đề tối đa 8 chữ, 1 dòng phụ, nhãn hoặc nút CTA; không ghi số điện thoại.
5. Màu và kiểu chữ: xanh FarmBase #084C46, xanh lá tươi #2E9E5B, vàng nhấn #F2B705, nền sáng; font không chân đậm cho tiêu đề.
6. Phong cách, ánh sáng, chất liệu: ví dụ ảnh chụp thật ánh nắng sớm, ống kính 35 mm, chiều sâu trường ảnh nông; hoặc minh họa phẳng 3D nhẹ; hoặc mockup điện thoại.
7. Hiệu ứng: hiệu ứng thiết kế trong mẫu thư viện (parallax, glassmorphism, đường dẫn hành trình, nhãn nổi, ánh sáng viền...) phù hợp nội dung.
8. Tránh: khuôn mặt người thật nhận diện được, giấy tờ cá nhân, số điện thoại, logo cơ quan nhà nước, chữ sai chính tả, hình méo.
Video thì "storyboard" gồm 5–8 cảnh, mỗi dòng: "0–2s | hình ảnh và chuyển động máy | chữ trên màn hình | lời đọc | chuyển cảnh, âm thanh". Thêm dòng cuối: nhạc nền, giọng đọc, tổng thời lượng.`;

async function draftContext(env, page, date, cfg) {
  const ws = weekStart(date);
  let plan = await loadPlan(env, page.id, ws);
  let planned = false;
  if (!plan) { plan = await makePlan(env, page, ws, cfg); planned = true; }
  const [st, styles, ctx, lib] = await Promise.all([getRules(env), getPageStyles(env, [page.id]), pageContext(env, page), promptLibrary(env)]);
  return { plan, planned, st, style: styles[page.id] || {}, ctx, lib, campaign: /10\.?000/.test(page.name), byId: Object.fromEntries(ctx.subs.map((s) => [s.id, s])) };
}

async function insertDraft(env, page, { message, at, topicId, meta, link = null }) {
  const t = now();
  const row = await env.DB.prepare(
    "INSERT INTO social_content (page_id, message, link, scheduled_at, status, topic_id, ai_meta, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?) RETURNING id"
  ).bind(page.id, message, link, at, topicId || null, JSON.stringify(meta), t, t).first();
  return row.id;
}

// ---------- 3. Soạn bài ngày mai: mỗi chỗ đăng 2 phương án (A, B) để chọn, cộng 1 bài chia sẻ tin báo ----------
export async function makeDrafts(env, page, date, cfg, log = []) {
  // Đếm số chỗ đăng đã soạn (mỗi chỗ có thể có 2 phương án); bài chia sẻ tin báo tính riêng.
  const done = await env.DB.prepare(
    "SELECT COUNT(DISTINCT COALESCE(json_extract(ai_meta, '$.slot'), id)) AS n FROM social_content WHERE page_id = ? AND json_extract(ai_meta, '$.date') = ? AND COALESCE(json_extract(ai_meta, '$.kind'), '') != 'share'"
  ).bind(page.id, date).first();
  const want = Math.max(0, cfg.per_day - done.n);
  const created = [];
  let d = null;
  if (want) {
    d = await draftContext(env, page, date, cfg);
    if (d.planned) log.push(`${page.name}: đã lập kế hoạch tuần ${weekStart(date)}`);
    const { plan, st, style, ctx, lib, campaign, byId } = d;
    const day = plan.days?.find((x) => x.date === date) || { posts: [] };
    const slots = (day.posts || []).slice(done.n, done.n + want);
    while (slots.length < want) slots.push({ topic_id: ctx.subs[(done.n + slots.length) % ctx.subs.length]?.id, angle: '', time: cfg.times[done.n + slots.length] || DEFAULT_TIMES[0] });
    const nOpt = cfg.options || 2;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const idx = done.n + i + 1;
      const sub0 = byId[slot.topic_id];
      // Mẫu prompt trong Thư viện cho chỗ này (mã trong kế hoạch, rồi mã của chủ đề con): AI chỉnh thành prompt hoàn chỉnh.
      const tplIds = [...new Set([slot.prompt_id, ...(sub0?.prompt_ids || '').split(',')].filter((id) => id && lib[id]))].slice(0, 3);
      const tplText = tplIds.map((id) => `[${id}] ${lib[id].n} (${lib[id].k === 'video' ? 'video' : lib[id].k === 'image' ? 'ảnh' : 'tài liệu'}):\n${cut(lib[id].t, 900)}`).join('\n\n');
      const optLine = nOpt > 1
        ? `Viết ${nOpt} PHƯƠNG ÁN khác hẳn nhau để người duyệt chọn 1: phương án A theo góc bài trong kế hoạch; phương án B đổi góc tiếp cận (ví dụ kể chuyện thật, hỏi đáp, số liệu so sánh, mẹo nhanh, hậu trường) và đổi định dạng hình hoặc video nếu hợp. Hai phương án phải khác hook, khác cách mở bài, khác hình.`
        : 'Viết 1 phương án tốt nhất.';
      const prompt = `[VIEC:draft] Soạn bài Facebook cho ngày ${date} (${weekday(date)}) trên Fanpage "${page.name}", chỗ đăng ${idx} lúc ${slot.time || cfg.times[idx - 1] || DEFAULT_TIMES[0]}:
(id ${slot.topic_id}) ${sub0?.title || ''} | góc bài: ${slot.angle || 'tự chọn theo chủ đề'} | định dạng: ${slot.format || sub0?.formats || ''} | hình: ${slot.visual || ''}
${optLine}
Mỗi bài 90 đến 190 chữ: dòng đầu là hook cụ thể gây tò mò hoặc chạm nỗi lo thật của bà con, doanh nghiệp; thân bài 2–4 đoạn ngắn có ý cụ thể dùng được ngay; kết bằng câu kêu gọi theo CTA của chủ đề con. Ưu tiên dữ kiện trong tài liệu, kho kiến thức.
${tplText ? `MẪU PROMPT TRONG THƯ VIỆN (chọn mẫu hợp nhất cho từng phương án, chỉnh theo nội dung bài):\n${tplText}` : ''}
${MEDIA_GUIDE}
Trả JSON {"posts":[{"option":"A","topic_id":0,"angle":"góc tiếp cận 3–8 chữ","hook":"câu móc","message":"thân bài hoàn chỉnh (gồm hook ở đầu, không gồm liên hệ và hashtag)","visual":"tóm tắt hình ảnh hoặc video cần làm (1–2 câu)","prompt_id":"mã mẫu prompt đã chọn","media_prompt":"8 mục như hướng dẫn","storyboard":"nếu là video; không thì để trống","reason":"vì sao phương án này hiệu quả hôm đó (1–2 câu, có thể dựa vào tương tác)","source":"link nguồn nếu dùng tin tức, không thì để trống"${cfg.website && i === 0 ? ',"website":{"title":"tiêu đề bài website dưới 60 ký tự","outline":"dàn ý 3–5 ý"}' : ''}}]}`;
      const { text, provider } = await generate(env, { tier: 'write', maxTokens: 3500 * nOpt, system: `${assistantSystem(st.value, page, style.note)}\n\n${ctx.text}`, prompt });
      const out = parseJson(text);
      let posts = Array.isArray(out?.posts) ? out.posts : Array.isArray(out) ? out : out?.message ? [out] : [];
      // AI trả JSON bị cắt hoặc chỉ trả văn bản: vẫn lấy được thân bài đầu tiên.
      if (!posts.length) {
        const m = String(text).match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)/);
        const msg = m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : (!/^\s*[{[]/.test(text) ? text : '');
        if (msg.trim().length > 80) posts = [{ topic_id: slot.topic_id, message: msg, reason: slot.why || 'Bám kế hoạch tuần' }];
      }
      if (!posts.length) { console.error('assistant draft: AI trả về không đọc được', String(text).slice(0, 500)); if (!created.length && i === slots.length - 1) throw new HttpError(502, `AI chưa trả về bài hợp lệ, vui lòng thử lại (AI trả: ${cut(text, 160) || 'rỗng'})`, 'ai_bad'); continue; }
      const key = `${date}#${idx}`;
      const at = Math.max(tsAt(date, slot.time || cfg.times[idx - 1] || DEFAULT_TIMES[0]), now() + 3600);
      const opts = posts.slice(0, nOpt);
      for (let j = 0; j < opts.length; j++) {
        const p = opts[j];
        const sub = byId[Number(p.topic_id)] || sub0 || null;
        const raw = tidy(String(p.message || '')).slice(0, 4000);
        if (raw.length < 40) continue;
        const source = /^https?:\/\//.test(p.source || '') ? String(p.source).slice(0, 500) : '';
        const checked = await selfCheck(env, { body: enforceStyle(raw, { rules: st.value, strip: true }), sub, st, campaign });
        const meta = {
          date, by: 'assistant', provider: PROVIDER_LABELS[provider], slot: key, option: opts.length > 1 ? String.fromCharCode(65 + j) : '', options: opts.length,
          hook: cut(p.hook, 200), visual: cut(p.visual || slot.visual, 600),
          prompt_id: /^[a-z]{2}-\d{2}$/.test(p.prompt_id || '') ? p.prompt_id : (sub?.prompt_ids || '').split(',')[0] || '',
          media_prompt: cut(p.media_prompt, 4000), storyboard: cut(p.storyboard, 2500), storyboard_id: sub?.storyboard_id || '', reason: cut(p.reason || slot.why, 500),
          angle: cut(p.angle, 80) || slot.angle || '', check: checked.check, website: cfg.website && p.website?.title ? { title: cut(p.website.title, 90), outline: cut(p.website.outline, 800) } : null,
          ads: sub?.ads ? cut(sub.ads, 400) : '', topic_title: sub?.title || '', parent_title: sub?.parent_title || '',
        };
        created.push(await insertDraft(env, page, { message: compose(st, style, checked.text, source), at, topicId: sub?.id, meta }));
      }
    }
    log.push(`${page.name}: soạn ${created.length} bài (${slots.length} chỗ đăng${nOpt > 1 ? `, mỗi chỗ ${nOpt} phương án` : ''}) cho ${weekday(date)} ${date}, chờ duyệt`);
  } else log.push(`${page.name}: đã có bài cho ngày ${date}`);
  if (cfg.share) {
    try { const id = await makeShare(env, page, date, cfg, d, log); if (id) created.push(id); } catch (e) { log.push(`${page.name}: bài chia sẻ tin lỗi ${cut(e.message, 120)}`); }
  }
  return created;
}

// Bài chia sẻ tin báo: chọn 1 tin trong kho kiến thức (10 ngày gần nhất, chưa chia sẻ), Claude viết lời dẫn, gắn liên kết bài gốc.
async function makeShare(env, page, date, cfg, d, log) {
  const has = await env.DB.prepare("SELECT id FROM social_content WHERE page_id = ? AND json_extract(ai_meta, '$.date') = ? AND json_extract(ai_meta, '$.kind') = 'share' LIMIT 1").bind(page.id, date).first();
  if (has) return null;
  const [{ results: news }, { results: used }] = await Promise.all([
    env.DB.prepare("SELECT id, title, digest, body, url FROM social_knowledge WHERE kind = 'news' AND url IS NOT NULL AND url != '' AND (page_id = ? OR page_id IS NULL) AND created_at >= ? ORDER BY created_at DESC LIMIT 15").bind(page.id, now() - 10 * DAY).all(),
    env.DB.prepare("SELECT json_extract(ai_meta, '$.share_url') AS u FROM social_content WHERE page_id = ? AND json_extract(ai_meta, '$.kind') = 'share' AND created_at >= ?").bind(page.id, now() - 60 * DAY).all(),
  ]);
  const seen = new Set(used.map((u) => u.u));
  const cands = news.filter((n) => /^https?:\/\//.test(n.url) && !seen.has(n.url)).slice(0, 8);
  if (!cands.length) { log.push(`${page.name}: chưa có tin báo mới phù hợp để chia sẻ`); return null; }
  d ||= await draftContext(env, page, date, cfg);
  const { st, style, ctx, campaign } = d;
  const pub = (n) => ((n.body || '').match(/Nguồn:\s*(.+)\s*$/m) || [])[1] || (() => { try { return new URL(n.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const prompt = `[VIEC:share] Chọn 1 tin hợp nhất với Fanpage "${page.name}" để chia sẻ ngày ${date} (${weekday(date)}), rồi viết lời dẫn chia sẻ.
Tiêu chí chọn: liên quan trực tiếp chủ đề của Trang (truy xuất nguồn gốc, mã số vùng trồng, sầu riêng, cà phê, HTX, xuất khẩu nông sản Tây Nguyên), mới, có ích cho bà con hoặc doanh nghiệp. Tránh tin tiêu cực về cá nhân, tin chính trị, tin có tranh chấp pháp lý.
Lời dẫn 60 đến 120 chữ, viết bằng lời của Trang (không chép câu của báo): dòng đầu là hook nêu điểm đáng chú ý nhất; 1–2 đoạn tóm tắt ý chính chỉ theo nội dung tin; 1 đoạn "Góc nhìn" nối tin với việc bà con nên làm hoặc với chủ đề của Trang; kết bằng câu mời đọc bài gốc hoặc để lại ý kiến. Không bịa số liệu ngoài tin.
TIN CÓ THỂ CHỌN:
${cands.map((n, i) => `[TIN ${i + 1}] ${cut(n.title, 160)} — ${cut(n.digest, 360)} — báo: ${pub(n)}`).join('\n')}
Trả JSON {"pick":1,"topic_id":0,"hook":"câu móc","message":"lời dẫn hoàn chỉnh (không gồm liên kết, nguồn, liên hệ, hashtag)","reason":"vì sao chọn tin này (1 câu)"}`;
  const { text, provider } = await generate(env, { tier: 'write', maxTokens: 1500, system: `${assistantSystem(st.value, page, style.note)}\n\n${ctx.text}`, prompt });
  const out = parseJson(text) || {};
  const n = cands[Math.max(0, Math.min(cands.length - 1, Number(out.pick) - 1 || 0))];
  const raw = tidy(String(out.message || '')).slice(0, 2500);
  if (raw.length < 40) { log.push(`${page.name}: AI chưa viết được lời dẫn chia sẻ`); return null; }
  const sub = d.byId[Number(out.topic_id)] || null;
  const checked = await selfCheck(env, { body: enforceStyle(raw, { rules: st.value, strip: true }), sub, st, campaign });
  const source = `${pub(n) ? `${pub(n)} - ` : ''}${n.url}`;
  const meta = {
    date, by: 'assistant', kind: 'share', provider: PROVIDER_LABELS[provider], share_url: n.url, share_title: cut(n.title, 200), share_source: pub(n),
    hook: cut(out.hook, 200), reason: cut(out.reason, 400) || 'Tin báo mới liên quan chủ đề của Trang', check: checked.check,
    visual: 'Bài chia sẻ liên kết: Facebook tự hiện ảnh và tiêu đề bài báo, không cần làm hình.', topic_title: sub?.title || '', parent_title: sub?.parent_title || '',
  };
  // Giờ chia sẻ: 2 tiếng trước bài chính đầu tiên (mặc định 17:30), không trùng giờ bài chính.
  const main = cfg.times[0] || DEFAULT_TIMES[0];
  const [hh, mm] = main.split(':').map(Number);
  const shareTime = `${String(Math.max(7, hh - 2)).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const id = await insertDraft(env, page, { message: compose(st, style, checked.text, source), at: Math.max(tsAt(date, shareTime), now() + 3600), topicId: sub?.id, meta, link: n.url });
  log.push(`${page.name}: soạn 1 bài chia sẻ tin "${cut(n.title, 60)}"`);
  return id;
}

// ---------- 4. Đề xuất cập nhật chủ đề ----------
export async function suggestTopics(env, page, log = []) {
  const ctx = await pageContext(env, page);
  if (!ctx.subs.length) return log;
  const { results: know } = await env.DB.prepare("SELECT kind, title, digest, url FROM social_knowledge WHERE (page_id = ? OR page_id IS NULL) AND created_at >= ? ORDER BY created_at DESC LIMIT 15").bind(page.id, now() - 14 * DAY).all();
  let eng = null;
  try { eng = await pageEngagement(env, page.id, { fresh: true }); } catch (e) { console.error('engagement', e?.message); }
  if (!know.length && !eng?.text) { log.push(`${page.name}: chưa có kiến thức mới hay số liệu tương tác để đề xuất`); return log; }
  const parents = ctx.topics.map((t) => `(id ${t.id}) ${t.title}: tỷ trọng ${t.share || 0}%`).join('; ');
  const { text } = await generate(env, {
    tier: 'fast', maxTokens: 3000,
    system: 'Bạn là biên tập viên nội dung. Từ kiến thức mới và số liệu tương tác bài đã đăng (7, 15, 30 ngày), đề xuất tối đa 4 cập nhật cho kho chủ đề: thêm chủ đề con mới, sửa chủ đề con đang có (hook, thông điệp, CTA, dữ kiện, định dạng), hoặc cân chỉnh tỷ trọng chủ đề cha. Mỗi đề xuất phải dựa trên dữ kiện hoặc số liệu cụ thể, nêu rõ con số trong lý do. Ít bài (dưới 3 bài một chủ đề) thì chưa đủ để kết luận, nói rõ điều đó. Không đề xuất nội dung về số hộ, diện tích đã triển khai, CCCD, sổ đỏ, ủy quyền. Tiếng Việt có dấu. Trả JSON.',
    prompt: `[VIEC:suggest] Fanpage "${page.name}". Chủ đề cha: ${parents}\n\nChủ đề con hiện có:\n${ctx.subs.map((s) => `(id ${s.id}) ${s.title} | dữ kiện: ${cut(s.facts.replace(/\n/g, '; '), 200)}`).join('\n')}\n\nKIẾN THỨC MỚI:\n${know.map((k) => `- [${k.kind}] ${cut(k.title, 100)}: ${cut(k.digest, 250)}${k.url ? ` (${k.url})` : ''}`).join('\n') || '(không có)'}\n\n${eng?.text || 'TƯƠNG TÁC: chưa có số liệu'}\n\nTrả JSON {"suggestions":[{"action":"new|update|share","topic_id":"id chủ đề con nếu update","parent_id":"id chủ đề cha nếu new","title":"","hook":"","message":"","cta":"","facts":"dữ kiện mới, mỗi dòng một ý, kèm nguồn","formats":"","keywords":"","shares":[{"topic_id":"id chủ đề cha","share":0}],"reason":"vì sao nên cập nhật, dẫn số liệu"}]}. Với action share: liệt kê tỷ trọng mới cho mọi chủ đề cha, tổng đúng 100.`,
  });
  const list = (parseJson(text)?.suggestions || []).slice(0, 4);
  const subIds = new Set(ctx.subs.map((s) => s.id));
  const parentIds = new Set(ctx.topics.map((t) => t.id));
  const t = now();
  const stmts = [];
  for (const s of list) {
    if (s.action === 'share') {
      // Cân chỉnh tỷ trọng: lưu dạng update gắn chủ đề cha đầu tiên, payload.shares là bảng tỷ trọng mới.
      const shares = (Array.isArray(s.shares) ? s.shares : []).map((x) => ({ topic_id: Number(x.topic_id), share: Math.max(0, Math.min(100, Math.round(Number(x.share) || 0))) })).filter((x) => parentIds.has(x.topic_id));
      if (!shares.length || shares.reduce((a, x) => a + x.share, 0) !== 100) continue;
      stmts.push(env.DB.prepare("INSERT INTO social_topic_suggestions (page_id, topic_id, parent_id, action, payload, reason, created_at) VALUES (?, ?, NULL, 'update', ?, ?, ?)")
        .bind(page.id, shares[0].topic_id, JSON.stringify({ shares: shares.map((x) => ({ ...x, title: ctx.topics.find((t) => t.id === x.topic_id)?.title || '', old: ctx.topics.find((t) => t.id === x.topic_id)?.share || 0 })) }), cut(s.reason, 500), now()));
      continue;
    }
    const action = s.action === 'update' && subIds.has(Number(s.topic_id)) ? 'update' : 'new';
    const parentId = action === 'new' ? (parentIds.has(Number(s.parent_id)) ? Number(s.parent_id) : ctx.topics[0]?.id) : null;
    const payload = {};
    for (const k of ['title', 'hook', 'message', 'cta', 'facts', 'formats', 'keywords']) if (s[k]) payload[k] = cut(s[k], 1500);
    if (action === 'new' && !payload.title) continue;
    stmts.push(env.DB.prepare("INSERT INTO social_topic_suggestions (page_id, topic_id, parent_id, action, payload, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(page.id, action === 'update' ? Number(s.topic_id) : null, parentId, action, JSON.stringify(payload), cut(s.reason, 400), t));
  }
  if (stmts.length) await env.DB.batch(stmts);
  log.push(`${page.name}: ${stmts.length} đề xuất cập nhật chủ đề`);
  return log;
}

// ---------- 5. Đề xuất prompt mới cho Thư viện (thiết kế, hiệu ứng), Quý khách duyệt ----------
const DESIGN_KEYWORDS = 'kinetic typography, chữ chuyển động theo nhịp, parallax, Ken Burns, split screen trước/sau, isometric 3D, glassmorphism, mockup điện thoại, infographic số liệu, carousel kể chuyện, macro cận cảnh nông sản, timelapse, map reveal, particle, light leak, chuyển cảnh match cut, stop motion, UGC dọc 9:16, before/after slider';
export async function suggestPrompts(env, log = []) {
  const lib = await promptLibrary(env);
  const pending = (await getSetting(env, 'prompt_suggestions', [])).filter((x) => x.status === 'pending');
  if (pending.length >= 6) { log.push(`Còn ${pending.length} prompt đề xuất chưa duyệt, tạm chưa đề xuất thêm`); return log; }
  const { results: tops } = await env.DB.prepare("SELECT p.name AS page, t.title FROM social_topics t JOIN social_pages p ON p.id = t.page_id WHERE t.parent_id IS NULL AND t.status = 'active' ORDER BY p.name, t.sort LIMIT 20").all();
  const names = Object.entries(lib).map(([id, x]) => `${id} ${cut(x.n, 60)}`).join('; ');
  const { text } = await generate(env, {
    tier: 'fast', maxTokens: 3500,
    system: 'Bạn là giám đốc sáng tạo hình ảnh, video ngắn cho Fanpage nông nghiệp (FarmBase, Chiến dịch 10.000 ha). Đề xuất mẫu prompt MỚI cho thư viện, không trùng mẫu đã có, dùng được ngay với Claude hoặc công cụ tạo ảnh/video. Prompt viết tiếng Việt, cụ thể: khổ hình, bố cục, màu (xanh FarmBase #084C46, vàng #C9A227), chữ trên hình, chuyển động hoặc hiệu ứng, thời lượng nếu là video. Không dùng ảnh người thật nhận diện được, không số liệu triển khai, không CCCD, sổ đỏ. Trả JSON.',
    prompt: `[VIEC:prompts] Chủ đề các Fanpage: ${tops.map((t) => `${t.page}: ${t.title}`).join('; ') || '-'}\n\nMẪU ĐÃ CÓ (không lặp lại): ${cut(names, 7000)}\n\nTỪ KHÓA THIẾT KẾ, HIỆU ỨNG nên khai thác: ${DESIGN_KEYWORDS}\n\nĐề xuất tối đa 3 mẫu. Trả JSON {"prompts":[{"name":"tên ngắn","kind":"image|video","text":"prompt hoàn chỉnh, có chỗ [NỘI DUNG] để thay","keywords":"từ khóa thiết kế, hiệu ứng","why":"dùng cho chủ đề nào, vì sao hiệu quả"}]}`,
  });
  const list = (parseJson(text)?.prompts || []).filter((x) => x?.name && x?.text && String(x.text).length > 60).slice(0, 3);
  const all = await getSetting(env, 'prompt_suggestions', []);
  const t = now();
  for (const [i, x] of list.entries()) all.unshift({ sid: `${t}${i}`, name: cut(x.name, 90), kind: x.kind === 'video' ? 'video' : 'image', text: String(x.text).slice(0, 2500), keywords: cut(x.keywords, 200), why: cut(x.why, 300), status: 'pending', at: t });
  await putSetting(env, 'prompt_suggestions', all.slice(0, 40));
  await putSetting(env, 'prompt_suggest_at', t);
  log.push(`Đề xuất ${list.length} prompt mới cho Thư viện, chờ duyệt`);
  return log;
}

// ---------- Chạy hằng ngày ----------
const SYS_REQ = { headers: new Headers() };
export async function runDaily(env, { pageIds = null, steps = ['learn', 'plan', 'drafts', 'suggest'], force = false, userId = null } = {}) {
  const log = [];
  const t = now();
  const today = vnDate(t);
  const tomorrow = addDays(today, 1);
  const settings = await getSetting(env, 'assistant', { pages: {} });
  if (!aiProvider(env)) return { log: ['Chưa cài AI cho hệ thống'] };
  if (steps.includes('learn')) { try { await learnNews(env, log); } catch (e) { log.push(`Đọc tin lỗi: ${cut(e.message, 120)}`); } }
  const { results: pages } = await env.DB.prepare(
    "SELECT p.id, p.name, (SELECT COUNT(*) FROM social_topics t WHERE t.page_id = p.id AND t.parent_id IS NOT NULL) AS subs FROM social_pages p WHERE p.status != 'disconnected' ORDER BY p.name"
  ).all();
  for (const page of pages) {
    if (pageIds && !pageIds.includes(page.id)) continue;
    const cfg = pageCfg(settings, page.id, page.subs > 0);
    if (!page.subs || (!cfg.on && !force)) continue;
    try {
      // Xem lại tương tác bài đã đăng (7, 15, 30 ngày) trước khi lập kế hoạch và soạn bài.
      if (steps.includes('plan') || steps.includes('drafts')) { try { await pageEngagement(env, page.id); } catch (e) { console.error('engagement', e?.message); } }
      if (steps.includes('plan')) {
        const ws = weekStart(tomorrow);
        if (force || !(await loadPlan(env, page.id, ws))) { await makePlan(env, page, ws, cfg); log.push(`${page.name}: lập kế hoạch tuần ${ws}`); }
      }
      if (steps.includes('drafts')) await makeDrafts(env, page, tomorrow, cfg, log);
      // Đề xuất cân chỉnh chủ đề: sáng thứ Hai và thứ Năm (hoặc khi bấm "Đề xuất ngay"), bỏ qua nếu còn nhiều đề xuất chưa duyệt.
      const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
      if (steps.includes('suggest') && ([1, 4].includes(wd) || force)) {
        const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_topic_suggestions WHERE page_id = ? AND status = 'pending'").bind(page.id).first();
        if (force || pend.n < 6) await suggestTopics(env, page, log); else log.push(`${page.name}: còn ${pend.n} đề xuất chưa duyệt, tạm chưa đề xuất thêm`);
      }
    } catch (e) { log.push(`${page.name}: lỗi ${cut(e.message, 160)}`); }
  }
  // Thứ Hai: đề xuất prompt mới cho Thư viện (1 lần, một lượt Claude Haiku)
  if (!pageIds && steps.includes('suggest') && new Date(`${today}T00:00:00Z`).getUTCDay() === 1) {
    try { await suggestPrompts(env, log); } catch (e) { log.push(`Đề xuất prompt lỗi: ${cut(e.message, 120)}`); }
  }
  settings.last_run = t;
  settings.last_log = log.slice(0, 30);
  await putSetting(env, 'assistant', settings, userId);
  await audit(env, SYS_REQ, userId, 'assistant_run', today, { log: log.slice(0, 10) });
  return { log };
}

// ---------- API ----------
function noAgent(user) { if (user.role === 'agent') throw new HttpError(403, 'Không có quyền', 'forbidden'); }

function usageCost(u) {
  let usd = 0;
  const rows = [];
  for (const [model, m] of Object.entries(u || {})) {
    const p = PRICES[model] || [2, 10];
    const c = (m.in * p[0] + m.cache * p[0] * 0.1 + m.out * p[1]) / 1e6;
    usd += c;
    rows.push({ model, ...m, usd: Math.round(c * 1000) / 1000 });
  }
  return { usd: Math.round(usd * 100) / 100, rows };
}

// GET /api/assistant?page_id=
export async function assistantState(request, env, user) {
  noAgent(user);
  const ids = await allowedPageIds(env, user);
  const pid = new URL(request.url).searchParams.get('page_id') || ids[0];
  if (!pid || !ids.includes(pid)) return json({ page: null, pages: [] });
  const marks = ids.map(() => '?').join(',');
  const { results: pages } = await env.DB.prepare(
    `SELECT p.id, p.name, p.picture_url, (SELECT COUNT(*) FROM social_topics t WHERE t.page_id = p.id AND t.parent_id IS NOT NULL) AS subs FROM social_pages p WHERE p.id IN (${marks}) ORDER BY p.name`
  ).bind(...ids).all();
  const page = pages.find((p) => p.id === pid);
  const settings = await getSetting(env, 'assistant', { pages: {} });
  const t = now();
  const today = vnDate(t);
  const tomorrow = addDays(today, 1);
  const wsNow = weekStart(today);
  const wsNext = weekStart(tomorrow);
  const [plan, planNext, drafts] = await Promise.all([
    loadPlan(env, pid, wsNow), wsNext !== wsNow ? loadPlan(env, pid, wsNext) : null,
    env.DB.prepare("SELECT c.id, c.message, c.status, c.scheduled_at, c.topic_id, c.ai_meta, c.created_at, c.reject_reason FROM social_content c WHERE c.page_id = ? AND c.ai_meta IS NOT NULL ORDER BY COALESCE(c.scheduled_at, c.created_at) DESC LIMIT 30").bind(pid).all(),
  ]);
  const month = new Date((t + VN) * 1000).toISOString().slice(0, 7);
  const usage = usageCost(await getSetting(env, `ai_usage:${month}`, {}));
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_topic_suggestions WHERE page_id = ? AND status = 'pending'").bind(pid).first();
  let engagement = null;
  try { engagement = await pageEngagement(env, pid); } catch (e) { engagement = { error: e.message, windows: [], topics: [], top: [], low: [] }; }
  if (engagement) delete engagement.text;
  const promptSugg = (await getSetting(env, 'prompt_suggestions', [])).filter((x) => x.status === 'pending');
  const promptExtra = await getSetting(env, 'prompt_extra', []);
  return json({
    engagement, prompt_suggestions: promptSugg, prompt_extra: promptExtra,
    page, pages: pages.map((p) => ({ ...p, cfg: pageCfg(settings, p.id, p.subs > 0) })),
    cfg: pageCfg(settings, pid, page.subs > 0), today, tomorrow,
    plans: [plan, planNext].filter(Boolean),
    drafts: drafts.results.map((d) => ({ ...d, ai_meta: parseJson(d.ai_meta) || {} })),
    last_run: settings.last_run || null, last_log: settings.last_log || [],
    usage: { month, ...usage }, provider: PROVIDER_LABELS[aiProvider(env)] || null,
    models: aiProvider(env) === 'claude' ? await claudeModels(env) : null,
    model_choices: MODEL_CHOICES.map((m) => ({ ...m, price: PRICES[m.id], per_post: Math.round(costPerPost(m.id, 'claude-haiku-5-5') * 10000) / 10000 })),
    can_models: user.role === 'owner',
    pending_suggestions: pending.n,
    can_run: user.role === 'owner' || user.role === 'manager',
  });
}

// PUT /api/assistant/settings { page_id, on, per_day, times, website }
export async function saveAssistantSettings(request, env, user) {
  requireRole(user, 'owner', 'manager');
  const b = await readJson(request);
  const pid = String(b.page_id || '');
  if (!(await allowedPageIds(env, user)).includes(pid)) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
  const settings = await getSetting(env, 'assistant', { pages: {} });
  settings.pages ||= {};
  settings.pages[pid] = {
    on: !!b.on, per_day: Number(b.per_day) === 2 ? 2 : 1,
    times: (Array.isArray(b.times) ? b.times : []).filter((x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x)).slice(0, 2),
    website: b.website !== false, options: Number(b.options) === 1 ? 1 : 2, share: b.share !== false,
  };
  await putSetting(env, 'assistant', settings, user.id);
  await audit(env, request, user.id, 'assistant_settings', pid, settings.pages[pid]);
  return json({ ok: true });
}

// POST /api/assistant/run { page_id, steps?: [learn, plan, drafts, suggest] }
export async function runNow(request, env, user) {
  requireRole(user, 'owner', 'manager');
  const b = await readJson(request);
  const pid = String(b.page_id || '');
  if (!(await allowedPageIds(env, user)).includes(pid)) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
  const steps = (Array.isArray(b.steps) ? b.steps : ['learn', 'plan', 'drafts']).filter((s) => ['learn', 'plan', 'drafts', 'suggest'].includes(s));
  const r = await runDaily(env, { pageIds: [pid], steps, force: steps.includes('suggest') || b.replan === true, userId: user.id });
  return json(r);
}

// POST /api/assistant/plan-feedback { page_id, week_start, feedback }: lập lại kế hoạch tuần theo góp ý
export async function planFeedback(request, env, user) {
  requireRole(user, 'owner', 'manager');
  const b = await readJson(request);
  const pid = String(b.page_id || '');
  if (!(await allowedPageIds(env, user)).includes(pid)) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
  const feedback = String(b.feedback || '').trim().slice(0, 1000);
  const ws = /^\d{4}-\d{2}-\d{2}$/.test(b.week_start || '') ? weekStart(b.week_start) : weekStart(addDays(vnDate(now()), 1));
  const page = await env.DB.prepare('SELECT id, name FROM social_pages WHERE id = ?').bind(pid).first();
  const settings = await getSetting(env, 'assistant', { pages: {} });
  if (feedback) await saveFeedback(env, pid, `Kế hoạch tuần: ${feedback}`, user.id);
  const plan = await makePlan(env, page, ws, pageCfg(settings, pid, true), { feedback });
  await audit(env, request, user.id, 'plan_regenerated', page.name, { week_start: ws });
  return json({ plan: { ...plan, week_start: ws } });
}

async function saveFeedback(env, pageId, text, userId) {
  await env.DB.prepare("INSERT INTO social_knowledge (page_id, kind, title, body, digest, created_by, created_at) VALUES (?, 'feedback', ?, ?, ?, ?, ?)")
    .bind(pageId, cut(text, 120), text, cut(text, 400), userId, now()).run();
}

// POST /api/assistant/revise/:id { feedback }: viết lại bài theo góp ý; góp ý được lưu để các bài sau làm theo.
export async function reviseDraft(request, env, user, id) {
  noAgent(user);
  const row = await env.DB.prepare('SELECT c.*, p.name AS page_name FROM social_content c JOIN social_pages p ON p.id = c.page_id WHERE c.id = ?').bind(Number(id)).first();
  if (!row || !(await allowedPageIds(env, user)).includes(row.page_id)) throw new HttpError(404, 'Không tìm thấy bài', 'not_found');
  if (!['draft', 'pending', 'rejected', 'failed'].includes(row.status)) throw new HttpError(409, 'Bài đã đăng hoặc đã hẹn giờ', 'bad_status');
  if (user.role === 'editor' && row.created_by && row.created_by !== user.id) throw new HttpError(403, 'Không có quyền sửa bài này', 'forbidden');
  const b = await readJson(request);
  const feedback = String(b.feedback || '').trim().slice(0, 1000);
  if (feedback.length < 3) throw new HttpError(400, 'Vui lòng nhập góp ý', 'empty');
  const page = { id: row.page_id, name: row.page_name };
  const st = await getRules(env);
  const style = (await getPageStyles(env, [page.id]))[page.id] || {};
  const ctx = await pageContext(env, page);
  const sub = ctx.subs.find((s) => s.id === row.topic_id) || null;
  // Bỏ phần cuối bài (footer riêng Trang hoặc liên hệ chung) trước khi viết lại, để không bị lặp.
  let cur = row.message;
  const foot = footerFor(st, style);
  if (foot && cur.includes(foot)) cur = cur.replace(foot, '');
  if (st.contact && cur.includes(st.contact)) cur = cur.replace(st.contact, '');
  const body = enforceStyle(cur, { rules: st.value, strip: true });
  const stats = /(số liệu|số hộ|nông hộ|hộ dân|diện tích|\bha\b|quy mô)/i.test(feedback);
  const src = (row.message.match(/^\s*Nguồn:\s*(\S+)\s*$/im) || [])[1] || '';
  const meta = parseJson(row.ai_meta) || {};
  const share = meta.kind === 'share';
  const { text, provider } = await generate(env, {
    tier: 'write', maxTokens: 5000, system: `${assistantSystem(st.value, page, style.note)}\n\n${ctx.text}`,
    prompt: `[VIEC:revise] Viết lại bài dưới đây theo góp ý của người duyệt. Giữ dữ kiện đúng, không thêm số liệu mới${stats ? ' (được dùng số liệu triển khai có trong hồ sơ Fanpage vì người duyệt yêu cầu)' : ''}.
${sub ? `CHỦ ĐỀ CON HIỆN TẠI: (id ${sub.id}) ${sub.title} | CTA: ${sub.cta}` : 'Bài chưa gắn chủ đề con: chọn chủ đề con hợp nhất trong danh sách (ghi đúng id).'}
GÓP Ý: ${feedback}

BÀI HIỆN TẠI:
${body}
${share ? '' : `\nHÌNH ĐANG ĐỀ XUẤT: ${cut(meta.visual, 400) || '-'}\n\n${MEDIA_GUIDE}\nCập nhật hình và prompt cho khớp bài mới.`}
Trả JSON {"topic_id":0,"message":"thân bài mới (không liên hệ, không hashtag${share ? ', không liên kết' : ''})","reason":"vì sao bài mới hiệu quả hơn (1–2 câu)"${share ? '' : ',"visual":"tóm tắt hình hoặc video","prompt_id":"mã mẫu prompt","media_prompt":"8 mục như hướng dẫn","storyboard":"nếu là video"'}}`,
  });
  const r = parseJson(text) || {};
  const newBody = typeof r.message === 'string' && r.message.trim().length > 40 ? r.message : (!/^\s*[{[]/.test(text) && text.trim().length > 40 ? text : '');
  const revised = tidy(provider === 'fake' || !newBody ? `${body}\n\n(Đã sửa theo góp ý: ${feedback})` : newBody);
  const checked = await selfCheck(env, { body: enforceStyle(revised, { rules: st.value, strip: true }), sub, st, campaign: /10\.?000/.test(page.name), stats });
  const message = compose(st, style, checked.text, src);
  meta.check = checked.check;
  // Cập nhật luôn phần giải thích, hình và prompt theo bài mới (trước đây chỉ đổi thân bài nên thông tin cũ bị lệch).
  const nsub = ctx.subs.find((x) => x.id === Number(r.topic_id)) || sub;
  meta.topic_title = nsub?.title || '';
  meta.parent_title = nsub?.parent_title || '';
  if (r.reason) meta.reason = cut(r.reason, 500);
  if (!share && r.visual) meta.visual = cut(r.visual, 600);
  if (!share && r.media_prompt) meta.media_prompt = cut(r.media_prompt, 4000);
  if (!share && typeof r.storyboard === 'string') meta.storyboard = cut(r.storyboard, 2500);
  if (!share && /^[a-z]{2}-\d{2}$/.test(r.prompt_id || '')) meta.prompt_id = r.prompt_id;
  if (nsub) meta.storyboard_id = nsub.storyboard_id || meta.storyboard_id || '';
  meta.feedback = [...(meta.feedback || []), { text: feedback, at: now() }].slice(-5);
  await env.DB.prepare('UPDATE social_content SET message = ?, topic_id = ?, ai_meta = ?, updated_at = ? WHERE id = ?').bind(message, nsub?.id || null, JSON.stringify(meta), now(), row.id).run();
  await saveFeedback(env, page.id, feedback, user.id);
  await audit(env, request, user.id, 'ai_revised', cut(feedback, 80), { id: row.id });
  return json({ message, check: checked.check, ai_meta: meta });
}

// PUT /api/assistant/models { write, fast }: chọn model Claude cho viết bài và cho việc nhanh (chỉ Chủ hệ thống)
export async function saveModels(request, env, user) {
  requireRole(user, 'owner');
  const b = await readJson(request);
  const ids = MODEL_CHOICES.map((m) => m.id);
  if (!ids.includes(b.write) || !ids.includes(b.fast)) throw new HttpError(400, 'Model không hợp lệ', 'bad_model');
  const cheap = b.cheap === 'claude' ? 'claude' : 'workers';
  await env.DB.prepare("INSERT INTO social_settings (key, value, updated_by, updated_at) VALUES ('ai_models', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(JSON.stringify({ write: b.write, fast: b.fast, cheap }), user.id, now()).run();
  await audit(env, request, user.id, 'ai_models_updated', `${b.write} / ${b.fast} / ${cheap}`);
  return json({ models: await claudeModels(env) });
}

// POST /api/assistant/prompts/suggest: đề xuất prompt mới ngay
export async function suggestPromptsNow(request, env, user) {
  requireRole(user, 'owner', 'manager');
  if (!aiProvider(env)) throw new HttpError(503, 'Chưa cài AI cho hệ thống', 'no_ai');
  const log = await suggestPrompts(env, []);
  return json({ log });
}

// POST /api/assistant/prompts/:sid/accept | dismiss: duyệt prompt đề xuất (chấp nhận thì thêm vào Prompt bổ sung, mã bs-NN)
async function decidePrompt(request, env, user, sid, accept) {
  requireRole(user, 'owner', 'manager');
  const all = await getSetting(env, 'prompt_suggestions', []);
  const x = all.find((p) => p.sid === String(sid));
  if (!x || x.status !== 'pending') throw new HttpError(404, 'Không tìm thấy đề xuất', 'not_found');
  x.status = accept ? 'accepted' : 'dismissed';
  if (accept) {
    const extra = await getSetting(env, 'prompt_extra', []);
    const n = extra.reduce((m, p) => Math.max(m, Number(String(p.id).split('-')[1]) || 0), 0) + 1;
    x.id = `bs-${String(n).padStart(2, '0')}`;
    extra.push({ id: x.id, name: x.name, kind: x.kind, text: x.text, keywords: x.keywords, why: x.why, at: now() });
    await putSetting(env, 'prompt_extra', extra, user.id);
  }
  await putSetting(env, 'prompt_suggestions', all, user.id);
  await audit(env, request, user.id, accept ? 'prompt_accepted' : 'prompt_dismissed', x.name);
  return json({ ok: true, id: x.id || null });
}
export const acceptPrompt = (r, e, u, sid) => decidePrompt(r, e, u, sid, true);
export const dismissPrompt = (r, e, u, sid) => decidePrompt(r, e, u, sid, false);
