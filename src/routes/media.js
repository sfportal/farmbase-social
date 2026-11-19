// Ảnh, video tải lên cho bài đăng. File lưu trong R2 (binding MEDIA) với tên ngẫu nhiên;
// đường dẫn /api/media/file/<tên> công khai để Facebook tải về khi đăng (tên dài, không đoán được).
import { HttpError, json, now } from '../lib/http.js';
import { audit } from '../lib/audit.js';

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
  return { id: m.id, kind: m.kind, mime: m.mime, size: m.size, name: m.name, url: `/api/media/file/${m.r2_key}` };
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
  const name = String(new URL(request.url).searchParams.get('name') || '').slice(0, 200) || null;
  const key = randomKey(mime);
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' } });
  const t = now();
  const row = await env.DB.prepare(
    'INSERT INTO social_media (r2_key, kind, mime, size, name, created_by, created_at) VALUES (?,?,?,?,?,?,?) RETURNING *'
  ).bind(key, kind, mime, size, name, user.id, t).first();
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
