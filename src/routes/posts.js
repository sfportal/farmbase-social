// Bài đăng của Fanpage và số tương tác (cảm xúc, bình luận, chia sẻ), đọc trực tiếp từ Facebook.
// Chỉ đọc, không ghi gì lên Facebook. Quyền: Fanpage được giao (allowedPageIds).
import { decryptSecret } from '../lib/crypto.js';
import { HttpError, json, now } from '../lib/http.js';
import { allowedPageIds } from '../lib/auth.js';
import { graph } from './facebook.js';

const POST_FIELDS = [
  'id', 'message', 'story', 'created_time', 'permalink_url', 'full_picture', 'status_type', 'shares',
  'reactions.summary(total_count).limit(0)',
  'comments.summary(total_count).filter(stream).limit(0)',
].join(',');

const MAX_PAGES_ALL = 20; // gói miễn phí giới hạn 50 yêu cầu con mỗi lượt

function shape(p, page) {
  const reactions = p.reactions?.summary?.total_count ?? 0;
  const comments = p.comments?.summary?.total_count ?? 0;
  const shares = p.shares?.count ?? 0;
  const text = p.message || p.story || '';
  return {
    id: p.id,
    page_id: page.id,
    page_name: page.name,
    page_picture: page.picture_url,
    message: text.length > 400 ? `${text.slice(0, 400)}…` : text,
    created_time: p.created_time ? Math.floor(Date.parse(p.created_time) / 1000) : null,
    permalink_url: p.permalink_url || null,
    picture: p.full_picture || null,
    type: p.status_type || null,
    reactions, comments, shares,
    engagement: reactions + comments + shares,
  };
}

async function fetchPagePosts(env, page, { limit, after }) {
  if (!page.access_token_enc) throw new HttpError(409, `Fanpage "${page.name}" chưa có mã truy cập, vui lòng kết nối lại`, 'no_token');
  const token = await decryptSecret(page.access_token_enc, env.TOKEN_KEY);
  const params = { access_token: token, fields: POST_FIELDS, limit: String(limit) };
  if (after) params.after = after;
  try {
    const data = await graph(env, `${page.id}/posts`, params);
    return { posts: (data.data || []).map((p) => shape(p, page)), after: data.paging?.next ? data.paging?.cursors?.after || null : null };
  } catch (e) {
    // Mã hết hạn hoặc bị thu hồi: đánh dấu Fanpage lỗi để Chủ hệ thống kết nối lại.
    if (e.fb?.code === 190 || e.fb?.code === 102) {
      await env.DB.prepare("UPDATE social_pages SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?")
        .bind(String(e.message).slice(0, 500), now(), page.id).run();
    }
    throw e;
  }
}

async function loadPages(env, ids) {
  const marks = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, name, picture_url, access_token_enc, status FROM social_pages WHERE id IN (${marks}) ORDER BY name`
  ).bind(...ids).all();
  return results;
}

// GET /api/pages/:id/posts?after=&limit=
export async function pagePosts(request, env, user, pageId) {
  const ids = await allowedPageIds(env, user);
  if (!ids.includes(pageId)) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
  const q = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(q.get('limit')) || 25, 1), 50);
  const [page] = await loadPages(env, [pageId]);
  const { posts, after } = await fetchPagePosts(env, page, { limit, after: q.get('after') || '' });
  return json({ posts, after });
}

// GET /api/posts?limit= : bài mới nhất của mọi Fanpage được giao, gộp theo thời gian.
export async function allPosts(request, env, user) {
  const ids = await allowedPageIds(env, user);
  if (!ids.length) return json({ posts: [], errors: [] });
  const q = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(q.get('limit')) || 10, 1), 25);
  const pages = (await loadPages(env, ids)).filter((p) => p.access_token_enc).slice(0, MAX_PAGES_ALL);
  const settled = await Promise.allSettled(pages.map((p) => fetchPagePosts(env, p, { limit })));
  const posts = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') posts.push(...r.value.posts);
    else errors.push({ page_id: pages[i].id, page_name: pages[i].name, message: r.reason?.message || 'Lỗi' });
  });
  posts.sort((a, b) => (b.created_time || 0) - (a.created_time || 0));
  return json({ posts, errors, truncated: ids.length > MAX_PAGES_ALL });
}
