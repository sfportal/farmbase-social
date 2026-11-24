-- Video tham khảo: video YouTube (clip và Shorts) tìm theo từ khóa mỗi sáng, có link, lượt xem, ngày đăng và ý tưởng AI rút ra.
-- Reels (Facebook, Instagram) và TikTok: nhân sự dán link (source = 'manual'), có thể gắn đối thủ.
CREATE TABLE social_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL DEFAULT 'youtube',
  kind TEXT NOT NULL,
  video_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  channel_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  thumb TEXT,
  published_at INTEGER,
  duration_s INTEGER,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  keyword TEXT NOT NULL DEFAULT '',
  idea TEXT NOT NULL DEFAULT '',
  competitor_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'auto',
  created_by INTEGER,
  starred INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (platform, video_id)
);
CREATE INDEX social_idx_videos_seen ON social_videos(first_seen_at);
