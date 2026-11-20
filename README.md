# FarmBase Social

Trang quản trị nội bộ để quản lý nhiều Fanpage Facebook: tài khoản nhân viên, phân quyền theo Fanpage, kết nối Fanpage, và (các giai đoạn sau) lịch đăng bài, hộp thư chung, trả lời tự động, CRM mini.

Chạy trên Cloudflare Workers + D1 (gói miễn phí; dùng chung D1 `farmbase` của website, bảng có tiền tố `social_`). Giao diện là PWA, dùng trên máy tính và cài được lên điện thoại.

- Cài đặt trên Cloudflare: [docs/CAI-DAT.md](docs/CAI-DAT.md)
- Hướng dẫn cho người làm tiếp (người hoặc Claude): [CLAUDE.md](CLAUDE.md)

## Trạng thái

| Giai đoạn | Nội dung | Trạng thái |
| --- | --- | --- |
| 1 | Đăng nhập, vai trò, đổi mật khẩu lần đầu, khóa khi nhập sai, quản lý nhân viên, giao Fanpage, kết nối Fanpage bằng đăng nhập Facebook, nhật ký | Xong |
| 2 | Xem bài đăng và số tương tác từng bài theo Fanpage | Xong |
| 2 | Lịch nội dung, gửi duyệt, duyệt, đăng ngay hoặc hẹn giờ bằng lịch của Facebook | Xong |
| 3 | Webhook, hộp thư chung (tin nhắn, bình luận), trả lời trong hệ thống, tự nhắn riêng và trả lời công khai khi khách bình luận | Xong |
| 3 | AI gợi ý câu trả lời | Chưa làm |
| Thêm | Quảng cáo: xem tài khoản quảng cáo, chiến dịch, ngân sách, chi tiêu, tin nhắn, chi phí mỗi kết quả theo khoảng thời gian (chỉ đọc, quyền `ads_read`) | Xong |
| Thêm | Quảng cáo: tạm dừng, bật lại chiến dịch, đổi ngân sách | Chưa làm |
| 4 | CRM mini, ghi đơn, kho kiến thức AI, báo cáo tuần | Chưa làm |

## API

Hẹn giờ dùng `scheduled_publish_time` của Facebook (10 phút đến 30 ngày), nên Facebook tự đăng đúng giờ, không cần tác vụ chạy nền.


| Phương thức | Đường dẫn | Quyền |
| --- | --- | --- |
| GET | `/api/health` | Công khai |
| POST | `/api/auth/login` | Công khai |
| POST | `/api/auth/logout` | Công khai |
| GET | `/api/auth/me` | Công khai (trả `user: null` khi chưa đăng nhập) |
| POST | `/api/auth/change-password` | Đã đăng nhập |
| POST | `/api/auth/logout-all` | Đã đăng nhập |
| GET, POST | `/api/users` | Chủ hệ thống |
| PATCH | `/api/users/:id` | Chủ hệ thống |
| POST | `/api/users/:id/reset-password`, `/api/users/:id/unlock` | Chủ hệ thống |
| GET | `/api/audit` | Chủ hệ thống |
| GET | `/api/pages` | Đã đăng nhập (chỉ Fanpage được giao) |
| GET | `/api/pages/:id/posts?after=&limit=` | Đã đăng nhập (Fanpage được giao): bài đăng kèm số cảm xúc, bình luận, chia sẻ |
| GET | `/api/posts?limit=` | Đã đăng nhập: bài mới nhất của mọi Fanpage được giao, gộp theo thời gian |
| POST | `/api/pages/:id/refresh` | Chủ hệ thống, Quản lý |
| POST | `/api/pages/:id/disconnect` | Chủ hệ thống |
| GET, POST | `/api/content` | Đã đăng nhập (Fanpage được giao); soạn bài: trừ Chăm sóc khách hàng; `action=publish`: Chủ hệ thống, Quản lý |
| PATCH, DELETE | `/api/content/:id` | Người soạn hoặc Quản lý; chỉ bài chưa lên Facebook |
| POST | `/api/content/:id/submit` | Người soạn |
| POST | `/api/content/:id/approve` `{ page_ids?, scheduled_at? }`: duyệt, chọn lại Fanpage (một hoặc nhiều) và giờ đăng; `/reject`, `/cancel` | Chủ hệ thống, Quản lý |
| POST | `/api/media?name=` (thân là file ảnh JPG/PNG/GIF/WEBP ≤ 10 MB hoặc video MP4/MOV ≤ 95 MB, lưu R2 `MEDIA`) | Mọi vai trò trừ Chăm sóc khách hàng |
| GET | `/api/media/file/:key` (công khai, tên ngẫu nhiên, để Facebook tải về) | Công khai |
| GET, PUT | `/api/rules`: quy định đăng bài (văn phong cho AI) | Xem: mọi người · Sửa: Chủ hệ thống, Quản lý |
| POST | `/api/ai/write` `{ brief, current?, length?, page_ids? }`: AI viết bài theo quy định (Workers AI `AI`) | Mọi vai trò trừ Chăm sóc khách hàng |
| GET, POST | `/api/fb/webhook`: Facebook xác minh (verify token suy ra từ `TOKEN_KEY`) và gửi tin nhắn, bình luận mới (kiểm tra chữ ký bằng `FB_APP_SECRET`) | Công khai |
| GET | `/api/inbox?kind=&page_id=&unread=1&before=`: danh sách cuộc trò chuyện theo Trang được giao | Mọi vai trò |
| GET | `/api/inbox/:id`: tin trong cuộc trò chuyện, đánh dấu đã đọc | Mọi vai trò |
| POST | `/api/inbox/:id/reply` `{ text, mode: message\|public\|private, comment_id? }`: trả lời tin nhắn (trong 24 giờ), trả lời công khai hoặc nhắn riêng bình luận (1 lần, trong 7 ngày) | Mọi vai trò |
| GET, PUT | `/api/pages/:id/autoreply` `{ enabled, message, public_enabled, public_text }`: tự trả lời khi khách bình luận lần đầu trên mỗi bài, `{ten}` chèn tên khách | Xem: mọi vai trò; sửa: Chủ hệ thống, Quản lý |
| GET | `/api/ads/accounts`: tài khoản quảng cáo của người kết nối Facebook (dùng mã người dùng dài hạn lưu khi kết nối) | Chủ hệ thống, Quản lý |
| GET | `/api/ads/accounts/:id/campaigns?preset=today\|yesterday\|last_7d\|last_30d\|this_month\|last_month`: chiến dịch, ngân sách, chi tiêu, kết quả và tổng | Chủ hệ thống, Quản lý |
| GET | `/api/fb/status`, `/api/fb/connect`, `/api/fb/callback` | Chủ hệ thống |

## Chạy thử trên máy

```
npm run dev          # D1 cục bộ, cổng 8790
node tests/unit.mjs  # kiểm tra băm mật khẩu, mã hóa
node tests/e2e.mjs   # toàn luồng API + chụp giao diện máy tính và điện thoại vào test-output/
```

Tài khoản thử trên máy nằm trong `wrangler.test.jsonc` (chỉ dùng cục bộ).
