// Quản lý tài khoản nhân viên (chỉ Chủ hệ thống).
import { hashPassword, tempPassword } from '../lib/crypto.js';
import { HttpError, json, readJson, now, isEmail } from '../lib/http.js';
import { ROLES, ROLE_LABELS, requireRole } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

async function pageIdsFor(env, userId) {
  const { results } = await env.DB.prepare('SELECT page_id FROM social_user_pages WHERE user_id = ?').bind(userId).all();
  return results.map((r) => r.page_id);
}

async function setPages(env, userId, pageIds) {
  if (!Array.isArray(pageIds)) return;
  const ids = [...new Set(pageIds.map(String))].slice(0, 200);
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(`SELECT id FROM social_pages WHERE id IN (${marks})`).bind(...ids).all();
    if (results.length !== ids.length) throw new HttpError(400, 'Có Fanpage không tồn tại trong hệ thống', 'bad_page');
  }
  const stmts = [env.DB.prepare('DELETE FROM social_user_pages WHERE user_id = ?').bind(userId)];
  for (const id of ids) stmts.push(env.DB.prepare('INSERT INTO social_user_pages (user_id, page_id) VALUES (?, ?)').bind(userId, id));
  await env.DB.batch(stmts);
}

function shape(u, pageIds) {
  const t = now();
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    role_label: ROLE_LABELS[u.role],
    status: u.status,
    must_change_password: !!u.must_change_password,
    locked: u.locked_until > t,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
    page_ids: pageIds,
  };
}

async function activeOwnerCount(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_users WHERE role = 'owner' AND status = 'active'").first();
  return r.n;
}

export async function listUsers(request, env, user) {
  requireRole(user, 'owner');
  const { results } = await env.DB.prepare('SELECT * FROM social_users ORDER BY created_at ASC').all();
  const { results: links } = await env.DB.prepare('SELECT user_id, page_id FROM social_user_pages').all();
  const byUser = {};
  for (const l of links) (byUser[l.user_id] ||= []).push(l.page_id);
  return json({ users: results.map((u) => shape(u, byUser[u.id] || [])), roles: ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r] })) });
}

export async function createUser(request, env, user) {
  requireRole(user, 'owner');
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 100);
  const role = String(body.role || 'agent');
  if (!isEmail(email)) throw new HttpError(400, 'Email không hợp lệ', 'bad_email');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Vai trò không hợp lệ', 'bad_role');
  const exists = await env.DB.prepare('SELECT id FROM social_users WHERE email = ?').bind(email).first();
  if (exists) throw new HttpError(409, 'Email này đã có tài khoản', 'exists');

  const password = tempPassword();
  const t = now();
  const res = await env.DB.prepare(
    'INSERT INTO social_users (email, name, role, password_hash, must_change_password, created_at, updated_at) VALUES (?,?,?,?,1,?,?)'
  ).bind(email, name, role, await hashPassword(password), t, t).run();
  const id = res.meta.last_row_id;
  await setPages(env, id, body.page_ids || []);
  await audit(env, request, user.id, 'user_created', email, { role, page_ids: body.page_ids || [] });
  const row = await env.DB.prepare('SELECT * FROM social_users WHERE id = ?').bind(id).first();
  // Mật khẩu tạm chỉ hiện một lần, không lưu dạng đọc được.
  return json({ user: shape(row, await pageIdsFor(env, id)), temp_password: password }, 201);
}

async function loadTarget(env, id) {
  const target = await env.DB.prepare('SELECT * FROM social_users WHERE id = ?').bind(Number(id)).first();
  if (!target) throw new HttpError(404, 'Không tìm thấy tài khoản', 'not_found');
  return target;
}

export async function updateUser(request, env, user, id) {
  requireRole(user, 'owner');
  const target = await loadTarget(env, id);
  const body = await readJson(request);
  const changes = {};

  if (body.name !== undefined) changes.name = String(body.name).trim().slice(0, 100);
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) throw new HttpError(400, 'Vai trò không hợp lệ', 'bad_role');
    if (target.id === user.id && body.role !== target.role) throw new HttpError(400, 'Không thể tự đổi vai trò của chính mình', 'self');
    changes.role = body.role;
  }
  if (body.status !== undefined) {
    if (!['active', 'disabled'].includes(body.status)) throw new HttpError(400, 'Trạng thái không hợp lệ', 'bad_status');
    if (target.id === user.id && body.status !== 'active') throw new HttpError(400, 'Không thể tự vô hiệu hóa tài khoản của mình', 'self');
    changes.status = body.status;
  }
  const losesOwner = target.role === 'owner' && target.status === 'active' &&
    ((changes.role && changes.role !== 'owner') || changes.status === 'disabled');
  if (losesOwner && (await activeOwnerCount(env)) <= 1) {
    throw new HttpError(400, 'Hệ thống cần ít nhất một Chủ hệ thống đang hoạt động', 'last_owner');
  }

  const keys = Object.keys(changes);
  if (keys.length) {
    await env.DB.prepare(`UPDATE social_users SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...keys.map((k) => changes[k]), now(), target.id).run();
  }
  if (changes.status === 'disabled') await env.DB.prepare('DELETE FROM social_sessions WHERE user_id = ?').bind(target.id).run();
  if (body.page_ids !== undefined) await setPages(env, target.id, body.page_ids);

  await audit(env, request, user.id, 'user_updated', target.email, { ...changes, page_ids: body.page_ids });
  const row = await env.DB.prepare('SELECT * FROM social_users WHERE id = ?').bind(target.id).first();
  return json({ user: shape(row, await pageIdsFor(env, target.id)) });
}

export async function resetPassword(request, env, user, id) {
  requireRole(user, 'owner');
  const target = await loadTarget(env, id);
  const password = tempPassword();
  await env.DB.batch([
    env.DB.prepare('UPDATE social_users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = 0, updated_at = ? WHERE id = ?')
      .bind(await hashPassword(password), now(), target.id),
    env.DB.prepare('DELETE FROM social_sessions WHERE user_id = ?').bind(target.id),
  ]);
  await audit(env, request, user.id, 'password_reset', target.email);
  return json({ ok: true, temp_password: password });
}

export async function unlockUser(request, env, user, id) {
  requireRole(user, 'owner');
  const target = await loadTarget(env, id);
  await env.DB.prepare('UPDATE social_users SET failed_attempts = 0, locked_until = 0, updated_at = ? WHERE id = ?').bind(now(), target.id).run();
  await audit(env, request, user.id, 'user_unlocked', target.email);
  return json({ ok: true });
}

// Nhóm thao tác để lọc nhật ký (khớp tiền tố tên thao tác).
export const AUDIT_GROUPS = {
  'dang-nhap': ['login', 'logout', 'logout_all', 'login_failed', 'account_locked', 'password_changed', 'password_reset'],
  'bai-dang': ['post_%', 'ai_written', 'ai_revised', 'ai_media_prompt', 'rules_updated', 'page_style_updated'],
  'tin-nhan': ['inbox_%', 'autoreply_%'],
  'chu-de-ai': ['topic%', 'knowledge_%', 'suggestion_%', 'assistant_%', 'plan_%', 'page_brief_updated', 'prompt_%', 'ai_models_updated'],
  'kho-media': ['media_%'],
  'nghien-cuu': ['competitor%', 'video%', 'source_%'],
  'quan-tri': ['user_%', 'pages_%', 'page_disconnected'],
};

function groupWhere(group) {
  const pats = AUDIT_GROUPS[group];
  if (!pats) return null;
  return { sql: '(' + pats.map((p) => (p.includes('%') ? 'a.action LIKE ?' : 'a.action = ?')).join(' OR ') + ')', binds: pats };
}

export async function listAudit(request, env, user) {
  requireRole(user, 'owner');
  const url = new URL(request.url);
  const q = url.searchParams;
  const limit = Math.min(Math.max(Number(q.get('limit')) || 100, 1), 500);
  const where = []; const binds = [];
  const uid = q.get('user');
  if (uid === 'system') where.push('a.user_id IS NULL');
  else if (uid && /^\d+$/.test(uid)) { where.push('a.user_id = ?'); binds.push(Number(uid)); }
  const g = groupWhere(q.get('group'));
  if (g) { where.push(g.sql); binds.push(...g.binds); }
  if (q.get('failed') === '1') where.push("a.action IN ('login_failed', 'account_locked', 'post_publish_failed', 'pages_connect_failed')");
  const from = Number(q.get('from')); const to = Number(q.get('to'));
  if (from > 0) { where.push('a.created_at >= ?'); binds.push(from); }
  if (to > 0) { where.push('a.created_at < ?'); binds.push(to); }
  const before = Number(q.get('before'));
  if (before > 0) { where.push('a.id < ?'); binds.push(before); }
  const text = (q.get('q') || '').trim().slice(0, 80);
  if (text) { where.push('(a.target LIKE ? OR a.detail LIKE ?)'); binds.push(`%${text}%`, `%${text}%`); }
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.user_id, a.action, a.target, a.detail, a.ip, a.user_agent, a.created_at, u.email AS user_email, u.name AS user_name
     FROM social_audit_log a LEFT JOIN social_users u ON u.id = a.user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`
  ).bind(...binds, limit + 1).all();
  const more = results.length > limit;
  const entries = results.slice(0, limit);
  if (q.get('summary') === '0') return json({ entries, more });
  // Tổng hợp từng nhân viên trong 7 ngày: số lần đăng nhập, đăng nhập sai, số thao tác, lần hoạt động gần nhất.
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const { results: staff } = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.last_login_at, u.last_seen_at, u.locked_until,
       SUM(CASE WHEN a.action = 'login' THEN 1 ELSE 0 END) AS logins,
       SUM(CASE WHEN a.action IN ('login_failed', 'account_locked') THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN a.action NOT IN ('login', 'logout', 'logout_all', 'login_failed', 'account_locked') THEN 1 ELSE 0 END) AS actions,
       MAX(a.created_at) AS last_action_at
     FROM social_users u LEFT JOIN social_audit_log a ON a.user_id = u.id AND a.created_at >= ?
     GROUP BY u.id ORDER BY u.role = 'owner' DESC, u.name`
  ).bind(since).all();
  const { results: last } = await env.DB.prepare(
    `SELECT a.user_id, a.ip, a.user_agent FROM social_audit_log a
     WHERE a.id IN (SELECT MAX(id) FROM social_audit_log WHERE action = 'login' AND user_id IS NOT NULL GROUP BY user_id)`
  ).all();
  const lastBy = new Map(last.map((r) => [r.user_id, r]));
  const { results: unknown } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM social_audit_log WHERE action = 'login_failed' AND user_id IS NULL AND created_at >= ?"
  ).bind(since).all();
  return json({
    entries, more,
    staff: staff.map((u) => ({ ...u, last_ip: lastBy.get(u.id)?.ip || null, last_ua: lastBy.get(u.id)?.user_agent || null })),
    unknown_failed: unknown[0]?.n || 0,
  });
}
