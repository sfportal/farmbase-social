# FarmBase Social

Trang quản trị nội bộ để quản lý nhiều Fanpage Facebook: tài khoản nhân viên, phân quyền theo Fanpage, kết nối Fanpage, và (các giai đoạn sau) lịch đăng bài, hộp thư chung, trả lời tự động, CRM mini.

Chạy trên Cloudflare Workers + D1 (gói miễn phí; dùng chung D1 `farmbase` của website, bảng có tiền tố `social_`). Giao diện là PWA, dùng trên máy tính và cài được lên điện thoại.

- Cài đặt trên Cloudflare: [docs/CAI-DAT.md](docs/CAI-DAT.md)
- Hướng dẫn cho người làm tiếp (người hoặc Claude): [CLAUDE.md](CLAUDE.md)

## Trạng thái

| Giai đoạn | Nội dung | Trạng thái |
| --- | --- | --- |
| 1 | Đăng nhập, vai trò, đổi mật khẩu lần đầu, khóa khi nhập sai, quản lý nhân viên, giao Fanpage, kết nối Fanpage bằng đăng nhập Facebook, nhật ký | Xong |
| 2 | Lịch nội dung, duyệt, đăng bài tự động, số liệu từng bài | Chưa làm |
| 3 | Webhook, hộp thư chung, trả lời bình luận và tin nhắn tự động, AI | Chưa làm |
| 4 | CRM mini, ghi đơn, kho kiến thức AI, báo cáo tuần | Chưa làm |

## API (giai đoạn 1)

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
| POST | `/api/pages/:id/refresh` | Chủ hệ thống, Quản lý |
| POST | `/api/pages/:id/disconnect` | Chủ hệ thống |
| GET | `/api/fb/status`, `/api/fb/connect`, `/api/fb/callback` | Chủ hệ thống |

## Chạy thử trên máy

```
npm run dev          # D1 cục bộ, cổng 8790
node tests/unit.mjs  # kiểm tra băm mật khẩu, mã hóa
node tests/e2e.mjs   # toàn luồng API + chụp giao diện máy tính và điện thoại vào test-output/
```

Tài khoản thử trên máy nằm trong `wrangler.test.jsonc` (chỉ dùng cục bộ).
