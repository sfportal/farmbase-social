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

export async function listAudit(request, env, user) {
  requireRole(user, 'owner');
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.action, a.target, a.detail, a.ip, a.created_at, u.email AS user_email, u.name AS user_name
     FROM social_audit_log a LEFT JOIN social_users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`
  ).bind(limit).all();
  return json({ entries: results });
}
