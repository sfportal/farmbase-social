// Gọi AI viết bài. Ưu tiên Claude (biến bí mật ANTHROPIC_API_KEY), rồi DeepSeek (DEEPSEEK_API_KEY),
// không có khóa nào thì dùng Workers AI miễn phí của Cloudflare. Khóa đặt trên Cloudflare, không có trong repo.
import Anthropic from '@anthropic-ai/sdk';
import { HttpError } from './http.js';

const WORKERS_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export function aiProvider(env) {
  if (env.AI_FAKE_REPLY !== undefined) return 'fake';
  if (env.ANTHROPIC_API_KEY) return 'claude';
  if (env.DEEPSEEK_API_KEY) return 'deepseek';
  return env.AI ? 'workers' : null;
}

export const PROVIDER_LABELS = { claude: 'Claude (Anthropic)', deepseek: 'DeepSeek', workers: 'Workers AI (miễn phí)', fake: 'AI thử nghiệm' };

// Chọn model Claude theo việc để tiết kiệm chi phí:
//  - 'fast' (tóm tắt tin, tự kiểm tra, đề xuất chủ đề): Claude Haiku 5.5, rẻ nhất.
//  - 'write' (viết bài, kế hoạch tuần): Claude Sonnet 5.5, viết tiếng Việt tốt, giá vừa phải.
// Đổi bằng biến CLAUDE_MODEL (viết bài) và CLAUDE_FAST_MODEL (việc nhanh) trên Cloudflare.
export const CLAUDE_MODELS = { write: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' };
// Giá tham khảo (USD cho 1 triệu token: vào, ra), dùng để ước tính chi phí hằng tháng.
export const PRICES = { 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-opus-5-5': [5, 25] };
export const claudeModel = (env, tier = 'write') => (tier === 'fast' ? env.CLAUDE_FAST_MODEL || CLAUDE_MODELS.fast : env.CLAUDE_MODEL || CLAUDE_MODELS.write);

// Cộng dồn số token đã dùng theo tháng (giờ Việt Nam), để hiện chi phí ước tính.
async function recordUsage(env, model, usage) {
  if (!env.DB || !usage) return;
  const month = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
  const key = `ai_usage:${month}`;
  try {
    const row = await env.DB.prepare('SELECT value FROM social_settings WHERE key = ?').bind(key).first();
    let u = {};
    try { u = JSON.parse(row?.value || '{}'); } catch { u = {}; }
    const m = u[model] || { in: 0, out: 0, cache: 0, calls: 0 };
    m.in += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    m.cache += usage.cache_read_input_tokens || 0;
    m.out += usage.output_tokens || 0;
    m.calls += 1;
    u[model] = m;
    await env.DB.prepare('INSERT INTO social_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind(key, JSON.stringify(u), Math.floor(Date.now() / 1000)).run();
  } catch (e) { console.error('usage', e?.message); }
}

export async function generate(env, { system, prompt, maxTokens = 1200, tier = 'write' }) {
  const provider = aiProvider(env);
  if (!provider) throw new HttpError(503, 'Chưa cài AI cho hệ thống', 'no_ai');
  try {
    if (provider === 'fake') {
      // Chạy thử trên máy: AI_FAKE_JSON trả lời các yêu cầu cần JSON (kế hoạch, bài trợ lý, kiểm tra).
      if (env.AI_FAKE_JSON && /JSON/.test(prompt)) return { text: fakeJson(prompt), provider };
      return { text: `${env.AI_FAKE_REPLY}`, provider };
    }
    if (provider === 'claude') {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const model = claudeModel(env, tier);
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        // Phần hướng dẫn cố định đặt cache để các lần gọi liền nhau chỉ tính 1/10 giá phần này.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        // Mức suy nghĩ thấp: việc viết bài và kiểm tra không cần suy luận dài, tiết kiệm token ra.
        output_config: { effort: tier === 'fast' ? 'low' : 'medium' },
        messages: [{ role: 'user', content: prompt }],
      });
      await recordUsage(env, model, res.usage);
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { text, provider };
    }
    if (provider === 'deepseek') {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model: env.DEEPSEEK_MODEL || 'deepseek-chat', max_tokens: maxTokens, temperature: 0.7,
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error?.message || `DeepSeek trả lỗi ${res.status}`);
      return { text: d.choices?.[0]?.message?.content || '', provider };
    }
    const out = await env.AI.run(WORKERS_MODEL, { messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.7 });
    return { text: out?.response || '', provider };
  } catch (e) {
    console.error('ai', provider, e?.message);
    const msg = provider === 'workers' ? 'AI đang bận hoặc hết lượt miễn phí trong ngày, vui lòng thử lại sau' : `${PROVIDER_LABELS[provider]} báo lỗi: ${String(e?.message || '').slice(0, 200)}`;
    throw new HttpError(502, msg, 'ai_error');
  }
}

// Lấy JSON từ câu trả lời của AI (bỏ khung ```json nếu có).
export function parseJson(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  const a2 = s.indexOf('['), b2 = s.lastIndexOf(']');
  const tryParse = (x) => { try { return JSON.parse(x); } catch { return null; } };
  if (a2 !== -1 && (a === -1 || a2 < a)) { const v = tryParse(s.slice(a2, b2 + 1)); if (v) return v; }
  if (a !== -1) return tryParse(s.slice(a, b + 1));
  return null;
}

// Câu trả lời giả cho kiểm thử trên máy (không gọi AI thật).
function fakeJson(prompt) {
  const kind = (prompt.match(/\[VIEC:(\w+)\]/) || [])[1];
  const ids = [...prompt.matchAll(/\(id (\d+)\)/g)].map((m) => Number(m[1]));
  const sub = ids[0] || 0;
  if (kind === 'plan') {
    const days = [...prompt.matchAll(/NGAY (\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
    return JSON.stringify({ focus: 'Tuần thử nghiệm: giới thiệu chủ đề chính', note: 'Có thể đổi theo tin tức', days: days.map((d) => ({ date: d, posts: [{ topic_id: sub, angle: 'Góc bài thử', format: 'Ảnh 4:5', visual: 'Ảnh vườn thật', time: '19:30' }] })) });
  }
  if (kind === 'draft') return JSON.stringify({ posts: [{ topic_id: sub, hook: 'Câu móc thử', message: 'Bài viết thử của trợ lý AI cho ngày mai. Nội dung ngắn gọn, rõ ràng.\n\nMời bà con nhắn tin để được hướng dẫn.', visual: 'Ảnh 4:5: bà con ghi nhật ký tại vườn', prompt_id: 'ha-01', storyboard: '', reason: 'Bám kế hoạch tuần và chủ đề con', website: { title: 'Gợi ý bài website thử', outline: 'Mở bài; Thân bài; Kết bài' } }] });
  if (kind === 'check') return JSON.stringify({ ok: true, issues: [] });
  if (kind === 'digest') return JSON.stringify({ items: [...prompt.matchAll(/\[TIN (\d+)\]/g)].map((m) => ({ n: Number(m[1]), digest: 'Tóm tắt tin thử', relevant: true })) });
  if (kind === 'suggest') return JSON.stringify({ suggestions: [{ action: 'new', parent_id: ids[0] || null, title: 'Chủ đề con đề xuất thử', hook: 'Câu móc đề xuất', message: 'Thông điệp đề xuất', cta: 'Nhắn tin cho Fanpage', reason: 'Từ tin tức mới trong kho' }] });
  if (kind === 'summary') return JSON.stringify({ digest: 'Tóm tắt tài liệu thử' });
  return '{}';
}
