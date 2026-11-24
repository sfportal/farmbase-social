-- Giám sát nhân sự: lưu thiết bị (trình duyệt) của mỗi thao tác, thời điểm hoạt động gần nhất của từng tài khoản,
-- và chỉ mục để lọc nhật ký theo nhân viên.
ALTER TABLE social_audit_log ADD COLUMN user_agent TEXT;
ALTER TABLE social_users ADD COLUMN last_seen_at INTEGER;
CREATE INDEX social_idx_audit_user ON social_audit_log(user_id, created_at);
