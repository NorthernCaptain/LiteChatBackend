-- Run against LinesBackend authdb, not litechat database.
-- Adds chat access control and avatar support to the users table.

ALTER TABLE users ADD COLUMN chat_access TINYINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN avatar VARCHAR(255) DEFAULT NULL;
