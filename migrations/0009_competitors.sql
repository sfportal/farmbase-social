-- Theo dõi đối thủ: danh sách đối thủ và các mục ghi nhận (quảng cáo, bài Fanpage, bài website, tin báo), mỗi mục có đường dẫn chi tiết.
CREATE TABLE social_competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  fb_url TEXT,
  fb_page_id TEXT,
  keywords TEXT NOT NULL DEFAULT '',
  website TEXT,
  feed_url TEXT,
  feed_type TEXT,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  last_fetch_at INTEGER,
  last_error TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE social_competitor_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ext_id TEXT NOT NULL,
  url TEXT,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  image TEXT,
  fmt TEXT NOT NULL DEFAULT '',
  angle TEXT NOT NULL DEFAULT '',
  cta TEXT NOT NULL DEFAULT '',
  started_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual',
  created_by INTEGER,
  UNIQUE (competitor_id, kind, ext_id)
);
CREATE INDEX social_idx_citems_seen ON social_competitor_items(first_seen_at);
CREATE INDEX social_idx_citems_comp ON social_competitor_items(competitor_id, first_seen_at);

-- Danh sách ban đầu: 11 đối thủ và quảng cáo ghi nhận thủ công ngày 24/11/2026 trên Thư viện quảng cáo Meta (Việt Nam).

INSERT INTO social_competitors (id, name, kind, fb_url, fb_page_id, keywords, website, note, created_at) VALUES (1, 'Base EUDR (Base.vn)', 'Phần mềm truy xuất, nhắm doanh nghiệp cao su, gỗ, cà phê', 'https://www.facebook.com/61596268044776/', '61596268044776', 'Base EUDR', NULL, '151 người theo dõi (trang mới). Họ chạy dồn dập ngay trước mốc 30/12, bám đúng một nỗi đau (dữ liệu rời rạc) và dùng sự kiện có giới hạn chỗ để lấy khách. Trang mới, tương tác thấp: sức đẩy chủ yếu đến từ quảng cáo.', 1795521600);
INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, fmt, angle, cta, started_at, first_seen_at, last_seen_at, source) VALUES (1, 'ad', 'ghi-nhan-2411-1', 'https://www.facebook.com/ads/library/?id=&q=EUDR', 'Đếm ngược mốc EUDR 30/12/2026; nỗi đau', 'Số phiên bản: nhiều mẫu, có mẫu 4 phiên bản.', 'Ảnh, bài dài', 'Đếm ngược mốc EUDR 30/12/2026; nỗi đau: dữ liệu vùng nguyên liệu nằm trên Excel, chứng từ rải rác, phải tổng hợp tay khi đối tác hỏi; hứa chứng minh nguồn gốc đến từng thửa đất.', 'Đăng ký tư vấn, gửi tin nhắn', 1795176000, 1795521600, 1795521600, 'manual');
INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, fmt, angle, cta, started_at, first_seen_at, last_seen_at, source) VALUES (1, 'ad', 'ghi-nhan-2411-2', 'https://www.facebook.com/ads/library/?id=&q=EUDR', 'Hội thảo thực hành miễn phí 04/12/2026 cùng PEFC, HAWA, giới hạn 80 doanh nghiệp', 'Số phiên bản: 2 trang cùng chạy (Base.vn và Base EUDR).', 'Sự kiện', 'Hội thảo thực hành miễn phí 04/12/2026 cùng PEFC, HAWA, giới hạn 80 doanh nghiệp: tạo khan hiếm và có ngày cụ thể.', 'Đăng ký tham dự', 1795089600, 1795521600, 1795521600, 'manual');
INSERT INTO social_competitors (id, name, kind, fb_url, fb_page_id, keywords, website, note, created_at) VALUES (2, 'NextFarm', 'Nền tảng AI cho trang trại, tem QR', NULL, NULL, 'NextFarm', NULL, 'Carousel "N việc sản phẩm làm cho bạn" dễ lướt, mỗi thẻ một lợi ích. Hợp với chuyên mục Công cụ số của FarmBase.', 1795521600);
INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, fmt, angle, cta, started_at, first_seen_at, last_seen_at, source) VALUES (2, 'ad', 'ghi-nhan-2411-1', 'https://www.facebook.com/ads/library/?id=&q=%22nh%E1%BA%ADt%20k%C3%BD%20canh%20t%C3%A1c%22', '"4 việc AI làm cho trang trại"', 'Số phiên bản: 2 mẫu.', 'Carousel', '"4 việc AI làm cho trang trại": hỏi trợ lý bằng một câu, chụp lá nhận bệnh, tem QR từng lô hàng. Mỗi thẻ một lợi ích, chữ rất ngắn.', 'Learn more (về website)', 1794744000, 1795521600, 1795521600, 'manual');
INSERT INTO social_competitors (id, name, kind, fb_url, fb_page_id, keywords, website, note, created_at) VALUES (3, 'Qcert', 'Tổ chức chứng nhận, dịch vụ mã số vùng trồng', 'https://www.facebook.com/qcert.vn/', NULL, 'Qcert', NULL, '16 nghìn người theo dõi. Biến văn bản mới thành lời kêu gọi hành động ngay. Lưu ý: họ viết như thể mình "cấp mã", FarmBase không được viết vậy. Học cách dùng tin chính sách, không học câu chữ.', 1795521600);
INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, fmt, angle, cta, started_at, first_seen_at, last_seen_at, source) VALUES (3, 'ad', '1131153172655563', 'https://www.facebook.com/ads/library/?id=1131153172655563', 'Tin chính sách làm móc', 'Số phiên bản: 1.', 'Ảnh, bài dài', 'Tin chính sách làm móc: thủ tục cấp mã nhanh, chuyển sang hậu kiểm; tạo cảm giác "chớp thời cơ" trước vụ sầu riêng.', 'Hotline, nhắn tin, website', 1794571200, 1795521600, 1795521600, 'manual');
INSERT INTO social_competitors (id, name, kind, fb_url, fb_page_id, keywords, website, note, created_at) VALUES (4, 'Ecolar', 'Tư vấn canh tác, hồ sơ mã vùng, nhật ký số', 'https://www.facebook.com/Loisongxanhecolar', NULL, 'Ecolar', NULL, '28 nghìn người theo dõi. Đăng gần như mỗi ngày bằng Reels kiến thức khoảng 1 phút, tít dạng câu hỏi hoặc cảnh báo. Có nhóm cộng đồng để giữ chân. Tương tác vẫn thấp (2–6 cảm xúc mỗi bài).', 1795521600);
INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, fmt, angle, cta, started_at, first_seen_at, last_seen_at, source) VALUES (4, 'ad', '957229950591875', 'https://www.facebook.com/ads/library/?id=957229950591875', 'Bưởi xuất khẩu', 'Số phiên bản: 1.', 'Video 1:25', 'Bưởi xuất khẩu: "đừng đợi đến lúc thu hoạch". Gói 4 giải pháp (kỹ thuật, thăm vườn, hồ sơ mã vùng kèm nhật ký trên điện thoại, kết nối thu mua). Có khan hiếm: nhận số vườn giới hạn.', 'Đăng ký tư vấn, Hotline/Zalo, mời vào nhóm cộng đồng', 1795089600, 1795521600, 1795521600, 'manual');
INSERT INTO social_competitors (id, name, kind, fb_url, fb_page_id, keywords, website, note, created_at) VALUES (5, 'Hợp Trí Summit', 'Vật tư, quy trình chăm sóc sầu riêng', 'https://www.facebook.com/QuytrinhHopTri/', NULL, 'Hợp Trí Summit', NULL, 'Công thức nỗi đau, nguyên nhân, giải pháp, kèm CTA bình luận từ khóa (tăng tương tác, dễ cài trả lời tự động). 4 phiên bản cho thấy họ đang thử nhiều mẫu.', 1795521600);
INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, fmt, angle, cta, started_at, first_seen_at, last_seen_at, source) VALUES (5, 'ad', '1629963042005064', 'https://www.facebook.com/ads/library/?id=1629963042005064', 'Cảnh báo cadimi', 'Số phiên bản: 4 phiên bản.', 'Ảnh, bài dài', 'Cảnh báo cadimi: nỗi đau mất trắng vụ, bị đình chỉ mã; giải thích 4 nguyên nhân; rồi đưa quy trình sản phẩm.', 'Bình luận "TƯ VẤN" hoặc nhắn tin', 1794916800, 1795521600, 1795521600, 'manual');
INSERT INTO social_competitors (id, name, kind, fb_url, fb_page_id, keywords, website, note, created_at) VALUES (6, 'ICERT Group', 'Tư vấn chứng nhận', 'https://www.facebook.com/ICERT.GROUP/', NULL, 'ICERT Group', NULL, 'Quảng cáo chạy lâu thường là mẫu hiệu quả (suy luận, Meta không công bố số). Dạng checklist theo văn bản pháp luật nhắm doanh nghiệp.', 1795521600);
INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, fmt, angle, cta, started_at, first_seen_at, last_seen_at, source) VALUES (6, 'ad', '27738967315767425', 'https://www.facebook.com/ads/library/?id=27738967315767425', 'Nghị định 38/2026', 'Số phiên bản: 1.', 'Ảnh, bài dài', 'Nghị định 38/2026: doanh nghiệp xuất khẩu cần rà soát mã vùng trồng, mã cơ sở đóng gói; danh sách việc cần chủ động.', 'Nhắn tin, website', 1785326400, 1795521600, 1795521600, 'manual');
INSERT INTO social_competitors (id, name, kind, fb_url, fb_page_id, keywords, website, note, created_at) VALUES (7, 'Tập đoàn Trái cây Tài 001', 'Doanh nghiệp trái cây, dịch vụ tư vấn mã', 'https://www.facebook.com/tapdoantraicaytai001/', NULL, 'Tập đoàn Trái cây Tài 001', NULL, 'Ẩn dụ "hộ chiếu" dễ nhớ với bà con. Cạnh tranh trực tiếp mảng hồ sơ mã vùng.', 1795521600);
INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, fmt, angle, cta, started_at, first_seen_at, last_seen_at, source) VALUES (7, 'ad', '1647960526875103', 'https://www.facebook.com/ads/library/?id=1647960526875103', 'Mã vùng trồng và mã cơ sở đóng gói là "hộ chiếu" để sầu riêng đi chính ngạch; dịch vụ tư vấn trọn gói.', 'Số phiên bản: 1.', 'Ảnh, bài dài', 'Mã vùng trồng và mã cơ sở đóng gói là "hộ chiếu" để sầu riêng đi chính ngạch; dịch vụ tư vấn trọn gói.', 'Nhắn tin', 1795003200, 1795521600, 1795521600, 'manual');
INSERT INTO social_competitors (id, name, kind, fb_url, fb_page_id, keywords, website, note, created_at) VALUES (8, 'VFC Fumigation', 'Khử trùng hàng xuất khẩu', 'https://www.facebook.com/vfcfumigation/', NULL, 'VFC Fumigation', NULL, 'Mở bằng câu hỏi khách hay hỏi, trả lời gọn: hợp với chuyên mục Văn bản mới hoặc bài EUDR 16/12.', 1795521600);
INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, fmt, angle, cta, started_at, first_seen_at, last_seen_at, source) VALUES (8, 'ad', 'ghi-nhan-2411-1', 'https://www.facebook.com/ads/library/?id=&q=EUDR', 'Cà phê đi EU', 'Số phiên bản: 1.', 'Ảnh, hỏi đáp', 'Cà phê đi EU: phân biệt các loại hồ sơ dễ nhầm (kiểm dịch, khử trùng, EUDR) bằng câu hỏi thật của khách.', 'Nhắn tin', 1788004800, 1795521600, 1795521600, 'manual');
INSERT INTO social_competitors (id, name, kind, fb_url, fb_page_id, keywords, website, note, created_at) VALUES (9, 'Goldseedtech (GST Connect)', 'App vật tư, tra nguồn gốc', NULL, NULL, 'Goldseedtech', NULL, 'CTA bình luận chọn vai giúp phân loại khách ngay trong bình luận.', 1795521600);
INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, fmt, angle, cta, started_at, first_seen_at, last_seen_at, source) VALUES (9, 'ad', 'ghi-nhan-2411-1', 'https://www.facebook.com/ads/library/?id=&q=%22truy%20xu%E1%BA%A5t%20ngu%E1%BB%93n%20g%E1%BB%91c%22', 'Một app', 'Số phiên bản: 1.', 'Ảnh', 'Một app: mua vật tư, tra nguồn gốc, quản lý. Chia hai nhóm người xem: đại lý và nhà nông.', 'Bình luận "ĐẠI LÝ" hoặc "NHÀ NÔNG"', 1793966400, 1795521600, 1795521600, 'manual');
INSERT INTO social_competitors (id, name, kind, fb_url, fb_page_id, keywords, website, note, created_at) VALUES (10, 'BTrace', 'Nền tảng truy xuất nguồn gốc (Bear Technology, Hemera Tech)', NULL, NULL, 'BTrace', 'https://btrace.vn/tin-tuc', 'Không chạy quảng cáo Meta ở Việt Nam (không tìm thấy). Họ làm nội dung SEO dài theo công thức "X: hồ sơ thường thiếu gì". Website không gắn Fanpage.', 1795521600);
INSERT INTO social_competitors (id, name, kind, fb_url, fb_page_id, keywords, website, note, created_at) VALUES (11, 'FaceFarm', 'Nhật ký sản xuất của Sorimachi Việt Nam', NULL, NULL, 'FaceFarm', 'https://facefarm.vn/', 'Không thấy quảng cáo, không thấy nội dung mới. Kênh truyền thông gần như đứng yên: khoảng trống để FarmBase chiếm từ khóa "nhật ký sản xuất".', 1795521600);
