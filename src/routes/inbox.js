// Hộp thư chung: nhận tin nhắn Messenger và bình luận qua webhook, trả lời từ hệ thống, trả lời tự động khi khách bình luận.
import { decryptSecret } from '../lib/crypto.js';
import { HttpError, json, readJson, now } from '../lib/http.js';
import { requireRole, allowedPageIds } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { graph, graphBase } from './facebook.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const DAY = 86400;
const MAX_TEXT = 2000;

async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}

// Mã xác minh webhook: suy ra từ TOKEN_KEY nên không cần thêm biến bí mật. Chỉ Chủ hệ thống xem được.
export const verifyToken = async (env) => (env.TOKEN_KEY ? (await hmac(env.TOKEN_KEY, 'fb-webhook-verify')).slice(0, 32) : '');

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Gọi Graph API dạng POST (tham số dạng form; giá trị đối tượng gửi dưới dạng JSON).
async function fbPost(env, path, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const res = await fetch(`${graphBase(env)}/${path}`, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new HttpError(502, fbMessage(data.error) || `Facebook trả lỗi ${res.status}`, 'facebook');
    err.fb = data.error;
    throw err;
  }
  return data;
}

// Diễn giải lỗi Facebook thường gặp sang tiếng Việt.
function fbMessage(e) {
  if (!e) return '';
  if (e.code === 10 && e.error_subcode === 2018278) return 'Đã quá 24 giờ kể từ tin nhắn cuối của khách, Facebook không cho gửi thêm';
  if (e.code === 10 || e.error_subcode === 2018108) return 'Facebook không cho gửi tin này (quá hạn hoặc bình luận đã được nhắn riêng)';
  if (e.code === 551) return 'Khách hiện không nhận tin nhắn từ Trang';
  return e.message;
}

async function pageToken(env, pageId) {
  const p = await env.DB.prepare("SELECT access_token_enc FROM social_pages WHERE id = ? AND status != 'disconnected'").bind(pageId).first();
  if (!p?.access_token_enc) throw new HttpError(409, 'Fanpage chưa kết nối hoặc đã ngắt', 'no_token');
  return decryptSecret(p.access_token_enc, env.TOKEN_KEY);
}

// ---------- Cài đặt trả lời tự động ----------
const AUTO_DEFAULT = { enabled: false, message: '', public_enabled: false, public_text: '' };

async function getAuto(env, pageId) {
  const row = await env.DB.prepare('SELECT value FROM social_settings WHERE key = ?').bind(`autoreply:${pageId}`).first();
  try { return { ...AUTO_DEFAULT, ...(row ? JSON.parse(row.value) : {}) }; } catch { return { ...AUTO_DEFAULT }; }
}

async function checkPage(env, user, pageId) {
  const ids = await allowedPageIds(env, user);
  if (!ids.includes(pageId)) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
}

// GET /api/pages/:id/autoreply
export async function readAutoReply(request, env, user, pageId) {
  await checkPage(env, user, pageId);
  return json({ autoreply: await getAuto(env, pageId), can_edit: user.role === 'owner' || user.role === 'manager' });
}

// PUT /api/pages/:id/autoreply { enabled, message, public_enabled, public_text }
export async function saveAutoReply(request, env, user, pageId) {
  requireRole(user, 'owner', 'manager');
  await checkPage(env, user, pageId);
  const b = await readJson(request);
  const v = {
    enabled: !!b.enabled,
    message: typeof b.message === 'string' ? b.message.trim().slice(0, MAX_TEXT) : '',
    public_enabled: !!b.public_enabled,
    public_text: typeof b.public_text === 'string' ? b.public_text.trim().slice(0, 1000) : '',
  };
  if (v.enabled && !v.message) throw new HttpError(400, 'Vui lòng nhập nội dung tin nhắn tự động', 'empty');
  if (v.public_enabled && !v.public_text) throw new HttpError(400, 'Vui lòng nhập nội dung trả lời bình luận', 'empty');
  const t = now();
  await env.DB.prepare(
    'INSERT INTO social_settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at'
  ).bind(`autoreply:${pageId}`, JSON.stringify(v), user.id, t).run();
  await audit(env, request, user.id, 'autoreply_updated', pageId, { enabled: v.enabled, public_enabled: v.public_enabled });
  return json({ autoreply: v });
}

// ---------- Webhook ----------
// GET /api/fb/webhook: Facebook xác minh địa chỉ webhook.
export async function webhookVerify(request, env) {
  const q = new URL(request.url).searchParams;
  const token = await verifyToken(env);
  if (q.get('hub.mode') === 'subscribe' && token && safeEqual(q.get('hub.verify_token') || '', token)) {
    return new Response(q.get('hub.challenge') || '', { headers: { 'content-type': 'text/plain' } });
  }
  return new Response('forbidden', { status: 403 });
}

// POST /api/fb/webhook: Facebook gửi tin nhắn và bình luận mới. Kiểm tra chữ ký bằng FB_APP_SECRET.
export async function webhookReceive(request, env) {
  const raw = await request.text();
  const sig = (request.headers.get('x-hub-signature-256') || '').replace(/^sha256=/, '');
  if (!env.FB_APP_SECRET || !sig || !safeEqual(sig, await hmac(env.FB_APP_SECRET, raw))) {
    return new Response('bad signature', { status: 403 });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  if (body.object !== 'page') return new Response('ok');
  for (const entry of body.entry || []) {
    const pageId = String(entry.id || '');
    const page = await env.DB.prepare("SELECT id FROM social_pages WHERE id = ? AND status = 'active'").bind(pageId).first();
    if (!page) continue;
    for (const ev of entry.messaging || []) {
      try { await onMessage(env, pageId, ev); } catch (e) { console.error('webhook message', e.message); }
    }
    for (const ch of entry.changes || []) {
      if (ch.field !== 'feed' || ch.value?.item !== 'comment' || ch.value?.verb !== 'add') continue;
      try { await onComment(env, request, pageId, ch.value); } catch (e) { console.error('webhook comment', e.message); }
    }
  }
  return new Response('ok');
}

async function upsertConversation(env, pageId, kind, customerId, name, text, at, incoming) {
  await env.DB.prepare(
    `INSERT INTO social_conversations (page_id, kind, customer_id, customer_name, last_text, last_at, last_in_at, unread, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(page_id, kind, customer_id) DO UPDATE SET
       customer_name = COALESCE(excluded.customer_name, customer_name),
       last_text = excluded.last_text, last_at = MAX(last_at, excluded.last_at),
       last_in_at = COALESCE(excluded.last_in_at, last_in_at),
       unread = unread + excluded.unread`
  ).bind(pageId, kind, customerId, name || null, (text || '').slice(0, 300), at, incoming ? at : null, incoming ? 1 : 0, now()).run();
  return env.DB.prepare('SELECT * FROM social_conversations WHERE page_id = ? AND kind = ? AND customer_id = ?').bind(pageId, kind, customerId).first();
}

// Lấy tên, ảnh đại diện khách Messenger (cần tính năng Business Asset User Profile Access). Lỗi thì bỏ qua.
async function fillProfile(env, conv) {
  try {
    const p = await graph(env, conv.customer_id, { fields: 'name,first_name,last_name,profile_pic', access_token: await pageToken(env, conv.page_id) });
    const name = p.name || [p.last_name, p.first_name].filter(Boolean).join(' ') || null;
    if (!name && !p.profile_pic) return false;
    await env.DB.prepare('UPDATE social_conversations SET customer_name = COALESCE(?, customer_name), customer_pic = COALESCE(?, customer_pic) WHERE id = ?')
      .bind(name, p.profile_pic || null, conv.id).run();
    conv.customer_name = name || conv.customer_name;
    conv.customer_pic = p.profile_pic || conv.customer_pic;
    return true;
  } catch { return false; }
}

// Liên kết mở khách trên Facebook: Facebook không cho lấy trang cá nhân qua API (id khách chỉ dùng trong app),
// nên tin nhắn mở trong hộp thư Meta Business Suite, bình luận mở đúng bình luận trên bài (bấm tên khách ở đó để xem trang cá nhân).
function fbLinks(c, lastComment) {
  const links = {};
  if (c.kind === 'message') {
    links.inbox = `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(c.page_id)}&mailbox_id=${encodeURIComponent(c.page_id)}&selected_item_id=${encodeURIComponent(c.customer_id)}&thread_type=FB_MESSAGE`;
  } else if (lastComment?.post_id) {
    const [pagePart, postPart] = String(lastComment.post_id).split('_');
    const cPart = String(lastComment.comment_id || '').split('_').pop();
    links.comment = `https://www.facebook.com/${encodeURIComponent(pagePart)}/posts/${encodeURIComponent(postPart || pagePart)}${cPart ? `?comment_id=${encodeURIComponent(cPart)}` : ''}`;
  }
  return links;
}

const attachText = (m) => (m.attachments?.length ? `[${m.attachments.map((a) => ({ image: 'Ảnh', video: 'Video', audio: 'Âm thanh', file: 'Tệp' }[a.type] || 'Đính kèm')).join(', ')}]` : '');

async function onMessage(env, pageId, ev) {
  const m = ev.message;
  if (!m || !m.mid) return;
  const echo = !!m.is_echo || ev.sender?.id === pageId;
  const customerId = String(echo ? ev.recipient?.id : ev.sender?.id || '');
  if (!customerId) return;
  if (await env.DB.prepare('SELECT 1 FROM social_messages WHERE fb_id = ?').bind(m.mid).first()) return; // đã có (Facebook gửi lại hoặc tin do hệ thống gửi)
  const text = [m.text, attachText(m)].filter(Boolean).join(' ');
  const at = ev.timestamp ? Math.floor(ev.timestamp / 1000) : now();
  const conv = await upsertConversation(env, pageId, 'message', customerId, null, text, at, !echo);
  if (!echo && (!conv.customer_name || !conv.customer_pic)) await fillProfile(env, conv);
  await env.DB.prepare('INSERT OR IGNORE INTO social_messages (conversation_id, direction, channel, text, fb_id, created_at) VALUES (?,?,?,?,?,?)')
    .bind(conv.id, echo ? 'out' : 'in', 'message', text, m.mid, at).run();
}

async function onComment(env, request, pageId, v) {
  const from = v.from || {};
  if (!v.comment_id || !from.id || String(from.id) === pageId) return; // bỏ qua bình luận của chính Trang
  if (await env.DB.prepare('SELECT 1 FROM social_messages WHERE fb_id = ?').bind(v.comment_id).first()) return;
  const at = v.created_time ? (typeof v.created_time === 'number' ? v.created_time : Math.floor(Date.parse(v.created_time) / 1000)) : now();
  const text = v.message || (v.photo ? '[Ảnh]' : v.video ? '[Video]' : '');
  const conv = await upsertConversation(env, pageId, 'comment', String(from.id), from.name, text, at, true);
  await env.DB.prepare('INSERT OR IGNORE INTO social_messages (conversation_id, direction, channel, text, fb_id, comment_id, post_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(conv.id, 'in', 'comment', text, v.comment_id, v.comment_id, v.post_id || null, at).run();

  const auto = await getAuto(env, pageId);
  if (!auto.enabled && !auto.public_enabled) return;
  // Mỗi khách chỉ nhận trả lời tự động 1 lần cho mỗi bài, tránh làm phiền khi khách bình luận nhiều lần.
  const done = await env.DB.prepare('SELECT 1 FROM social_messages WHERE conversation_id = ? AND post_id IS ? AND auto = 1').bind(conv.id, v.post_id || null).first();
  if (done) return;
  const token = await pageToken(env, pageId);
  const name = from.name || '';
  const fill = (s) => s.replaceAll('{ten}', name).trim();
  if (auto.public_enabled && auto.public_text) {
    try { await sendPublic(env, conv, token, v.comment_id, v.post_id, fill(auto.public_text), null, true); } catch (e) { console.error('auto public', e.message); }
  }
  if (auto.enabled && auto.message) {
    try { await sendPrivate(env, conv, token, pageId, v.comment_id, v.post_id, fill(auto.message), null, true); } catch (e) { console.error('auto private', e.message); }
  }
}

// ---------- Gửi ----------
async function record(env, conv, channel, text, fbId, commentId, postId, userId, auto) {
  const t = now();
  await env.DB.prepare('INSERT OR IGNORE INTO social_messages (conversation_id, direction, channel, text, fb_id, comment_id, post_id, auto, sent_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(conv.id, 'out', channel, text, fbId || null, commentId || null, postId || null, auto ? 1 : 0, userId, t).run();
  await env.DB.prepare('UPDATE social_conversations SET last_text = ?, last_at = ? WHERE id = ?').bind(text.slice(0, 300), t, conv.id).run();
}

async function sendPublic(env, conv, token, commentId, postId, text, userId, auto = false) {
  const d = await fbPost(env, `${commentId}/comments`, { message: text, access_token: token });
  await record(env, conv, 'public_reply', text, d.id, commentId, postId, userId, auto);
}

async function sendPrivate(env, conv, token, pageId, commentId, postId, text, userId, auto = false) {
  const d = await fbPost(env, `${pageId}/messages`, { recipient: { comment_id: commentId }, message: { text }, access_token: token });
  await record(env, conv, 'private_reply', text, d.message_id, commentId, postId, userId, auto);
  // Khách trả lời tin nhắn riêng sẽ vào cuộc trò chuyện Messenger; ghi sẵn để nhân viên thấy.
  if (d.recipient_id) {
    const mc = await upsertConversation(env, pageId, 'message', String(d.recipient_id), conv.customer_name, text, now(), false);
    await env.DB.prepare('INSERT OR IGNORE INTO social_messages (conversation_id, direction, channel, text, fb_id, comment_id, post_id, auto, sent_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(mc.id, 'out', 'private_reply', text, `${d.message_id || ''}#m`, commentId, postId, auto ? 1 : 0, userId, now()).run();
  }
}

// ---------- Hộp thư ----------
const shapeConv = (c) => ({
  id: c.id, page_id: c.page_id, page_name: c.page_name, page_picture: c.page_picture, kind: c.kind,
  customer_id: c.customer_id, customer_name: c.customer_name, customer_pic: c.customer_pic || null, created_at: c.created_at, last_text: c.last_text, last_at: c.last_at,
  last_in_at: c.last_in_at, unread: c.unread,
  can_message: c.kind === 'message' && !!c.last_in_at && now() - c.last_in_at < DAY,
});

// GET /api/inbox?page_id=&kind=&unread=1&before=
export async function listInbox(request, env, user) {
  const q = new URL(request.url).searchParams;
  let ids = await allowedPageIds(env, user);
  if (q.get('page_id')) ids = ids.filter((id) => id === q.get('page_id'));
  if (!ids.length) return json({ conversations: [], unread_total: 0 });
  const marks = ids.map(() => '?').join(',');
  const where = [`c.page_id IN (${marks})`];
  const binds = [...ids];
  if (['message', 'comment'].includes(q.get('kind'))) { where.push('c.kind = ?'); binds.push(q.get('kind')); }
  if (q.get('unread') === '1') where.push('c.unread > 0');
  const before = Number(q.get('before'));
  if (before > 0) { where.push('c.last_at < ?'); binds.push(before); }
  const { results } = await env.DB.prepare(
    `SELECT c.*, p.name AS page_name, p.picture_url AS page_picture FROM social_conversations c JOIN social_pages p ON p.id = c.page_id
     WHERE ${where.join(' AND ')} ORDER BY c.last_at DESC LIMIT 50`
  ).bind(...binds).all();
  const total = await env.DB.prepare(`SELECT COALESCE(SUM(unread),0) AS n FROM social_conversations WHERE page_id IN (${marks})`).bind(...ids).first();
  return json({ conversations: results.map(shapeConv), unread_total: total.n, more: results.length === 50 });
}

async function loadConv(env, user, id) {
  const c = await env.DB.prepare('SELECT c.*, p.name AS page_name, p.picture_url AS page_picture FROM social_conversations c JOIN social_pages p ON p.id = c.page_id WHERE c.id = ?').bind(Number(id)).first();
  if (!c || !(await allowedPageIds(env, user)).includes(c.page_id)) throw new HttpError(404, 'Không tìm thấy cuộc trò chuyện', 'not_found');
  return c;
}

// GET /api/inbox/:id  (đánh dấu đã đọc)
export async function readConversation(request, env, user, id) {
  const c = await loadConv(env, user, id);
  const { results } = await env.DB.prepare(
    `SELECT m.*, u.name AS sent_by_name FROM social_messages m LEFT JOIN social_users u ON u.id = m.sent_by
     WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 200`
  ).bind(c.id).all();
  if (c.unread) await env.DB.prepare('UPDATE social_conversations SET unread = 0 WHERE id = ?').bind(c.id).run();
  if (c.kind === 'message' && (!c.customer_name || !c.customer_pic)) await fillProfile(env, c);
  const lastComment = results.find((m) => m.channel === 'comment');
  const counts = { in: results.filter((m) => m.direction === 'in').length, out: results.filter((m) => m.direction === 'out').length };
  const msgs = results.reverse().map((m) => ({
    id: m.id, direction: m.direction, channel: m.channel, text: m.text, comment_id: m.comment_id, post_id: m.post_id,
    auto: !!m.auto, sent_by_name: m.sent_by_name, created_at: m.created_at,
    // Nhắn riêng được khi bình luận chưa quá 7 ngày và chưa nhắn riêng lần nào.
    can_private: m.channel === 'comment' && now() - m.created_at < 7 * DAY && !results.some((x) => x.channel === 'private_reply' && x.comment_id === m.comment_id),
  }));
  return json({ conversation: { ...shapeConv(c), unread: 0, links: fbLinks(c, lastComment), counts }, messages: msgs });
}

// POST /api/inbox/:id/reply { text, mode: 'message' | 'public' | 'private', comment_id? }
export async function replyConversation(request, env, user, id) {
  const c = await loadConv(env, user, id);
  const b = await readJson(request);
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) throw new HttpError(400, 'Vui lòng nhập nội dung trả lời', 'empty');
  if (text.length > MAX_TEXT) throw new HttpError(400, `Nội dung tối đa ${MAX_TEXT} ký tự`, 'too_long');
  const token = await pageToken(env, c.page_id);
  const mode = b.mode || (c.kind === 'message' ? 'message' : 'public');

  if (mode === 'message') {
    if (c.kind !== 'message') throw new HttpError(400, 'Cuộc trò chuyện này là bình luận', 'bad_mode');
    if (!c.last_in_at || now() - c.last_in_at >= DAY) throw new HttpError(400, 'Đã quá 24 giờ kể từ tin nhắn cuối của khách, Facebook không cho gửi thêm', 'window_closed');
    const d = await fbPost(env, `${c.page_id}/messages`, { recipient: { id: c.customer_id }, messaging_type: 'RESPONSE', message: { text }, access_token: token });
    await record(env, c, 'message', text, d.message_id, null, null, user.id, false);
  } else {
    if (c.kind !== 'comment') throw new HttpError(400, 'Cuộc trò chuyện này là tin nhắn', 'bad_mode');
    const src = await env.DB.prepare("SELECT * FROM social_messages WHERE conversation_id = ? AND channel = 'comment' AND comment_id = ?").bind(c.id, String(b.comment_id || '')).first()
      || await env.DB.prepare("SELECT * FROM social_messages WHERE conversation_id = ? AND channel = 'comment' ORDER BY created_at DESC LIMIT 1").bind(c.id).first();
    if (!src) throw new HttpError(400, 'Không tìm thấy bình luận để trả lời', 'no_comment');
    if (mode === 'public') await sendPublic(env, c, token, src.comment_id, src.post_id, text, user.id);
    else if (mode === 'private') await sendPrivate(env, c, token, c.page_id, src.comment_id, src.post_id, text, user.id);
    else throw new HttpError(400, 'Cách trả lời không hợp lệ', 'bad_mode');
  }
  await audit(env, request, user.id, 'inbox_replied', c.customer_name || c.customer_id, { conversation: c.id, mode });
  return readConversation(request, env, user, c.id);
}

// Đăng ký nhận webhook cho Trang (gọi khi kết nối hoặc cập nhật Trang).
export async function subscribePage(env, pageId, token) {
  return fbPost(env, `${pageId}/subscribed_apps`, { subscribed_fields: 'messages,message_echoes,feed', access_token: token });
}
