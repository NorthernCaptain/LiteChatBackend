USE litechat;

CREATE TABLE messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    conversation_id BIGINT UNSIGNED NOT NULL,
    sender_id INT UNSIGNED NOT NULL,
    text TEXT DEFAULT NULL,
    reference_message_id BIGINT UNSIGNED DEFAULT NULL COMMENT 'Reply-to message',
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),

    KEY idx_conv (conversation_id, id),
    KEY idx_sender (sender_id),
    CONSTRAINT fk_msg_conversation FOREIGN KEY (conversation_id)
        REFERENCES conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_msg_reference FOREIGN KEY (reference_message_id)
        REFERENCES messages(id) ON DELETE SET NULL
) ENGINE=InnoDB;
