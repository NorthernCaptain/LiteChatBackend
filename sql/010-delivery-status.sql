ALTER TABLE pending_events MODIFY COLUMN type
    ENUM('message', 'reaction', 'typing', 'delivery', 'read') NOT NULL DEFAULT 'message';

ALTER TABLE messages ADD COLUMN delivered TINYINT NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN read_at TINYINT NOT NULL DEFAULT 0;
