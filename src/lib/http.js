// Tiện ích trả JSON, đọc cookie, lỗi có mã.

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'error';
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Dữ liệu gửi lên không hợp lệ', 'bad_json');
  }
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || '';
}

export const now = () => Math.floor(Date.now() / 1000);

export function isEmail(s) {
  return typeof s === 'string' && s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Mật khẩu cần ít nhất 10 ký tự';
  if (pw.length > 200) return 'Mật khẩu quá dài';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Mật khẩu cần có cả chữ và số';
  return null;
}
