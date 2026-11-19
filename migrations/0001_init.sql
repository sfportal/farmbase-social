-- Giai đoạn 1: tài khoản, phiên đăng nhập, Fanpage, phân quyền theo Fanpage, nhật ký.

CREATE TABLE social_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('owner','manager','editor','agent')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE social_sessions (
  id TEXT PRIMARY KEY,              -- SHA-256 của mã phiên, không lưu mã gốc
  user_id INTEGER NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX social_idx_sessions_user ON social_sessions(user_id);

CREATE TABLE social_pages (
  id TEXT PRIMARY KEY,              -- id Fanpage trên Facebook
  name TEXT NOT NULL,
  category TEXT,
  picture_url TEXT,
  access_token_enc TEXT,            -- mã Trang dài hạn, mã hóa AES-GCM
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','error','disconnected')),
  fan_count INTEGER,
  followers_count INTEGER,
  stats_at INTEGER,
  last_error TEXT,
  connected_by INTEGER REFERENCES social_users(id),
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE social_user_pages (
  user_id INTEGER NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES social_pages(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, page_id)
);

CREATE TABLE social_oauth_states (
  state TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE social_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX social_idx_audit_created ON social_audit_log(created_at DESC);
