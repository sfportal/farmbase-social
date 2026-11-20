// Kết nối Fanpage bằng đăng nhập Facebook, lưu mã Trang dài hạn đã mã hóa, cập nhật số liệu Fanpage.
import { encryptSecret, decryptSecret, randomToken } from '../lib/crypto.js';
import { HttpError, json, now } from '../lib/http.js';
import { requireRole, allowedPageIds } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { subscribePage, verifyToken } from './inbox.js';

// Quyền đã thêm trong app "FarmBase Social". Đổi bằng biến FB_SCOPES nếu cần.
const DEFAULT_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_manage_posts',
  'pages_read_user_content',
  'pages_manage_engagement',
  'pages_messaging',
].join(',');

// FB_GRAPH_BASE chỉ dùng khi chạy thử trên máy (máy chủ Facebook giả), không đặt trên Cloudflare.
export const graphBase = (env) => `${env.FB_GRAPH_BASE || 'https://graph.facebook.com'}/${env.FB_API_VERSION || 'v27.0'}`;
const redirectUri = (request) => `${new URL(request.url).origin}/api/fb/callback`;

export async function graph(env, path, params = {}, init = {}) {
  const url = new URL(`${graphBase(env)}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || `Facebook trả lỗi ${res.status}`;
    const err = new HttpError(502, msg, 'facebook');
    err.fb = data.error;
    throw err;
  }
  return data;
}

export async function fbStatus(request, env, user) {
  requireRole(user, 'owner');
  return json({
    app_id: env.FB_APP_ID || null,
    has_secret: !!env.FB_APP_SECRET,
    has_token_key: !!env.TOKEN_KEY,
    redirect_uri: redirectUri(request),
    scopes: (env.FB_SCOPES || DEFAULT_SCOPES).split(','),
    config_id: env.FB_CONFIG_ID || null,
    webhook_url: `${new URL(request.url).origin}/api/fb/webhook`,
    webhook_verify_token: await verifyToken(env),
  });
}

export async function fbConnect(request, env, user) {
  requireRole(user, 'owner');
  if (!env.FB_APP_ID || !env.FB_APP_SECRET || !env.TOKEN_KEY) {
    return Response.redirect(`${new URL(request.url).origin}/#/fanpage?loi=chua-cau-hinh`, 302);
  }
  const state = randomToken(24);
  const t = now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM social_oauth_states WHERE created_at < ?').bind(t - 900),
    env.DB.prepare('INSERT INTO social_oauth_states (state, user_id, created_at) VALUES (?,?,?)').bind(state, user.id, t),
  ]);
  const url = new URL(`https://www.facebook.com/${env.FB_API_VERSION || 'v27.0'}/dialog/oauth`);
  url.searchParams.set('client_id', env.FB_APP_ID);
  url.searchParams.set('redirect_uri', redirectUri(request));
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  // App dùng Facebook Login for Business: nếu có FB_CONFIG_ID thì gửi config_id (cấu hình quyền tạo trong app), không thì gửi scope.
  if (env.FB_CONFIG_ID) url.searchParams.set('config_id', env.FB_CONFIG_ID);
  else url.searchParams.set('scope', env.FB_SCOPES || DEFAULT_SCOPES);
  return Response.redirect(url.toString(), 302);
}

export async function fbCallback(request, env, user) {
  const origin = new URL(request.url).origin;
  const back = (q) => Response.redirect(`${origin}/#/fanpage?${q}`, 302);
  requireRole(user, 'owner');
  const params = new URL(request.url).searchParams;
  if (params.get('error')) return back('loi=huy');

  const state = params.get('state') || '';
  const row = await env.DB.prepare('SELECT * FROM social_oauth_states WHERE state = ?').bind(state).first();
  await env.DB.prepare('DELETE FROM social_oauth_states WHERE state = ?').bind(state).run();
  if (!row || row.user_id !== user.id || row.created_at < now() - 900) return back('loi=het-han');

  try {
    const short = await graph(env, 'oauth/access_token', {
      client_id: env.FB_APP_ID,
      client_secret: env.FB_APP_SECRET,
      redirect_uri: redirectUri(request),
      code: params.get('code') || '',
    });
    const long = await graph(env, 'oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: env.FB_APP_ID,
      client_secret: env.FB_APP_SECRET,
      fb_exchange_token: short.access_token,
    });

    // Mã Trang lấy từ mã người dùng dài hạn là mã dài hạn.
    const pages = [];
    let next = null;
    let data = await graph(env, 'me/accounts', {
      access_token: long.access_token,
      fields: 'id,name,category,access_token,picture{url},fan_count,followers_count',
      limit: '100',
    });
    for (let i = 0; i < 10; i++) {
      pages.push(...(data.data || []));
      next = data.paging?.next;
      if (!next) break;
      const res = await fetch(next);
      data = await res.json();
      if (data.error) break;
    }

    const t = now();
    const stmts = [];
    for (const p of pages) {
      const tokenEnc = await encryptSecret(p.access_token, env.TOKEN_KEY);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO social_pages (id, name, category, picture_url, access_token_enc, status, fan_count, followers_count, stats_at, last_error, connected_by, connected_at, updated_at)
           VALUES (?,?,?,?,?, 'active', ?,?,?, NULL, ?,?,?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, picture_url = excluded.picture_url,
             access_token_enc = excluded.access_token_enc, status = 'active', fan_count = excluded.fan_count,
             followers_count = excluded.followers_count, stats_at = excluded.stats_at, last_error = NULL,
             connected_by = excluded.connected_by, updated_at = excluded.updated_at`
        ).bind(p.id, p.name, p.category || null, p.picture?.data?.url || null, tokenEnc,
          p.fan_count ?? null, p.followers_count ?? null, t, user.id, t, t)
      );
    }
    if (stmts.length) await env.DB.batch(stmts);
    // Đăng ký nhận tin nhắn, bình luận mới qua webhook cho từng Trang (lỗi thì bỏ qua, bấm Cập nhật để thử lại).
    const subFailed = [];
    for (const p of pages) {
      try { await subscribePage(env, p.id, p.access_token); } catch (e) { subFailed.push({ id: p.id, message: e.message }); }
    }
    await audit(env, request, user.id, 'pages_connected', null, { pages: pages.map((p) => ({ id: p.id, name: p.name })), webhook_failed: subFailed });
    return back(`ket-noi=${pages.length}`);
  } catch (e) {
    await audit(env, request, user.id, 'pages_connect_failed', null, { message: e.message });
    return back(`loi=facebook&chi-tiet=${encodeURIComponent(e.message.slice(0, 200))}`);
  }
}

export async function listPages(request, env, user) {
  const ids = await allowedPageIds(env, user);
  if (!ids.length) return json({ pages: [] });
  const marks = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.name, p.category, p.picture_url, p.status, p.fan_count, p.followers_count, p.stats_at, p.last_error, p.connected_at,
       (SELECT COUNT(*) FROM social_user_pages up WHERE up.page_id = p.id) AS staff_count
     FROM social_pages p WHERE p.id IN (${marks}) ORDER BY p.name`
  ).bind(...ids).all();
  return json({ pages: results });
}

export async function refreshPage(request, env, user, pageId) {
  requireRole(user, 'owner', 'manager');
  const ids = await allowedPageIds(env, user);
  if (!ids.includes(pageId)) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
  const page = await env.DB.prepare('SELECT * FROM social_pages WHERE id = ?').bind(pageId).first();
  const t = now();
  try {
    const token = await decryptSecret(page.access_token_enc, env.TOKEN_KEY);
    const d = await graph(env, pageId, { access_token: token, fields: 'id,name,category,picture{url},fan_count,followers_count' });
    try { await subscribePage(env, pageId, token); } catch (e) { console.error('subscribe', e.message); }
    await env.DB.prepare(
      "UPDATE social_pages SET name = ?, category = ?, picture_url = ?, fan_count = ?, followers_count = ?, stats_at = ?, status = 'active', last_error = NULL, updated_at = ? WHERE id = ?"
    ).bind(d.name, d.category || null, d.picture?.data?.url || null, d.fan_count ?? null, d.followers_count ?? null, t, t, pageId).run();
  } catch (e) {
    await env.DB.prepare("UPDATE social_pages SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?").bind(e.message.slice(0, 500), t, pageId).run();
    throw new HttpError(502, `Không cập nhật được từ Facebook: ${e.message}`, 'facebook');
  }
  const row = await env.DB.prepare('SELECT id, name, category, picture_url, status, fan_count, followers_count, stats_at, last_error FROM social_pages WHERE id = ?').bind(pageId).first();
  return json({ page: row });
}

export async function disconnectPage(request, env, user, pageId) {
  requireRole(user, 'owner');
  const page = await env.DB.prepare('SELECT id, name FROM social_pages WHERE id = ?').bind(pageId).first();
  if (!page) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
  await env.DB.prepare("UPDATE social_pages SET status = 'disconnected', access_token_enc = NULL, updated_at = ? WHERE id = ?").bind(now(), pageId).run();
  await audit(env, request, user.id, 'page_disconnected', page.name, { id: page.id });
  return json({ ok: true });
}
