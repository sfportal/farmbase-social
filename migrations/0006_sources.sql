-- Nguồn nội dung: website (RSS, Atom, WordPress) và Fanpage đã kết nối, để xem bài rồi chia sẻ hoặc cho AI viết lại.
CREATE TABLE social_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('website','fanpage')),
  name TEXT NOT NULL,
  url TEXT,                 -- địa chỉ website người dùng nhập
  feed_url TEXT,            -- địa chỉ RSS/Atom/WordPress tìm được
  feed_type TEXT,           -- rss | wp
  page_id TEXT,             -- Fanpage đã kết nối (kind = fanpage)
  created_by INTEGER REFERENCES social_users(id),
  created_at INTEGER NOT NULL
);
