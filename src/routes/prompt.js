// Thư viện prompt (trang tĩnh public/prompt/): kiểm tra đăng nhập và trả email liên hệ mặc định.
// Email không ghi trong repo công khai; lấy từ biến PROMPT_CONTACT_EMAIL, không có thì dùng ADMIN_EMAIL.
// Route để public (trả 200) cho trang khỏi báo lỗi 401; chưa đăng nhập thì không trả email.
import { json } from '../lib/http.js';

export async function promptContact(request, env, user) {
  if (!user) return json({ login: false });
  if (user.must_change_password) return json({ login: true, must_change_password: true });
  return json({ login: true, email: env.PROMPT_CONTACT_EMAIL || env.ADMIN_EMAIL || '' });
}
