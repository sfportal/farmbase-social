-- Kho ảnh, video theo từng Fanpage: gắn Trang, chủ đề con, nguồn (tải lên hay AI tạo) và ghi chú (prompt đã dùng).
ALTER TABLE social_media ADD COLUMN page_id TEXT;
ALTER TABLE social_media ADD COLUMN topic_id INTEGER;
ALTER TABLE social_media ADD COLUMN source TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE social_media ADD COLUMN note TEXT NOT NULL DEFAULT '';
-- Ảnh, video đã gắn vào bài thì lấy Trang của bài.
UPDATE social_media SET page_id = (
  SELECT c.page_id FROM social_content c, json_each(c.media_ids) j WHERE c.media_ids IS NOT NULL AND j.value = social_media.id LIMIT 1
) WHERE page_id IS NULL;
CREATE INDEX social_idx_media_page ON social_media(page_id, created_at);
