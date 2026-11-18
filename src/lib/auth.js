// Phiên đăng nhập, tạo tài khoản quản trị mặc định, kiểm tra quyền.
import { hashPassword, randomToken, sha256 } from './crypto.js';
import { HttpError, getCookie, now, clientIp } from './http.js';

export const COOKIE = 'fbs_session';
const SESSION_DAYS = 30;
export const MAX_FAILED = 5;
export const LOCK_SECONDS = 15 * 60;

export const ROLES = ['owner', 'manager', 'editor', 'agent'];
export const ROLE_LABELS = {
  owner: 'Chủ hệ thống',
  manager: 'Quản lý',
  editor: 'Biên tập',
  agent: 'Chăm sóc khách hàng',
};

// Lần đầu hệ thống chạy (chưa có tài khoản nào): tạo Chủ hệ thống từ biến bí mật.
export async function ensureBootstrapAdmin(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  if (row.n > 0) return;
  const email = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = env.ADMIN_INITIAL_PASSWORD || '';
  if (!email || !password) return;
  const t = now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (email, name, role, password_hash, must_change_password, created_at, updated_at)
     VALUES (?, 'Quản trị viên', 'owner', ?, 1, ?, ?)`
  )
    .bind(email, await hashPassword(password), t, t)
    .run();
}

export async function createSession(env, request, userId) {
  const token = randomToken(32);
  const t = now();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip) VALUES (?,?,?,?,?,?)')
    .bind(await sha256(token), userId, t, t + SESSION_DAYS * 86400, (request.headers.get('user-agent') || '').slice(0, 300), clientIp(request))
    .run();
  return sessionCookie(request, token, SESSION_DAYS * 86400);
}

export function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function destroySession(env, request) {
  const token = getCookie(request, COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
}

export async function currentUser(env, request) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.must_change_password, u.status, s.id AS session_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(await sha256(token), now())
    .first();
  if (!row || row.status !== 'active') return null;
  return row;
}

export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    role_label: ROLE_LABELS[u.role],
    must_change_password: !!u.must_change_password,
  };
}

export function requireRole(user, ...roles) {
  if (!roles.includes(user.role)) throw new HttpError(403, 'Tài khoản của Quý khách không có quyền thực hiện thao tác này', 'forbidden');
}

// Danh sách id Fanpage người dùng được xem. Chủ hệ thống thấy tất cả.
export async function allowedPageIds(env, user) {
  if (user.role === 'owner') {
    const { results } = await env.DB.prepare("SELECT id FROM pages WHERE status != 'disconnected'").all();
    return results.map((r) => r.id);
  }
  const { results } = await env.DB.prepare(
    "SELECT up.page_id AS id FROM user_pages up JOIN pages p ON p.id = up.page_id WHERE up.user_id = ? AND p.status != 'disconnected'"
  )
    .bind(user.id)
    .all();
  return results.map((r) => r.id);
}
