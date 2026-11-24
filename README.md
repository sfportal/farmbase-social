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
| Thêm | Báo cáo hiệu quả Fanpage theo ngày, tuần (7, 15, 30, 90 ngày) | Xong |
| Thêm | Chủ đề nội dung theo Fanpage (chủ đề, chủ đề con, hook, thông điệp, CTA, dữ kiện, hình/video, prompt, storyboard, gợi ý ads), bộ mẫu Chiến dịch 10.000 ha và FarmBase | Xong |
| Thêm | Kho kiến thức (tài liệu, tin tức tự đọc, góp ý), đề xuất cập nhật chủ đề | Xong |
| Thêm | Trợ lý AI 7h00 mỗi sáng: kế hoạch tuần, 1–2 bài cho ngày mai chờ duyệt, tự kiểm tra, lý do, gợi ý website, góp ý để viết lại | Xong |
| 4 | CRM mini, ghi đơn, báo cáo tuần | Chưa làm |

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
| POST | `/api/media?name=&page_id=&topic_id=&source=upload\|ai&note=` gắn file vào kho của Fanpage, chủ đề con, ghi prompt đã dùng | Mọi vai trò trừ Chăm sóc khách hàng |
| GET | `/api/media?page_id=&kind=&topic_id=&source=&q=` kho ảnh, video của Trang, kèm bài đang dùng file | Mọi vai trò trừ Chăm sóc khách hàng (Trang được giao) |
| PATCH | `/api/media/:id` sửa tên, chủ đề, ghi chú | Mọi vai trò trừ Chăm sóc khách hàng |
| DELETE | `/api/media/:id` xóa file chưa dùng trong bài nào | Chủ hệ thống, Quản lý |
| PUT | `/api/assistant/models` `{ write, fast }` chọn model Claude (Haiku 5.5, Sonnet 5.5, Opus 5.5) | Chủ hệ thống |
| GET, PUT | `/api/rules`: quy định đăng bài (văn phong cho AI) | Xem: mọi người · Sửa: Chủ hệ thống, Quản lý |
| POST | `/api/ai/write` `{ brief, current?, length?, page_ids? }`: AI viết bài theo quy định (Claude nếu có `ANTHROPIC_API_KEY`, DeepSeek nếu có `DEEPSEEK_API_KEY`, nếu không dùng Workers AI `AI`) | Mọi vai trò trừ Chăm sóc khách hàng |
| GET, POST | `/api/sources` `{ kind: website, url }` hoặc `{ kind: fanpage, page_id }`: nguồn nội dung (website tự tìm RSS, Atom, WordPress; Fanpage chỉ là Trang đã kết nối) | Mọi vai trò trừ Chăm sóc khách hàng |
| GET | `/api/sources/:id/items`: bài viết (website), bài đăng và video (Fanpage) | Như trên |
| GET, POST | `/api/topics?page_id=`: cây chủ đề (Trang chưa có chủ đề, tên khớp bộ mẫu thì tự nạp mẫu); thêm chủ đề `{ page_id, parent_id?, ... }` | Xem: trừ Chăm sóc khách hàng · Sửa: Chủ hệ thống, Quản lý, Biên tập |
| PATCH, DELETE | `/api/topics/:id` | Sửa: như trên · Xóa: Chủ hệ thống, Quản lý |
| POST | `/api/topics/seed` `{ page_id, template: 10000ha \| farmbase, replace? }` (replace: thay toàn bộ chủ đề và hồ sơ Fanpage bằng bộ mẫu) | Chủ hệ thống, Quản lý |
| PUT | `/api/topics/brief` `{ page_id, brief }`: hồ sơ Fanpage cho AI | Chủ hệ thống, Quản lý, Biên tập |
| GET | `/api/topics/suggestions?page_id=`; POST `/api/topics/suggestions/:id/accept`, `/dismiss` | Như trên |
| GET, POST | `/api/knowledge`: kho kiến thức (AI tóm tắt tài liệu bằng Claude Haiku); PATCH, DELETE `/api/knowledge/:id` | Như trên; xóa: Chủ hệ thống, Quản lý |
| GET | `/api/assistant?page_id=`: cài đặt, kế hoạch tuần, bài trợ lý soạn, chi phí AI tháng | Trừ Chăm sóc khách hàng |
| PUT | `/api/assistant/settings`; POST `/api/assistant/run` `{ page_id, steps }`, `/api/assistant/plan-feedback` | Chủ hệ thống, Quản lý |
| POST | `/api/assistant/revise/:id` `{ feedback }`: viết lại theo góp ý, lưu góp ý cho các bài sau | Trừ Chăm sóc khách hàng |

Trợ lý chạy bằng Cron Trigger `0 0 * * *` (7h00 giờ Việt Nam): đọc tin từ nguồn, lập kế hoạch tuần nếu chưa có, soạn bài cho ngày mai ở trạng thái Chờ duyệt (không tự đăng), thứ Hai đề xuất cập nhật chủ đề. Chi phí Claude: `claude-haiku-5-5` cho tóm tắt, tự kiểm tra, đề xuất; `claude-sonnet-5-5` cho viết bài, kế hoạch (đổi bằng `CLAUDE_FAST_MODEL`, `CLAUDE_MODEL`); phần hướng dẫn cố định được cache; số token cộng dồn theo tháng trong `social_settings` khóa `ai_usage:YYYY-MM`.
| POST | `/api/sources/write` `{ url, title, summary, mode: share\|rewrite, length, page_ids }`: AI viết lời chia sẻ kèm liên kết, hoặc viết lại bài có dòng "Nguồn:" | Như trên |
| DELETE | `/api/sources/:id`: bỏ nguồn khỏi danh sách | Như trên |
| GET, POST | `/api/fb/webhook`: Facebook xác minh (verify token suy ra từ `TOKEN_KEY`) và gửi tin nhắn, bình luận mới (kiểm tra chữ ký bằng `FB_APP_SECRET`) | Công khai |
| GET | `/api/inbox?kind=&page_id=&unread=1&before=`: danh sách cuộc trò chuyện theo Trang được giao | Mọi vai trò |
| GET | `/api/inbox/:id`: tin trong cuộc trò chuyện, đánh dấu đã đọc | Mọi vai trò |
| POST | `/api/inbox/:id/reply` `{ text, mode: message\|public\|private, comment_id? }`: trả lời tin nhắn (trong 24 giờ), trả lời công khai hoặc nhắn riêng bình luận (1 lần, trong 7 ngày) | Mọi vai trò |
| GET, PUT | `/api/pages/:id/autoreply` `{ enabled, message, public_enabled, public_text }`: tự trả lời khi khách bình luận lần đầu trên mỗi bài, `{ten}` chèn tên khách | Xem: mọi vai trò; sửa: Chủ hệ thống, Quản lý |
| GET | `/api/ads/accounts`: tài khoản quảng cáo của người kết nối Facebook (dùng mã người dùng dài hạn lưu khi kết nối) | Chủ hệ thống, Quản lý |
| GET | `/api/ads/accounts/:id/campaigns?preset=today\|yesterday\|last_7d\|last_30d\|this_month\|last_month`: chiến dịch, ngân sách, chi tiêu, kết quả và tổng | Chủ hệ thống, Quản lý |
| GET | `/api/ads/campaigns/:id?preset=`: chi tiết chiến dịch: tổng, mọi loại kết quả, chi tiêu theo ngày, nhóm quảng cáo, mẫu quảng cáo, độ tuổi và giới tính, nền tảng (`preset` thêm `maximum` = toàn thời gian) | Chủ hệ thống, Quản lý |
| GET | `/api/report?page_id=&days=7\|15\|30\|90`: báo cáo Fanpage theo ngày: tin nhắn, bình luận, khách mới, trả lời, thời gian trả lời (từ hộp thư), bài đăng và tương tác, thống kê Trang (Page Insights, quyền `read_insights`), so với kỳ trước | Fanpage được giao |
| GET | `/api/fb/status`, `/api/fb/connect`, `/api/fb/callback` | Chủ hệ thống |

## Chạy thử trên máy

```
npm run dev          # D1 cục bộ, cổng 8790
node tests/unit.mjs  # kiểm tra băm mật khẩu, mã hóa
node tests/e2e.mjs   # toàn luồng API + chụp giao diện máy tính và điện thoại vào test-output/
```

Tài khoản thử trên máy nằm trong `wrangler.test.jsonc` (chỉ dùng cục bộ).
