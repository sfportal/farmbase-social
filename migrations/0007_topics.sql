-- Kho chủ đề nội dung theo từng Fanpage, kho kiến thức, kế hoạch tuần và trợ lý AI soạn bài hằng ngày.

-- Chủ đề (parent_id NULL) và chủ đề con (parent_id = chủ đề cha). Chủ đề con là đơn vị lên lịch và viết bài.
CREATE TABLE social_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL REFERENCES social_pages(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES social_topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',        -- mục tiêu truyền thông
  audience TEXT NOT NULL DEFAULT '',    -- đối tượng
  hook TEXT NOT NULL DEFAULT '',        -- câu móc mẫu (mỗi dòng một phương án)
  message TEXT NOT NULL DEFAULT '',     -- thông điệp chính
  cta TEXT NOT NULL DEFAULT '',         -- lời kêu gọi hành động
  facts TEXT NOT NULL DEFAULT '',       -- dữ kiện được phép dùng (mỗi dòng một ý)
  ideas TEXT NOT NULL DEFAULT '',       -- ý bài viết (mỗi dòng một ý)
  formats TEXT NOT NULL DEFAULT '',     -- định dạng: ảnh 4:5, carousel, Reels 15 giây...
  visual TEXT NOT NULL DEFAULT '',      -- mô tả hình ảnh, video cần làm
  prompt_ids TEXT NOT NULL DEFAULT '',  -- mã mẫu trong Thư viện prompt, cách nhau dấu phẩy
  storyboard_id TEXT NOT NULL DEFAULT '', -- mã storyboard mẫu trong Thư viện prompt
  ads TEXT NOT NULL DEFAULT '',         -- gợi ý chạy quảng cáo
  keywords TEXT NOT NULL DEFAULT '',    -- từ khóa để lọc tin tức liên quan
  share INTEGER NOT NULL DEFAULT 0,     -- tỷ trọng (%) của chủ đề cha trong kế hoạch
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  sort INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES social_users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX social_idx_topics_page ON social_topics(page_id, parent_id, sort);

-- Kho kiến thức: tài liệu nạp vào, tin tức hệ thống tự đọc, góp ý của người duyệt. digest là bản tóm tắt ngắn đưa cho AI (tiết kiệm token).
CREATE TABLE social_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT REFERENCES social_pages(id) ON DELETE CASCADE, -- NULL: dùng cho mọi Trang
  kind TEXT NOT NULL CHECK (kind IN ('doc','news','feedback')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  digest TEXT NOT NULL DEFAULT '',
  url TEXT,
  topic_id INTEGER REFERENCES social_topics(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES social_users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX social_idx_knowledge_page ON social_knowledge(page_id, kind, created_at);
CREATE INDEX social_idx_knowledge_url ON social_knowledge(url);

-- Kế hoạch tuần theo Trang (week_start: thứ Hai, dạng YYYY-MM-DD giờ Việt Nam), body là JSON.
CREATE TABLE social_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL REFERENCES social_pages(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (page_id, week_start)
);

-- Đề xuất cập nhật chủ đề do AI đưa ra từ tin tức, tài liệu, góp ý; người dùng chấp nhận hoặc bỏ qua.
CREATE TABLE social_topic_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL REFERENCES social_pages(id) ON DELETE CASCADE,
  topic_id INTEGER REFERENCES social_topics(id) ON DELETE CASCADE, -- NULL: đề xuất chủ đề con mới
  parent_id INTEGER REFERENCES social_topics(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('new','update')),
  payload TEXT NOT NULL,   -- JSON các trường đề xuất
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX social_idx_sugg_page ON social_topic_suggestions(page_id, status);

-- Bài do trợ lý AI soạn: gắn chủ đề con và ghi chú (lý do, hình ảnh, prompt, storyboard, kết quả tự kiểm tra, gợi ý website).
ALTER TABLE social_content ADD COLUMN topic_id INTEGER REFERENCES social_topics(id) ON DELETE SET NULL;
ALTER TABLE social_content ADD COLUMN ai_meta TEXT;
