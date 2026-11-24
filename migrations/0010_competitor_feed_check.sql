-- Theo dõi đối thủ: ngày dò RSS website gần nhất (website không có RSS thì 7 ngày mới dò lại).
ALTER TABLE social_competitors ADD COLUMN feed_checked_at INTEGER;
