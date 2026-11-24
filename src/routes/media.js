// Ảnh, video tải lên cho bài đăng. File lưu trong R2 (binding MEDIA) với tên ngẫu nhiên;
// đường dẫn /api/media/file/<tên> công khai để Facebook tải về khi đăng (tên dài, không đoán được).
import { HttpError, json, now } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { allowedPageIds, requireRole } from '../lib/auth.js';

export const MAX_IMAGES = 10;
const LIMITS = {
  image: { max: 10 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] },
  video: { max: 95 * 1024 * 1024, types: ['video/mp4', 'video/quicktime'] }, // Worker gói miễn phí nhận tối đa 100 MB mỗi yêu cầu
};
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

export const mediaEnabled = (env) => !!env.MEDIA;
export const mediaUrl = (request, key) => `${new URL(request.url).origin}/api/media/file/${key}`;

function randomKey(mime) {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return `${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}.${EXT[mime]}`;
}

export function shapeMedia(m) {
  return { id: m.id, kind: m.kind, mime: m.mime, size: m.size, name: m.name, url: `/api/media/file/${m.r2_key}`,
    page_id: m.page_id || null, topic_id: m.topic_id || null, source: m.source || 'upload', note: m.note || '', created_at: m.created_at };
}
const SOURCES = ['upload', 'ai'];

// Trang và chủ đề con gắn với file: phải thuộc Trang được giao; chủ đề phải thuộc Trang đó.
async function cleanLinks(env, user, pageId, topicId) {
  const pid = pageId ? String(pageId) : null;
  if (pid && !(await allowedPageIds(env, user)).includes(pid)) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
  let tid = Math.floor(Number(topicId)) || null;
  if (tid) {
    const t = pid ? await env.DB.prepare('SELECT id FROM social_topics WHERE id = ? AND page_id = ?').bind(tid, pid).first() : null;
    if (!t) tid = null;
  }
  return { pid, tid };
}

// POST /api/media?name=  (thân yêu cầu là chính file, content-type là loại file)
export async function uploadMedia(request, env, user) {
  if (user.role === 'agent') throw new HttpError(403, 'Tài khoản Chăm sóc khách hàng không tải file được', 'forbidden');
  if (!mediaEnabled(env)) throw new HttpError(503, 'Chưa bật kho lưu ảnh, video (Cloudflare R2). Vui lòng liên hệ Chủ hệ thống', 'no_storage');
  const mime = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const kind = LIMITS.image.types.includes(mime) ? 'image' : LIMITS.video.types.includes(mime) ? 'video' : null;
  if (!kind) throw new HttpError(400, 'Chỉ nhận ảnh JPG, PNG, GIF, WEBP hoặc video MP4, MOV', 'bad_type');
  const size = Number(request.headers.get('content-length'));
  if (!size) throw new HttpError(400, 'File rỗng', 'empty');
  if (size > LIMITS[kind].max) throw new HttpError(413, kind === 'image' ? 'Ảnh tối đa 10 MB' : 'Video tối đa 95 MB', 'too_big');
  const q = new URL(request.url).searchParams;
  const name = String(q.get('name') || '').slice(0, 200) || null;
  const { pid, tid } = await cleanLinks(env, user, q.get('page_id'), q.get('topic_id'));
  const source = SOURCES.includes(q.get('source')) ? q.get('source') : 'upload';
  const note = String(q.get('note') || '').slice(0, 1000);
  const key = randomKey(mime);
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' } });
  const t = now();
  const row = await env.DB.prepare(
    'INSERT INTO social_media (r2_key, kind, mime, size, name, page_id, topic_id, source, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING *'
  ).bind(key, kind, mime, size, name, pid, tid, source, note, user.id, t).first();
  await audit(env, request, user.id, 'media_uploaded', name || key, { id: row.id, kind, size });
  return json({ media: shapeMedia(row) }, 201);
}

// GET /api/media/file/:key (công khai, để Facebook và trình duyệt tải về)
export async function mediaFile(request, env, user, key) {
  if (!mediaEnabled(env) || !/^[0-9a-f]{32}\.(jpg|png|gif|webp|mp4|mov)$/.test(key)) throw new HttpError(404, 'Không tìm thấy', 'not_found');
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new HttpError(404, 'Không tìm thấy', 'not_found');
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { headers });
}

// Kiểm tra danh sách id ảnh, video gửi kèm bài: tồn tại, tối đa 10 ảnh hoặc 1 video, không trộn ảnh và video.
export async function loadMediaList(env, ids) {
  if (!ids?.length) return [];
  const marks = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT * FROM social_media WHERE id IN (${marks})`).bind(...ids).all();
  const byId = Object.fromEntries(results.map((m) => [m.id, m]));
  return ids.map((id) => byId[id]).filter(Boolean);
}

export async function cleanMediaIds(env, raw) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new HttpError(400, 'Danh sách ảnh, video không hợp lệ', 'bad_media');
  const ids = [...new Set(raw.map((x) => Math.floor(Number(x))).filter((x) => x > 0))];
  if (!ids.length) return null;
  const list = await loadMediaList(env, ids);
  if (list.length !== ids.length) throw new HttpError(400, 'Có ảnh, video không còn trong kho, vui lòng tải lại', 'bad_media');
  const videos = list.filter((m) => m.kind === 'video').length;
  if (videos > 1 || (videos && list.length > 1)) throw new HttpError(400, 'Mỗi bài chỉ một video, và không kèm ảnh khác', 'bad_media');
  if (list.length > MAX_IMAGES) throw new HttpError(400, `Mỗi bài tối đa ${MAX_IMAGES} ảnh`, 'bad_media');
  return JSON.stringify(ids);
}

// ---------- Kho ảnh, video theo Fanpage ----------
// GET /api/media?page_id=&kind=&topic_id=&q=   (page_id rỗng: file chưa gắn Trang, chỉ Chủ hệ thống, Quản lý)
export async function listMedia(request, env, user) {
  if (user.role === 'agent') throw new HttpError(403, 'Không có quyền', 'forbidden');
  const q = new URL(request.url).searchParams;
  const ids = await allowedPageIds(env, user);
  const pid = q.get('page_id') || '';
  const where = [];
  const args = [];
  if (pid) {
    if (!ids.includes(pid)) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
    where.push('m.page_id = ?'); args.push(pid);
  } else {
    requireRole(user, 'owner', 'manager');
    where.push('m.page_id IS NULL');
  }
  if (['image', 'video'].includes(q.get('kind'))) { where.push('m.kind = ?'); args.push(q.get('kind')); }
  if (SOURCES.includes(q.get('source'))) { where.push('m.source = ?'); args.push(q.get('source')); }
  if (Number(q.get('topic_id'))) { where.push('m.topic_id = ?'); args.push(Number(q.get('topic_id'))); }
  const text = String(q.get('q') || '').trim().slice(0, 80);
  if (text) { where.push("(m.name LIKE ? OR m.note LIKE ?)"); args.push(`%${text}%`, `%${text}%`); }
  const { results } = await env.DB.prepare(
    `SELECT m.*, t.title AS topic_title, u.name AS created_by_name FROM social_media m
     LEFT JOIN social_topics t ON t.id = m.topic_id LEFT JOIN social_users u ON u.id = m.created_by
     WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT 300`
  ).bind(...args).all();
  // Bài đang dùng từng file
  const used = {};
  if (results.length) {
    const marks = results.map(() => '?').join(',');
    const { results: uses } = await env.DB.prepare(
      `SELECT j.value AS mid, c.id, c.status, c.scheduled_at, substr(c.message, 1, 80) AS line FROM social_content c, json_each(c.media_ids) j
       WHERE c.media_ids IS NOT NULL AND j.value IN (${marks}) ORDER BY c.created_at DESC`
    ).bind(...results.map((m) => m.id)).all();
    for (const u of uses) (used[u.mid] ||= []).push({ id: u.id, status: u.status, scheduled_at: u.scheduled_at, line: u.line });
  }
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM social_media m WHERE ${pid ? 'm.page_id = ?' : 'm.page_id IS NULL'}`).bind(...(pid ? [pid] : [])).first();
  return json({
    items: results.map((m) => ({ ...shapeMedia(m), topic_title: m.topic_title || null, created_by_name: m.created_by_name || null, used: used[m.id] || [] })),
    total, enabled: mediaEnabled(env), can_delete: user.role === 'owner' || user.role === 'manager',
  });
}

// PATCH /api/media/:id { name, page_id, topic_id, note }
export async function updateMedia(request, env, user, id) {
  if (user.role === 'agent') throw new HttpError(403, 'Không có quyền', 'forbidden');
  const row = await mediaFor(env, user, id);
  const b = await request.json().catch(() => ({}));
  const pageId = b.page_id === undefined ? row.page_id : b.page_id;
  const { pid, tid } = await cleanLinks(env, user, pageId, b.topic_id === undefined ? row.topic_id : b.topic_id);
  if (!pid && !['owner', 'manager'].includes(user.role)) throw new HttpError(400, 'Vui lòng chọn Fanpage', 'no_page');
  const name = b.name === undefined ? row.name : String(b.name || '').slice(0, 200) || null;
  const note = b.note === undefined ? row.note : String(b.note || '').slice(0, 1000);
  await env.DB.prepare('UPDATE social_media SET name = ?, page_id = ?, topic_id = ?, note = ? WHERE id = ?').bind(name, pid, tid, note, row.id).run();
  await audit(env, request, user.id, 'media_updated', name || row.r2_key, { id: row.id });
  return json({ ok: true });
}

// DELETE /api/media/:id: chỉ xóa được file chưa gắn vào bài nào
export async function deleteMedia(request, env, user, id) {
  requireRole(user, 'owner', 'manager');
  const row = await mediaFor(env, user, id);
  const use = await env.DB.prepare('SELECT COUNT(*) AS n FROM social_content c, json_each(c.media_ids) j WHERE c.media_ids IS NOT NULL AND j.value = ?').bind(row.id).first();
  if (use.n) throw new HttpError(409, `File đang dùng trong ${use.n} bài, vui lòng bỏ khỏi bài trước khi xóa`, 'in_use');
  if (mediaEnabled(env)) await env.MEDIA.delete(row.r2_key);
  await env.DB.prepare('DELETE FROM social_media WHERE id = ?').bind(row.id).run();
  await audit(env, request, user.id, 'media_deleted', row.name || row.r2_key, { id: row.id });
  return json({ ok: true });
}

async function mediaFor(env, user, id) {
  const row = await env.DB.prepare('SELECT * FROM social_media WHERE id = ?').bind(Math.floor(Number(id)) || 0).first();
  if (!row) throw new HttpError(404, 'Không tìm thấy file', 'not_found');
  if (row.page_id ? !(await allowedPageIds(env, user)).includes(row.page_id) : !['owner', 'manager'].includes(user.role)) throw new HttpError(404, 'Không tìm thấy file', 'not_found');
  return row;
}
