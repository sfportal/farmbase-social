-- Giai đoạn 3a: hộp thư chung (tin nhắn Messenger và bình luận), nhận qua webhook của Facebook.

-- Mỗi khách trên mỗi Trang có 1 cuộc trò chuyện tin nhắn và 1 luồng bình luận.
CREATE TABLE social_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL REFERENCES social_pages(id),
  kind TEXT NOT NULL CHECK (kind IN ('message','comment')),
  customer_id TEXT NOT NULL,          -- PSID (tin nhắn) hoặc id người bình luận
  customer_name TEXT,
  last_text TEXT,
  last_at INTEGER NOT NULL,
  last_in_at INTEGER,                 -- lần cuối khách nhắn (để tính khung 24 giờ của Messenger)
  unread INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (page_id, kind, customer_id)
);
CREATE INDEX social_conversations_last ON social_conversations (last_at DESC);

CREATE TABLE social_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES social_conversations(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  channel TEXT NOT NULL CHECK (channel IN ('message','comment','public_reply','private_reply')),
  text TEXT,
  fb_id TEXT UNIQUE,                  -- mid tin nhắn hoặc id bình luận, chống ghi trùng khi Facebook gửi lại
  comment_id TEXT,                    -- bình luận gốc (với bình luận và trả lời bình luận)
  post_id TEXT,
  auto INTEGER NOT NULL DEFAULT 0,    -- 1 nếu do trả lời tự động gửi
  sent_by INTEGER REFERENCES social_users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX social_messages_conv ON social_messages (conversation_id, created_at);
