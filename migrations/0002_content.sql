-- Giai đoạn 2: lịch nội dung, duyệt bài, đăng hoặc hẹn giờ lên Fanpage.

CREATE TABLE social_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL REFERENCES social_pages(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  link TEXT,
  image_url TEXT,
  scheduled_at INTEGER,             -- giờ muốn đăng (unix); NULL = đăng ngay khi duyệt
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending','rejected','scheduled','published','failed')),
  fb_post_id TEXT,                  -- id bài trên Facebook sau khi đăng hoặc hẹn giờ
  published_at INTEGER,
  reject_reason TEXT,
  last_error TEXT,
  created_by INTEGER REFERENCES social_users(id),
  approved_by INTEGER REFERENCES social_users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX social_idx_content_page ON social_content(page_id, status);
CREATE INDEX social_idx_content_time ON social_content(scheduled_at);
