// Lịch nội dung: soạn bài, gửi duyệt, duyệt rồi đăng ngay hoặc hẹn giờ bằng lịch của chính Facebook
// (Facebook tự đăng đúng giờ, nên hệ thống không cần chạy nền, vừa gói Cloudflare miễn phí).
import { decryptSecret } from '../lib/crypto.js';
import { HttpError, json, readJson, now } from '../lib/http.js';
import { requireRole, allowedPageIds } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { graphBase } from './facebook.js';
import { mediaEnabled, mediaUrl, shapeMedia, loadMediaList, cleanMediaIds } from './media.js';

const MIN_SCHEDULE = 10 * 60;        // Facebook chỉ nhận hẹn giờ cách hiện tại ít nhất 10 phút
const MAX_SCHEDULE = 30 * 86400;     // giới hạn 30 ngày cho an toàn
const MAX_MESSAGE = 5000;
const EDITABLE = ['draft', 'pending', 'rejected', 'failed'];
const isManager = (u) => u.role === 'owner' || u.role === 'manager';

function cleanUrl(v, label) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, `${label} không hợp lệ`, 'bad_url'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, `${label} phải bắt đầu bằng https://`, 'bad_url');
  if (s.length > 1000) throw new HttpError(400, `${label} quá dài`, 'bad_url');
  return s;
}

function cleanFields(body, t, hasMedia = false) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length > MAX_MESSAGE) throw new HttpError(400, `Nội dung tối đa ${MAX_MESSAGE} ký tự`, 'too_long');
  const link = cleanUrl(body.link, 'Liên kết');
  const image_url = cleanUrl(body.image_url, 'Địa chỉ ảnh');
  if (!message && !image_url && !link && !hasMedia) throw new HttpError(400, 'Vui lòng nhập nội dung, liên kết hoặc ảnh', 'empty');
  let scheduled_at = null;
  if (body.scheduled_at !== undefined && body.scheduled_at !== null && body.scheduled_at !== '') {
    scheduled_at = Math.floor(Number(body.scheduled_at));
    if (!Number.isFinite(scheduled_at)) throw new HttpError(400, 'Thời gian đăng không hợp lệ', 'bad_time');
    if (scheduled_at > t + MAX_SCHEDULE) throw new HttpError(400, 'Chỉ hẹn giờ trong vòng 30 ngày tới', 'bad_time');
  }
  return { message, link, image_url, scheduled_at };
}

const SELECT = `SELECT c.*, p.name AS page_name, p.picture_url AS page_picture,
    cu.name AS created_by_name, cu.email AS created_by_email, au.name AS approved_by_name
  FROM social_content c JOIN social_pages p ON p.id = c.page_id
  LEFT JOIN social_users cu ON cu.id = c.created_by LEFT JOIN social_users au ON au.id = c.approved_by`;

function shape(row, t) {
  // Bài hẹn giờ trên Facebook: quá giờ hẹn thì Facebook đã tự đăng.
  const live = row.status === 'scheduled' && row.scheduled_at && row.scheduled_at <= t;
  return {
    id: row.id, page_id: row.page_id, page_name: row.page_name, page_picture: row.page_picture,
    message: row.message, link: row.link, image_url: row.image_url, scheduled_at: row.scheduled_at,
    media: row._media || [],
    status: live ? 'published' : row.status, published_at: live ? row.scheduled_at : row.published_at,
    fb_post_id: row.fb_post_id, reject_reason: row.reject_reason, last_error: row.last_error,
    created_by: row.created_by, created_by_name: row.created_by_name || row.created_by_email,
    approved_by_name: row.approved_by_name, created_at: row.created_at, updated_at: row.updated_at,
  };
}

const parseIds = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

// Gắn danh sách ảnh, video vào mỗi bài (một truy vấn cho cả danh sách).
async function attachMedia(env, rows) {
  const all = [...new Set(rows.flatMap((r) => parseIds(r.media_ids)))];
  if (!all.length) return rows;
  const byId = Object.fromEntries((await loadMediaList(env, all)).map((m) => [m.id, shapeMedia(m)]));
  for (const r of rows) r._media = parseIds(r.media_ids).map((id) => byId[id]).filter(Boolean);
  return rows;
}

async function loadItem(env, user, id) {
  const row = await env.DB.prepare(`${SELECT} WHERE c.id = ?`).bind(Number(id)).first();
  const ids = await allowedPageIds(env, user);
  if (!row || !ids.includes(row.page_id)) throw new HttpError(404, 'Không tìm thấy bài', 'not_found');
  await attachMedia(env, [row]);
  return row;
}

function canEdit(user, row) {
  if (user.role === 'agent') return false;
  if (isManager(user)) return true;
  return row.created_by === user.id;
}

// GET /api/content?status=&page_id=
export async function listContent(request, env, user) {
  const ids = await allowedPageIds(env, user);
  if (!ids.length) return json({ items: [], counts: {}, media_enabled: mediaEnabled(env) });
  const q = new URL(request.url).searchParams;
  const t = now();
  const marks = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `${SELECT} WHERE c.page_id IN (${marks}) ORDER BY COALESCE(c.scheduled_at, c.published_at, c.created_at) DESC LIMIT 300`
  ).bind(...ids).all();
  await attachMedia(env, results);
  let items = results.map((r) => shape(r, t));
  const counts = {};
  for (const i of items) counts[i.status] = (counts[i.status] || 0) + 1;
  if (q.get('page_id')) items = items.filter((i) => i.page_id === q.get('page_id'));
  if (q.get('status')) items = items.filter((i) => i.status === q.get('status'));
  return json({ items, counts, can_create: user.role !== 'agent', can_approve: isManager(user), media_enabled: mediaEnabled(env) });
}

// POST /api/content  { page_ids[], message, link, image_url, scheduled_at, action: draft|submit|publish }
export async function createContent(request, env, user) {
  if (user.role === 'agent') throw new HttpError(403, 'Tài khoản Chăm sóc khách hàng không soạn bài được', 'forbidden');
  const body = await readJson(request);
  const t = now();
  const mediaIds = await cleanMediaIds(env, body.media_ids);
  const f = cleanFields(body, t, !!mediaIds);
  const action = ['draft', 'submit', 'publish'].includes(body.action) ? body.action : 'draft';
  if (action === 'publish' && !isManager(user)) throw new HttpError(403, 'Chỉ Quản lý hoặc Chủ hệ thống được đăng bài', 'forbidden');
  const allowed = await allowedPageIds(env, user);
  const pageIds = [...new Set(Array.isArray(body.page_ids) ? body.page_ids.map(String) : [])];
  if (!pageIds.length) throw new HttpError(400, 'Vui lòng chọn ít nhất một Fanpage', 'no_page');
  if (pageIds.length > 20) throw new HttpError(400, 'Mỗi lần tối đa 20 Fanpage', 'too_many');
  if (pageIds.some((p) => !allowed.includes(p))) throw new HttpError(400, 'Có Fanpage không được giao cho Quý khách', 'bad_page');

  const status = action === 'submit' ? 'pending' : 'draft';
  const created = [];
  for (const pageId of pageIds) {
    const r = await env.DB.prepare(
      `INSERT INTO social_content (page_id, message, link, image_url, media_ids, scheduled_at, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`
    ).bind(pageId, f.message, f.link, f.image_url, mediaIds, f.scheduled_at, status, user.id, t, t).first();
    created.push(r.id);
  }
  await audit(env, request, user.id, action === 'submit' ? 'post_submitted' : 'post_created', snippet(f.message), { ids: created, pages: pageIds });

  const items = [];
  for (const id of created) {
    if (action === 'publish') items.push(await publishItem(env, request, user, await loadItem(env, user, id)));
    else items.push(shape(await loadItem(env, user, id), t));
  }
  return json({ items }, 201);
}

// PATCH /api/content/:id
export async function updateContent(request, env, user, id) {
  const row = await loadItem(env, user, id);
  if (!canEdit(user, row)) throw new HttpError(403, 'Quý khách chỉ sửa được bài của mình', 'forbidden');
  if (row.status === 'scheduled') return updateScheduled(request, env, user, row);
  if (!EDITABLE.includes(row.status)) throw new HttpError(409, 'Bài đã đăng hoặc đã hẹn giờ, không sửa được. Hủy lịch trước nếu cần sửa', 'locked');
  const body = await readJson(request);
  const t = now();
  const mediaIds = body.media_ids === undefined ? row.media_ids : await cleanMediaIds(env, body.media_ids);
  const f = cleanFields(body, t, !!mediaIds);
  // Biên tập viên sửa bài đang chờ duyệt hoặc bị từ chối: quay về nháp để gửi duyệt lại.
  const status = isManager(user) ? row.status : 'draft';
  await env.DB.prepare(
    'UPDATE social_content SET message = ?, link = ?, image_url = ?, media_ids = ?, scheduled_at = ?, status = ?, reject_reason = NULL, updated_at = ? WHERE id = ?'
  ).bind(f.message, f.link, f.image_url, mediaIds, f.scheduled_at, status, t, row.id).run();
  await audit(env, request, user.id, 'post_updated', snippet(f.message), { id: row.id });
  return json({ item: shape(await loadItem(env, user, row.id), t) });
}

// Sửa bài đã hẹn giờ trên Facebook (chưa tới giờ đăng): tạo lịch mới với nội dung mới trước, rồi gỡ lịch cũ,
// để không bao giờ mất bài khỏi lịch. Chỉ Chủ hệ thống, Quản lý (người được duyệt đăng).
async function updateScheduled(request, env, user, row) {
  if (!isManager(user)) throw new HttpError(403, 'Chỉ Chủ hệ thống hoặc Quản lý sửa được bài đã hẹn giờ', 'forbidden');
  const t = now();
  if (!row.scheduled_at || row.scheduled_at <= t) throw new HttpError(409, 'Bài đã tới giờ đăng, không sửa được nữa', 'locked');
  const body = await readJson(request);
  const mediaIds = body.media_ids === undefined ? row.media_ids : await cleanMediaIds(env, body.media_ids);
  const f = cleanFields(body, t, !!mediaIds);
  if (!f.scheduled_at || f.scheduled_at < t + MIN_SCHEDULE) {
    throw new HttpError(400, 'Bài hẹn giờ cần giờ đăng cách hiện tại ít nhất 10 phút. Muốn đăng ngay, bấm Hủy lịch rồi Duyệt và đăng.', 'bad_time');
  }
  const next = { ...row, message: f.message, link: f.link, image_url: f.image_url, media_ids: mediaIds, scheduled_at: f.scheduled_at };
  const token = await pageToken(env, row.page_id);
  const data = await sendToFacebook(env, request, next, token, true);
  const newId = data.post_id || data.id;
  if (row.fb_post_id) {
    try { await fbCall(env, 'DELETE', row.fb_post_id, { access_token: token }); } catch (e) {
      try { await fbCall(env, 'DELETE', newId, { access_token: token }); } catch { /* bỏ qua */ }
      throw new HttpError(502, `Không gỡ được lịch cũ trên Facebook nên giữ nguyên bài cũ: ${e.message}`, 'facebook');
    }
  }
  await env.DB.prepare(
    'UPDATE social_content SET message = ?, link = ?, image_url = ?, media_ids = ?, scheduled_at = ?, fb_post_id = ?, last_error = NULL, updated_at = ? WHERE id = ?'
  ).bind(f.message, f.link, f.image_url, mediaIds, f.scheduled_at, newId, t, row.id).run();
  await audit(env, request, user.id, 'post_rescheduled', snippet(f.message), { id: row.id, page: row.page_name, fb_post_id: newId, old_fb_post_id: row.fb_post_id });
  return json({ item: shape(await loadItem(env, user, row.id), t) });
}

// POST /api/content/:id/submit
export async function submitContent(request, env, user, id) {
  const row = await loadItem(env, user, id);
  if (!canEdit(user, row)) throw new HttpError(403, 'Quý khách chỉ gửi duyệt được bài của mình', 'forbidden');
  if (!['draft', 'rejected'].includes(row.status)) throw new HttpError(409, 'Bài này không ở trạng thái nháp', 'bad_status');
  await env.DB.prepare("UPDATE social_content SET status = 'pending', reject_reason = NULL, updated_at = ? WHERE id = ?").bind(now(), row.id).run();
  await audit(env, request, user.id, 'post_submitted', snippet(row.message), { id: row.id });
  return json({ item: shape(await loadItem(env, user, row.id), now()) });
}

// POST /api/content/:id/reject { reason }
export async function rejectContent(request, env, user, id) {
  requireRole(user, 'owner', 'manager');
  const row = await loadItem(env, user, id);
  if (row.status !== 'pending') throw new HttpError(409, 'Chỉ từ chối được bài đang chờ duyệt', 'bad_status');
  const body = await readJson(request);
  const reason = String(body.reason || '').trim().slice(0, 500);
  await env.DB.prepare("UPDATE social_content SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?").bind(reason || null, now(), row.id).run();
  await audit(env, request, user.id, 'post_rejected', snippet(row.message), { id: row.id, reason });
  return json({ item: shape(await loadItem(env, user, row.id), now()) });
}

// POST /api/content/:id/approve { page_ids?, scheduled_at? } : duyệt và đăng (ngay hoặc hẹn giờ trên Facebook).
// Người duyệt có thể chọn lại Fanpage (một hoặc nhiều) và giờ đăng ngay ở bước này.
export async function approveContent(request, env, user, id) {
  requireRole(user, 'owner', 'manager');
  const row = await loadItem(env, user, id);
  if (!['pending', 'draft', 'rejected', 'failed'].includes(row.status)) throw new HttpError(409, 'Bài đã đăng hoặc đã hẹn giờ', 'bad_status');
  const text = await request.text();
  let body = {};
  if (text.trim()) {
    try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Dữ liệu gửi lên không hợp lệ', 'bad_json'); }
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Dữ liệu gửi lên không hợp lệ', 'bad_json');
  }
  const t = now();
  let pageIds = [row.page_id];
  if (body.page_ids !== undefined) {
    const allowed = await allowedPageIds(env, user);
    pageIds = [...new Set(Array.isArray(body.page_ids) ? body.page_ids.map(String) : [])];
    if (!pageIds.length) throw new HttpError(400, 'Vui lòng chọn ít nhất một Fanpage', 'no_page');
    if (pageIds.length > 20) throw new HttpError(400, 'Mỗi lần tối đa 20 Fanpage', 'too_many');
    if (pageIds.some((p) => !allowed.includes(p))) throw new HttpError(400, 'Có Fanpage không được giao cho Quý khách', 'bad_page');
  }
  let scheduledAt = row.scheduled_at;
  if (body.scheduled_at !== undefined) {
    scheduledAt = cleanFields({ message: row.message, link: row.link, image_url: row.image_url, scheduled_at: body.scheduled_at }, t, true).scheduled_at;
  }
  // Trang đầu tiên dùng chính bài này; mỗi Trang thêm tạo một bản sao rồi đăng cùng lúc.
  const [first, ...extra] = pageIds;
  await env.DB.prepare('UPDATE social_content SET page_id = ?, scheduled_at = ?, updated_at = ? WHERE id = ?').bind(first, scheduledAt, t, row.id).run();
  const ids = [row.id];
  for (const pageId of extra) {
    const r = await env.DB.prepare(
      `INSERT INTO social_content (page_id, message, link, image_url, media_ids, scheduled_at, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'pending',?,?,?) RETURNING id`
    ).bind(pageId, row.message, row.link, row.image_url, row.media_ids, scheduledAt, row.created_by, t, t).first();
    ids.push(r.id);
  }
  const items = [];
  for (const cid of ids) items.push(await publishItem(env, request, user, await loadItem(env, user, cid)));
  return json({ item: items[0], items });
}

// POST /api/content/:id/cancel : hủy lịch đã hẹn trên Facebook, bài quay về nháp
export async function cancelContent(request, env, user, id) {
  requireRole(user, 'owner', 'manager');
  const row = await loadItem(env, user, id);
  const t = now();
  if (row.status !== 'scheduled' || (row.scheduled_at && row.scheduled_at <= t)) throw new HttpError(409, 'Chỉ hủy được bài đang hẹn giờ chưa tới giờ đăng', 'bad_status');
  if (row.fb_post_id) {
    const token = await pageToken(env, row.page_id);
    await fbCall(env, 'DELETE', row.fb_post_id, { access_token: token });
  }
  await env.DB.prepare("UPDATE social_content SET status = 'draft', fb_post_id = NULL, approved_by = NULL, updated_at = ? WHERE id = ?").bind(t, row.id).run();
  await audit(env, request, user.id, 'post_cancelled', snippet(row.message), { id: row.id });
  return json({ item: shape(await loadItem(env, user, row.id), t) });
}

// DELETE /api/content/:id : xóa bài chưa lên Facebook (nháp, chờ duyệt, bị từ chối, lỗi)
export async function deleteContent(request, env, user, id) {
  const row = await loadItem(env, user, id);
  if (!canEdit(user, row)) throw new HttpError(403, 'Quý khách chỉ xóa được bài của mình', 'forbidden');
  if (!EDITABLE.includes(row.status)) throw new HttpError(409, 'Bài đã lên Facebook, không xóa ở đây được', 'locked');
  await env.DB.prepare('DELETE FROM social_content WHERE id = ?').bind(row.id).run();
  await audit(env, request, user.id, 'post_deleted', snippet(row.message), { id: row.id });
  return json({ ok: true });
}

// ---------- Gọi Facebook ----------
const snippet = (s) => (s || '').replace(/\s+/g, ' ').slice(0, 80) || '(ảnh/liên kết)';

async function pageToken(env, pageId) {
  const page = await env.DB.prepare('SELECT access_token_enc, status FROM social_pages WHERE id = ?').bind(pageId).first();
  if (!page?.access_token_enc || page.status === 'disconnected') throw new HttpError(409, 'Fanpage chưa kết nối, vui lòng kết nối lại', 'no_token');
  return decryptSecret(page.access_token_enc, env.TOKEN_KEY);
}

async function fbCall(env, method, path, params, base = graphBase(env)) {
  const url = `${base}/${path}`;
  const body = new URLSearchParams(params);
  const res = method === 'DELETE' ? await fetch(`${url}?${body}`, { method }) : await fetch(url, { method, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new HttpError(502, data.error?.message || `Facebook trả lỗi ${res.status}`, 'facebook');
    err.fb = data.error;
    throw err;
  }
  return data;
}

// Gửi bài lên Facebook theo loại: chữ/liên kết, 1 ảnh, nhiều ảnh, hoặc video. Hẹn giờ thì Facebook tự đăng.
async function sendToFacebook(env, request, row, token, scheduled) {
  const sched = scheduled ? { published: 'false', scheduled_publish_time: String(row.scheduled_at) } : {};
  const caption = [row.message, row.link].filter(Boolean).join('\n\n');
  const media = await loadMediaList(env, parseIds(row.media_ids));
  const images = media.filter((m) => m.kind === 'image').map((m) => mediaUrl(request, m.r2_key));
  const video = media.find((m) => m.kind === 'video');
  if (!images.length && row.image_url) images.push(row.image_url);

  if (video) {
    if (!mediaEnabled(env)) throw new HttpError(503, 'Chưa bật kho lưu ảnh, video', 'no_storage');
    const params = { access_token: token, file_url: mediaUrl(request, video.r2_key), ...sched };
    if (caption) params.description = caption;
    const d = await fbCall(env, 'POST', `${row.page_id}/videos`, params, videoBase(env));
    return { id: d.id }; // id video: dùng để xem và hủy lịch (DELETE /{video_id})
  }
  if (images.length === 1) {
    const params = { access_token: token, url: images[0], ...sched };
    if (caption) params.caption = caption;
    return fbCall(env, 'POST', `${row.page_id}/photos`, params);
  }
  if (images.length > 1) {
    // Nhiều ảnh: tải từng ảnh lên ở chế độ chưa đăng, rồi tạo một bài gắn tất cả ảnh.
    const params = { access_token: token, ...sched };
    for (let i = 0; i < images.length; i++) {
      const p = await fbCall(env, 'POST', `${row.page_id}/photos`, { access_token: token, url: images[i], published: 'false', ...(scheduled ? { temporary: 'true' } : {}) });
      params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: p.id });
    }
    if (caption) params.message = caption;
    return fbCall(env, 'POST', `${row.page_id}/feed`, params);
  }
  const params = { access_token: token, ...sched };
  if (row.message) params.message = row.message;
  if (row.link) params.link = row.link;
  return fbCall(env, 'POST', `${row.page_id}/feed`, params);
}

// Video tải lên qua máy chủ riêng graph-video của Facebook.
const videoBase = (env) => (env.FB_GRAPH_BASE ? graphBase(env) : graphBase(env).replace('://graph.facebook.com', '://graph-video.facebook.com'));

async function publishItem(env, request, user, row) {
  const t = now();
  const scheduled = row.scheduled_at && row.scheduled_at > t + MIN_SCHEDULE;
  if (row.scheduled_at && row.scheduled_at > t + MAX_SCHEDULE) throw new HttpError(400, 'Chỉ hẹn giờ trong vòng 30 ngày tới', 'bad_time');
  try {
    const token = await pageToken(env, row.page_id);
    const data = await sendToFacebook(env, request, row, token, scheduled);
    const fbId = data.post_id || data.id;
    await env.DB.prepare(
      'UPDATE social_content SET status = ?, fb_post_id = ?, published_at = ?, approved_by = ?, last_error = NULL, reject_reason = NULL, updated_at = ? WHERE id = ?'
    ).bind(scheduled ? 'scheduled' : 'published', fbId, scheduled ? null : t, user.id, t, row.id).run();
    await audit(env, request, user.id, scheduled ? 'post_scheduled' : 'post_published', snippet(row.message), { id: row.id, page: row.page_name, fb_post_id: fbId });
  } catch (e) {
    await env.DB.prepare("UPDATE social_content SET status = 'failed', last_error = ?, approved_by = ?, updated_at = ? WHERE id = ?")
      .bind(String(e.message).slice(0, 500), user.id, t, row.id).run();
    await audit(env, request, user.id, 'post_publish_failed', snippet(row.message), { id: row.id, page: row.page_name, message: e.message });
  }
  return shape(await loadItem(env, user, row.id), now());
}
