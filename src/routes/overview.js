// Tổng quan: số liệu hộp thư theo từng Fanpage (chỉ đọc D1, không gọi Facebook nên mở nhanh).
import { json, now } from '../lib/http.js';
import { allowedPageIds } from '../lib/auth.js';

const DAY = 86400;

// GET /api/overview
export async function overview(request, env, user) {
  const ids = await allowedPageIds(env, user);
  if (!ids.length) return json({ pages: {} });
  const marks = ids.map(() => '?').join(',');
  const since = now() - 7 * DAY;
  const conv = await env.DB.prepare(
    `SELECT page_id, COALESCE(SUM(unread), 0) AS unread,
       SUM(CASE WHEN last_in_at IS NOT NULL AND last_in_at >= last_at AND last_at >= ? THEN 1 ELSE 0 END) AS waiting
     FROM social_conversations WHERE page_id IN (${marks}) GROUP BY page_id`
  ).bind(since, ...ids).all();
  const msgs = await env.DB.prepare(
    `SELECT c.page_id,
       SUM(CASE WHEN m.direction = 'in' AND m.channel = 'message' THEN 1 ELSE 0 END) AS msg_in,
       SUM(CASE WHEN m.direction = 'in' AND m.channel = 'comment' THEN 1 ELSE 0 END) AS cmt_in,
       SUM(CASE WHEN m.direction = 'out' THEN 1 ELSE 0 END) AS replies
     FROM social_messages m JOIN social_conversations c ON c.id = m.conversation_id
     WHERE c.page_id IN (${marks}) AND m.created_at >= ? GROUP BY c.page_id`
  ).bind(...ids, since).all();
  const pages = {};
  for (const id of ids) pages[id] = { unread: 0, waiting: 0, msg_in: 0, cmt_in: 0, replies: 0 };
  for (const r of conv.results) Object.assign(pages[r.page_id], { unread: r.unread || 0, waiting: r.waiting || 0 });
  for (const r of msgs.results) Object.assign(pages[r.page_id], { msg_in: r.msg_in || 0, cmt_in: r.cmt_in || 0, replies: r.replies || 0 });
  return json({ pages, since });
}
