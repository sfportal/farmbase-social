// Băm mật khẩu (PBKDF2), mã ngẫu nhiên, mã hóa mã truy cập Fanpage (AES-GCM).

const enc = new TextEncoder();
// 25.000 vòng (~6 ms CPU) để vừa giới hạn 10 ms CPU của gói Workers miễn phí.
// Mật khẩu cũ lưu kèm số vòng, nên nâng số này sau (gói trả phí) vẫn đăng nhập được bình thường.
const PBKDF2_ITERATIONS = 25000;

export function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return b64u(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text) {
  return b64u(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64u(salt)}$${b64u(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [kind, iter, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromB64u(salt), Number(iter));
  const expected = fromB64u(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

async function aesKey(secret) {
  if (!secret) throw new Error('Thiếu biến bí mật TOKEN_KEY');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plain, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plain));
  return `v1:${b64u(iv)}:${b64u(ct)}`;
}

export async function decryptSecret(blob, secret) {
  const [v, iv, ct] = String(blob || '').split(':');
  if (v !== 'v1') throw new Error('Mã đã lưu không đúng định dạng');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(iv) }, await aesKey(secret), fromB64u(ct));
  return new TextDecoder().decode(pt);
}

// Mật khẩu tạm cho nhân viên: dễ đọc, không có ký tự dễ nhầm (0/O, 1/l).
export function tempPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const out = [];
  while (out.length < 12) {
    const b = crypto.getRandomValues(new Uint8Array(1))[0];
    if (b < 216) out.push(alphabet[b % alphabet.length]); // 216 = 4 × 54, tránh lệch phân bố
  }
  const s = out.join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}7`;
}
