# Cài đặt FarmBase Social trên Cloudflare

Hướng dẫn cho người không viết code. Làm một lần, sau đó mỗi lần cập nhật nhánh `main` là trang tự triển khai.

## 1. Cơ sở dữ liệu D1

Không cần tạo mới. Hệ thống dùng chung D1 `farmbase` của website farmbase.vn (gói Cloudflare miễn phí chỉ cho tối đa 10 D1). Mọi bảng của FarmBase Social có tiền tố `social_`, không đụng bảng của website.

Khi nâng gói Workers Paid sau này, có thể chuyển sang D1 riêng.

## 2. Tạo Worker và nối GitHub

Đã làm: Worker `farmbase-social` trong tài khoản Cloudflare có website farmbase.vn, địa chỉ mặc định `https://farmbase-social.sfportal.workers.dev`.

1. Cloudflare → **Workers & Pages → Create → Import a repository**, chọn `sfportal/farmbase-social`, nhánh `main`.
2. Lệnh build để trống. Lệnh deploy:
   ```
   npx wrangler d1 migrations apply DB --remote && npx wrangler deploy
   ```
   Lệnh này tạo bảng trong D1 rồi đăng bản mới.
3. Gắn tên miền riêng nếu muốn, ví dụ `social.farmbase.vn` (Worker → Settings → Domains & Routes).

## 3. Nhập biến bí mật

Worker → **Settings → Variables and Secrets → Add**, chọn loại **Secret**:

| Tên | Giá trị |
| --- | --- |
| `ADMIN_EMAIL` | Email tài khoản Chủ hệ thống đầu tiên |
| `ADMIN_INITIAL_PASSWORD` | Mật khẩu tạm cho lần đăng nhập đầu (hệ thống bắt đổi ngay) |
| `TOKEN_KEY` | Một chuỗi ngẫu nhiên dài từ 32 ký tự, dùng để mã hóa mã truy cập Fanpage. Không đổi sau khi đã kết nối Fanpage |
| `FB_APP_SECRET` | App Secret của app Facebook "FarmBase Fanpage" (Meta for Developers → Cài đặt ứng dụng → Thông tin cơ bản) |

Không gửi các giá trị này qua chat hoặc email, và không ghi vào repo (repo đang công khai).

Tài khoản Chủ hệ thống chỉ được tạo một lần, khi cơ sở dữ liệu chưa có tài khoản nào. Sau đó đổi `ADMIN_INITIAL_PASSWORD` không còn tác dụng.

## 4. Cấu hình app Facebook

Trong app "FarmBase Social" (ID 1683859133415974):

1. Thêm sản phẩm hoặc trường hợp sử dụng **Đăng nhập Facebook** nếu chưa có.
2. Ở **Valid OAuth Redirect URIs**, thêm địa chỉ:
   ```
   https://<tên miền của trang>/api/fb/callback
   ```
   Trang **Fanpage** trong hệ thống hiện đúng địa chỉ cần chép.
3. Ở **Cài đặt → Thông tin cơ bản**, điền **App Domains** là tên miền của trang.

4. **Webhook (hộp thư):** trong trường hợp sử dụng Messenger và Page, mục **Webhooks**, điền Callback URL `https://<tên miền>/api/fb/webhook` và Verify token. Cả hai hiện ở trang **Fanpage** của hệ thống (mục "Cài đặt nhận tin nhắn, bình luận", chỉ Chủ hệ thống xem được). Đăng ký trường `messages`, `message_echoes` (Messenger) và `feed` (Page). Sau đó bấm **Cập nhật** ở từng Trang để Trang gửi tin về hệ thống.

## 5. Dùng lần đầu

1. Mở trang, đăng nhập bằng `ADMIN_EMAIL` và mật khẩu tạm, đặt mật khẩu mới.
2. Vào **Fanpage → Kết nối Fanpage**, đăng nhập Facebook, chọn các Trang cần quản lý.
3. Vào **Nhân viên → Thêm nhân viên**: nhập email, vai trò, Fanpage được giao. Hệ thống hiện mật khẩu tạm một lần để gửi riêng cho nhân viên.

## 6. Cài lên điện thoại

- **Android:** mở trang bằng Chrome, menu ⋮ → "Cài đặt ứng dụng".
- **iPhone:** mở bằng Safari, nút Chia sẻ → "Thêm vào Màn hình chính".
