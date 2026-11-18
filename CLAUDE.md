# CLAUDE.md: hướng dẫn làm tiếp FarmBase Social

## Người dùng
- Salefronts không viết code, nhắn bằng tiếng Việt. Trả lời bằng tiếng Việt, giọng doanh nghiệp.
- Đặc tả đầy đủ: tài liệu "Đặc tả hệ thống FarmBase Social: quản lý nhiều Fanpage" (Claude Docs). Lộ trình 4 giai đoạn, xem bảng trong README.md.
- Repo này **công khai**: không ghi email, mật khẩu, khóa, mã truy cập vào repo. Không xin người dùng dán khóa vào chat.
- Phải xin phép trước khi: gửi tin nhắn hoặc đăng bài thật lên Fanpage, xóa dữ liệu.

## Kiến trúc
- Cloudflare Worker `farmbase-social` (`wrangler.jsonc`), mã trong `src/`, giao diện tĩnh trong `public/` (Assets, chế độ SPA). Worker chỉ chạy cho `/api/*`.
- D1 binding `DB`, migration trong `migrations/` (đánh số tăng dần, không sửa migration đã chạy).
- Biến bí mật: `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD`, `TOKEN_KEY`, `FB_APP_SECRET`. Biến thường: `FB_APP_ID`, `FB_API_VERSION`, tùy chọn `FB_SCOPES`.
- App Meta "FarmBase Fanpage", ID 1693553165520150, đang ở chế độ phát triển.

## Quy ước mã
- JavaScript thuần, không bước build. Router trong `src/index.js` (bảng `ROUTES`, tùy chọn `public`, `allowMustChange`, `nav`).
- Mọi thao tác ghi phải qua kiểm tra cùng nguồn (CSRF) trong router; quyền kiểm tra bằng `requireRole` và `allowedPageIds`.
- Ghi nhật ký mọi thao tác quan trọng bằng `audit()`. Thêm nhãn tiếng Việt cho hành động mới vào `ACTIONS` trong `public/app.js`.
- Mật khẩu: PBKDF2 100.000 vòng. Mã Trang: AES-GCM với khóa từ `TOKEN_KEY`.
- Giao diện: một file `public/app.js`, định tuyến `#/<trang>`, slug không dấu. Luôn `esc()` dữ liệu trước khi chèn HTML.

## Kiểm tra trước khi push
1. `npm run dev` (chạy nền), rồi `node tests/unit.mjs && node tests/e2e.mjs`.
2. Xem ảnh trong `test-output/` (máy tính 1366, điện thoại 390).
3. Commit tiếng Việt. `main` tự triển khai khi Worker đã nối GitHub.
