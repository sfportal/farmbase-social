// Tương tác bài đã đăng của Fanpage trong 7, 15, 30 ngày, gom theo chủ đề.
// Trợ lý AI dùng bản tóm tắt này khi lập kế hoạch, soạn bài và đề xuất cân chỉnh chủ đề (Quý khách duyệt).
// Đọc Facebook một lần, lưu tạm 12 giờ trong social_settings 'engagement:<id Trang>' để tiết kiệm lượt gọi.
import { fetchPagePosts } from './posts.js';
import { now } from '../lib/http.js';
import { loadTopics } from './topics.js';

const DAY = 86400;
const TTL = 12 * 3600;
const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const avg = (sum, n) => (n ? Math.round((sum / n) * 10) / 10 : 0);

export async function cachedEngagement(env, pageId) {
  const row = await env.DB.prepare('SELECT value FROM social_settings WHERE key = ?').bind(`engagement:${pageId}`).first();
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}

// Tính lại (nếu bản lưu đã cũ hơn 12 giờ hoặc fresh = true). Lỗi Facebook thì trả bản cũ, kèm lỗi.
export async function pageEngagement(env, pageId, { fresh = false } = {}) {
  const old = await cachedEngagement(env, pageId);
  if (!fresh && old && now() - old.at < TTL) return old;
  const page = await env.DB.prepare('SELECT id, name, picture_url, access_token_enc FROM social_pages WHERE id = ?').bind(pageId).first();
  if (!page) return null;
  const t = now();
  let posts = [];
  try {
    let after = '';
    for (let i = 0; i < 3; i++) { // tối đa 3 trang x 50 bài trong 30 ngày
      const r = await fetchPagePosts(env, page, { limit: 50, after, since: t - 30 * DAY });
      posts.push(...r.posts.filter((p) => p.created_time && p.created_time >= t - 30 * DAY));
      if (!r.after || r.posts.length < 50) break;
      after = r.after;
    }
  } catch (e) {
    return old ? { ...old, error: cut(e.message, 200) } : { at: t, error: cut(e.message, 200), windows: [], topics: [], top: [], low: [], text: '' };
  }
  // Bài đăng qua hệ thống có chủ đề con (topic_id): khớp theo id bài Facebook.
  const { results: rows } = await env.DB.prepare('SELECT fb_post_id, topic_id FROM social_content WHERE page_id = ? AND fb_post_id IS NOT NULL AND topic_id IS NOT NULL').bind(pageId).all();
  const topicOf = {};
  for (const r of rows) { topicOf[r.fb_post_id] = r.topic_id; topicOf[`${pageId}_${r.fb_post_id}`] = r.topic_id; }
  const tops = await loadTopics(env, pageId);
  const subMap = {};
  for (const p of tops) for (const c of p.children) subMap[c.id] = { sub: c, parent: p };
  posts = posts.map((p) => ({ ...p, topic_id: topicOf[p.id] || topicOf[String(p.id).split('_').pop()] || null }));

  const windows = [7, 15, 30].map((d) => {
    const list = posts.filter((p) => p.created_time >= t - d * DAY);
    const sum = list.reduce((a, p) => a + p.engagement, 0);
    return { days: d, posts: list.length, engagement: sum, avg: avg(sum, list.length), comments: list.reduce((a, p) => a + p.comments, 0), shares: list.reduce((a, p) => a + p.shares, 0) };
  });
  // Theo chủ đề cha: số bài, tỷ lệ thực tế so với tỷ trọng kế hoạch, tương tác trung bình (30 ngày, chỉ bài có gắn chủ đề).
  const tagged = posts.filter((p) => subMap[p.topic_id]);
  const topics = tops.map((p) => {
    const list = tagged.filter((x) => subMap[x.topic_id].parent.id === p.id);
    const sum = list.reduce((a, x) => a + x.engagement, 0);
    const subs = p.children.map((c) => {
      const l2 = list.filter((x) => x.topic_id === c.id);
      return { id: c.id, title: c.title, posts: l2.length, avg: avg(l2.reduce((a, x) => a + x.engagement, 0), l2.length) };
    }).filter((s) => s.posts);
    return { id: p.id, title: p.title, share: p.share || 0, posts: list.length, actual: tagged.length ? Math.round((list.length / tagged.length) * 100) : 0, avg: avg(sum, list.length), subs };
  });
  const brief = (p) => ({ id: p.id, line: cut(p.message.split('\n')[0], 90), created_time: p.created_time, engagement: p.engagement, reactions: p.reactions, comments: p.comments, shares: p.shares, permalink_url: p.permalink_url, topic: subMap[p.topic_id]?.sub.title || null });
  const sorted = [...posts].sort((a, b) => b.engagement - a.engagement);
  const top = sorted.slice(0, 3).map(brief);
  const low = posts.length > 5 ? sorted.slice(-3).reverse().map(brief) : [];
  const out = { at: t, windows, topics, top, low, tagged: tagged.length, total: posts.length };
  out.text = engagementText(out);
  await env.DB.prepare('INSERT INTO social_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(`engagement:${pageId}`, JSON.stringify(out), t).run();
  return out;
}

// Bản tóm tắt ngắn cho AI (khoảng 150–300 token).
export function engagementText(e) {
  if (!e || !e.total) return '';
  const w = e.windows.map((x) => `${x.days} ngày: ${x.posts} bài, ${x.engagement} tương tác, TB ${x.avg}/bài`).join(' | ');
  const tp = e.topics.filter((x) => x.posts || x.share).map((x) => `- ${x.title} (id ${x.id}): kế hoạch ${x.share}%, thực tế ${x.actual}% (${x.posts} bài), TB ${x.avg} tương tác/bài${x.subs.length ? `; chủ đề con: ${x.subs.map((s) => `${s.title} ${s.posts} bài TB ${s.avg}`).join(', ')}` : ''}`).join('\n');
  const top = e.top.map((p) => `- ${p.engagement} tương tác${p.topic ? ` [${p.topic}]` : ''}: ${p.line}`).join('\n');
  const low = e.low.map((p) => `- ${p.engagement} tương tác${p.topic ? ` [${p.topic}]` : ''}: ${p.line}`).join('\n');
  return [`TƯƠNG TÁC BÀI ĐÃ ĐĂNG: ${w}`, e.tagged ? `Theo chủ đề (30 ngày, ${e.tagged}/${e.total} bài có gắn chủ đề):\n${tp}` : '', top ? `Bài tương tác cao:\n${top}` : '', low ? `Bài tương tác thấp:\n${low}` : ''].filter(Boolean).join('\n');
}
