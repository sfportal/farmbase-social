-- Giai đoạn 2b: quy định đăng bài (văn phong cho AI viết bài) và ảnh, video tải lên (lưu trong R2).

CREATE TABLE social_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_by INTEGER REFERENCES social_users(id),
  updated_at INTEGER NOT NULL
);

CREATE TABLE social_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL UNIQUE,      -- tên file ngẫu nhiên trong R2, cũng là đường dẫn công khai cho Facebook tải về
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  name TEXT,
  created_by INTEGER REFERENCES social_users(id),
  created_at INTEGER NOT NULL
);

-- Danh sách id ảnh, video của bài, dạng JSON, ví dụ [3,4,5]
ALTER TABLE social_content ADD COLUMN media_ids TEXT;
