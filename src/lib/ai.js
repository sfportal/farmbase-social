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

export async function generate(env, { system, prompt, maxTokens = 1200 }) {
  const provider = aiProvider(env);
  if (!provider) throw new HttpError(503, 'Chưa cài AI cho hệ thống', 'no_ai');
  try {
    if (provider === 'fake') return { text: `${env.AI_FAKE_REPLY}`, provider };
    if (provider === 'claude') {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const res = await client.messages.create({
        model: env.CLAUDE_MODEL || 'claude-opus-5-5',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      });
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
