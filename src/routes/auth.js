// Đăng nhập, đăng xuất, thông tin tài khoản, đổi mật khẩu.
import { hashPassword, verifyPassword, sha256 } from '../lib/crypto.js';
import { HttpError, json, readJson, now, checkPasswordStrength } from '../lib/http.js';
import {
  COOKIE, MAX_FAILED, LOCK_SECONDS, ensureBootstrapAdmin, createSession, destroySession,
  sessionCookie, publicUser, allowedPageIds,
} from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { getCookie } from '../lib/http.js';

// Băm sẵn một mật khẩu giả để thời gian trả lời như nhau khi email không tồn tại.
let dummyHash = null;

export async function login(request, env) {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) throw new HttpError(400, 'Vui lòng nhập email và mật khẩu', 'missing');

  await ensureBootstrapAdmin(env);
  const user = await env.DB.prepare('SELECT * FROM social_users WHERE email = ?').bind(email).first();
  const t = now();

  if (!user) {
    dummyHash ||= await hashPassword('khong-co-tai-khoan-nay');
    await verifyPassword(password, dummyHash);
    await audit(env, request, null, 'login_failed', email, { reason: 'unknown_email' });
    throw new HttpError(401, 'Email hoặc mật khẩu không đúng', 'bad_credentials');
  }
  if (user.status !== 'active') {
    throw new HttpError(403, 'Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ Chủ hệ thống.', 'disabled');
  }
  if (user.locked_until > t) {
    const mins = Math.ceil((user.locked_until - t) / 60);
    throw new HttpError(429, `Tài khoản tạm khóa do nhập sai nhiều lần. Vui lòng thử lại sau ${mins} phút.`, 'locked');
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    const fails = user.failed_attempts + 1;
    if (fails >= MAX_FAILED) {
      await env.DB.prepare('UPDATE social_users SET failed_attempts = 0, locked_until = ?, updated_at = ? WHERE id = ?')
        .bind(t + LOCK_SECONDS, t, user.id).run();
      await audit(env, request, user.id, 'account_locked', user.email);
      throw new HttpError(429, `Tài khoản tạm khóa ${LOCK_SECONDS / 60} phút do nhập sai ${MAX_FAILED} lần.`, 'locked');
    }
    await env.DB.prepare('UPDATE social_users SET failed_attempts = ?, updated_at = ? WHERE id = ?').bind(fails, t, user.id).run();
    await audit(env, request, user.id, 'login_failed', user.email, { reason: 'bad_password' });
    throw new HttpError(401, `Email hoặc mật khẩu không đúng (còn ${MAX_FAILED - fails} lần thử)`, 'bad_credentials');
  }

  await env.DB.prepare('UPDATE social_users SET failed_attempts = 0, locked_until = 0, last_login_at = ?, updated_at = ? WHERE id = ?')
    .bind(t, t, user.id).run();
  const cookie = await createSession(env, request, user.id);
  await audit(env, request, user.id, 'login', user.email);
  return json({ user: publicUser(user) }, 200, { 'set-cookie': cookie });
}

export async function logout(request, env, user) {
  await destroySession(env, request);
  if (user) await audit(env, request, user.id, 'logout', user.email);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
}

export async function logoutAll(request, env, user) {
  await env.DB.prepare('DELETE FROM social_sessions WHERE user_id = ?').bind(user.id).run();
  await audit(env, request, user.id, 'logout_all', user.email);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
}

export async function me(request, env, user) {
  if (!user) return json({ user: null });
  const pageCount = (await allowedPageIds(env, user)).length;
  return json({ user: publicUser(user), page_count: pageCount });
}

export async function changePassword(request, env, user) {
  const body = await readJson(request);
  const current = String(body.current_password || '');
  const next = String(body.new_password || '');
  const row = await env.DB.prepare('SELECT password_hash FROM social_users WHERE id = ?').bind(user.id).first();
  if (!(await verifyPassword(current, row.password_hash))) {
    throw new HttpError(400, 'Mật khẩu hiện tại không đúng', 'bad_current');
  }
  const weak = checkPasswordStrength(next);
  if (weak) throw new HttpError(400, weak, 'weak_password');
  if (next === current) throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại', 'same_password');

  const t = now();
  await env.DB.prepare('UPDATE social_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
    .bind(await hashPassword(next), t, user.id).run();
  // Đăng xuất các thiết bị khác, giữ phiên hiện tại.
  const token = getCookie(request, COOKIE);
  await env.DB.prepare('DELETE FROM social_sessions WHERE user_id = ? AND id != ?').bind(user.id, await sha256(token)).run();
  await audit(env, request, user.id, 'password_changed', user.email);
  return json({ ok: true, user: publicUser({ ...user, must_change_password: 0 }) });
}
