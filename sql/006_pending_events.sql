USE litechat;

-- Tracks events that need to be delivered to users via long-polling.
-- When a message is sent or a reaction is added, one row per recipient is inserted.
-- When the user polls and receives the event, the row is deleted (acknowledged).
CREATE TABLE pending_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL COMMENT 'Recipient user ID',
    type ENUM('message', 'reaction') NOT NULL DEFAULT 'message',
    conversation_id BIGINT UNSIGNED NOT NULL,
    message_id BIGINT UNSIGNED DEFAULT NULL,
    reaction_id BIGINT UNSIGNED DEFAULT NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),

    KEY idx_user_pending (user_id, id),
    CONSTRAINT fk_pe_conversation FOREIGN KEY (conversation_id)
        REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB;
