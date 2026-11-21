// Quy định đăng bài (văn phong, xưng hô, từ cấm...) và AI viết bài theo quy định (Cloudflare Workers AI).
import { HttpError, json, readJson, now } from '../lib/http.js';
import { requireRole, allowedPageIds } from '../lib/auth.js';
import { generate, PROVIDER_LABELS } from '../lib/ai.js';
import { audit } from '../lib/audit.js';

const MAX_RULES = 8000;
export const LENGTHS = { ngan: 'ngắn, khoảng 40 đến 70 từ', vua: 'vừa phải, khoảng 80 đến 150 từ', dai: 'dài, khoảng 180 đến 300 từ' };

export async function getRules(env) {
  const row = await env.DB.prepare("SELECT value, updated_at, updated_by FROM social_settings WHERE key = 'post_rules'").first();
  return row || { value: '', updated_at: null, updated_by: null };
}

// GET /api/rules
export async function readRules(request, env, user) {
  const r = await getRules(env);
  const by = r.updated_by ? await env.DB.prepare('SELECT name, email FROM social_users WHERE id = ?').bind(r.updated_by).first() : null;
  return json({ text: r.value, updated_at: r.updated_at, updated_by_name: by ? by.name || by.email : null, can_edit: user.role === 'owner' || user.role === 'manager' });
}

// PUT /api/rules { text }
export async function saveRules(request, env, user) {
  requireRole(user, 'owner', 'manager');
  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length > MAX_RULES) throw new HttpError(400, `Quy định tối đa ${MAX_RULES} ký tự`, 'too_long');
  const t = now();
  await env.DB.prepare(
    "INSERT INTO social_settings (key, value, updated_by, updated_at) VALUES ('post_rules', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at"
  ).bind(text, user.id, t).run();
  await audit(env, request, user.id, 'rules_updated', `${text.length} ký tự`);
  return json({ ok: true, updated_at: t });
}

export function systemPrompt(rules, pageNames) {
  return [
    'Bạn là người viết nội dung Fanpage Facebook cho doanh nghiệp Việt Nam.',
    'Viết bằng tiếng Việt có dấu, tự nhiên, đúng chính tả. Chỉ trả về đúng nội dung bài đăng, không giải thích, không tiêu đề kiểu Markdown, không dùng ** hay #.',
    'Không bịa số liệu, giá, ngày tháng, tên người hoặc cam kết không có trong ý chính. Thiếu thông tin thì viết chung, không tự thêm.',
    pageNames.length ? `Bài sẽ đăng trên Fanpage: ${pageNames.join(', ')}.` : '',
    rules ? `QUY ĐỊNH ĐĂNG BÀI CỦA DOANH NGHIỆP (bắt buộc tuân theo, ưu tiên cao nhất):\n${rules}` : '',
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
  const rules = (await getRules(env)).value;
  const task = current
    ? `Viết lại bài dưới đây cho hay hơn, độ dài ${length}.${brief ? `\nYêu cầu thêm: ${brief}` : ''}\n\nBài hiện tại:\n${current}`
    : `Viết một bài đăng Facebook, độ dài ${length}, từ ý chính sau:\n${brief}`;

  let { text, provider } = await generate(env, { system: systemPrompt(rules, pageNames), prompt: task, maxTokens: 1200 });
  if (provider === 'fake' && rules) text += ' [theo quy định]'; // chỉ dùng khi chạy thử trên máy
  text = tidy(text).slice(0, 5000);
  if (!text) throw new HttpError(502, 'AI chưa trả về nội dung, vui lòng thử lại', 'ai_empty');
  await audit(env, request, user.id, 'ai_written', brief.slice(0, 80) || '(viết lại)');
  return json({ text, provider: PROVIDER_LABELS[provider] });
}
