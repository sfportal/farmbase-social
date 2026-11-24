# CLAUDE.md: hướng dẫn làm tiếp FarmBase Social

## Người dùng
- Salefronts không viết code, nhắn bằng tiếng Việt. Trả lời bằng tiếng Việt, giọng doanh nghiệp.
- Đặc tả đầy đủ: tài liệu "Đặc tả hệ thống FarmBase Social: quản lý nhiều Fanpage" (Claude Docs). Lộ trình 4 giai đoạn, xem bảng trong README.md.
- Repo này **công khai**: không ghi email, mật khẩu, khóa, mã truy cập vào repo. Không xin người dùng dán khóa vào chat.
- Phải xin phép trước khi: gửi tin nhắn hoặc đăng bài thật lên Fanpage, xóa dữ liệu.

## Kiến trúc
- Cloudflare Worker `farmbase-social` (`wrangler.jsonc`), mã trong `src/`, giao diện tĩnh trong `public/` (Assets, chế độ SPA). Worker chỉ chạy cho `/api/*`.
- D1 binding `DB`: **dùng chung D1 `farmbase` của website farmbase.vn** (gói miễn phí giới hạn 10 D1). Mọi bảng phải có tiền tố `social_`, bảng theo dõi migration là `social_migrations`. Không bao giờ đọc, sửa hay xóa bảng không có tiền tố `social_`.
- Migration trong `migrations/` (đánh số tăng dần, không sửa migration đã chạy).
- Biến bí mật: `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD`, `TOKEN_KEY`, `FB_APP_SECRET`; tùy chọn `ANTHROPIC_API_KEY` (Claude, ưu tiên) hoặc `DEEPSEEK_API_KEY` cho AI viết bài, không có thì dùng Workers AI (`src/lib/ai.js`: viết bài dùng `claude-sonnet-5-5`, việc nhanh dùng `claude-haiku-5-5`; đổi bằng `CLAUDE_MODEL`, `CLAUDE_FAST_MODEL`). Biến thường: `FB_APP_ID`, `FB_API_VERSION`, tùy chọn `FB_SCOPES`, `FB_CONFIG_ID` (cấu hình Facebook Login for Business "Quan ly Fanpage"; có thì gửi config_id thay cho scope), tùy chọn `PROMPT_CONTACT_EMAIL` (email liên hệ trong thư viện prompt, không có thì dùng `ADMIN_EMAIL`).
- **Thư viện prompt** (`public/prompt/`, menu "Thư viện prompt"): trang tĩnh độc lập, chỉ mở khi đã đăng nhập (`gate.js` gọi `/api/prompt/lien-he`). Không sửa tay: sửa ở thư mục dự án `thu-vien-prompt-video` rồi chạy `python3 tools/dua-len-social.py <repo>`. Email liên hệ ghi là `@@EMAIL@@`, trang tự điền sau khi đăng nhập.
- **Chủ đề và trợ lý AI**: `src/routes/topics.js` (chủ đề, kho kiến thức, đề xuất), `src/routes/assistant.js` (Cron 7h00 VN: đọc tin, kế hoạch tuần, soạn bài ngày mai ở trạng thái `pending`, không bao giờ tự đăng), bộ mẫu trong `src/lib/topic-templates.js` (dữ kiện phải khớp quy tắc nội dung; `tests/unit.mjs` kiểm tra). Bài trợ lý có `topic_id`, `ai_meta` (JSON) trong `social_content`. Mỗi chỗ đăng soạn 2 phương án (`ai_meta.slot`, `option` A/B; cài đặt `options`), duyệt 1 phương án thì `approveContent` tự từ chối phương án cùng `slot`. Mỗi ngày thêm 1 bài chia sẻ tin báo (`ai_meta.kind = 'share'`, `share_url`, cột `link`; cài đặt `share`) chọn từ tin trong kho kiến thức 10 ngày, không chia sẻ trùng. Tầng AI `cheap` (đọc tin hằng ngày) mặc định Workers AI, đọc lỗi thì Claude Haiku đọc lại (`ai_models.cheap`). Tài liệu (`kind = 'doc'`) trong kho kiến thức luôn đưa vào ngữ cảnh viết bài. Tương tác bài đã đăng 7/15/30 ngày: `src/routes/engagement.js` (lưu tạm 12 giờ ở `engagement:<id Trang>`), dùng khi lập kế hoạch, soạn bài và đề xuất cân chỉnh chủ đề (thứ Hai, thứ Năm; đề xuất tỷ trọng lưu `payload.shares`). Model Claude chọn trên trang Trợ lý AI (`ai_models` trong social_settings, ưu tiên hơn biến môi trường). Quy tắc cứng `ruleCheck`: không nêu số hộ, diện tích, số vùng đã triển khai (trừ khi góp ý yêu cầu), không CCCD, sổ đỏ, ủy quyền.
- **Prompt cho hình ảnh, video**: `src/lib/prompt-lib.js` tự sinh từ `public/prompt/data.js` bằng `python3 tools/prompt-index.py` (chạy lại sau mỗi lần cập nhật Thư viện; `tests/unit.mjs` kiểm tra khớp). Bài trợ lý có `ai_meta.media_prompt` (prompt hoàn chỉnh để Quý khách tự tạo hình bằng Claude). Thứ Hai trợ lý đề xuất prompt mới (`prompt_suggestions`), duyệt thì vào `prompt_extra` (mã `bs-NN`). Hệ thống không tự tạo ảnh, video.
- **Tạo prompt hình ảnh, video trong khung Soạn bài**: `POST /api/ai/media-prompt` (`aiMediaPrompt` trong `src/routes/assistant.js`): `pickMediaTemplates` chọn tối đa 6 mẫu cùng loại trong Thư viện theo từ khóa của bài, AI chọn 1 mẫu và viết prompt 8 mục; video thêm `storyline`, `storyboard`. Lưu cùng bài qua `ai_media` khi tạo, sửa bài (`ai_meta` có `manual: 1`, không hiện trong danh sách trợ lý AI).
- **Kho ảnh, video** (`#/kho-media`): bảng `social_media` có `page_id`, `topic_id`, `source` (upload|ai), `note`; file trong R2 `MEDIA`. Chỉ xóa được file chưa gắn bài.
- App Meta "FarmBase Social", ID 1683859133415974 (chủ sở hữu: Công ty Cổ phần BVI), đã Publish (chạy thật) ngày 20/11/2026, quyền ở mức cơ bản: chỉ dùng cho Trang mà người có vai trò trong app quản lý; không đăng ký Tech Provider.

## Quy ước mã
- JavaScript thuần, không bước build. Router trong `src/index.js` (bảng `ROUTES`, tùy chọn `public`, `allowMustChange`, `nav`).
- Mọi thao tác ghi phải qua kiểm tra cùng nguồn (CSRF) trong router; quyền kiểm tra bằng `requireRole` và `allowedPageIds`.
- Ghi nhật ký mọi thao tác quan trọng bằng `audit()`. Thêm nhãn tiếng Việt cho hành động mới vào `ACTIONS` trong `public/app.js`.
- Mật khẩu: PBKDF2 25.000 vòng (vừa giới hạn 10 ms CPU gói miễn phí; số vòng lưu trong chuỗi băm nên nâng được sau). Mã Trang: AES-GCM với khóa từ `TOKEN_KEY`.
- Giao diện: một file `public/app.js`, định tuyến `#/<trang>`, slug không dấu. Luôn `esc()` dữ liệu trước khi chèn HTML.

## Kiểm tra trước khi push
1. `npm run dev` (chạy nền), rồi `node tests/unit.mjs && node tests/e2e.mjs`.
2. Xem ảnh trong `test-output/` (máy tính 1366, điện thoại 390).
3. Commit tiếng Việt. `main` tự triển khai khi Worker đã nối GitHub.
