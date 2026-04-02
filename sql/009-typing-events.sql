ALTER TABLE pending_events MODIFY COLUMN type ENUM('message', 'reaction', 'typing') NOT NULL DEFAULT 'message';
ALTER TABLE pending_events ADD COLUMN meta JSON DEFAULT NULL;
