USE litechat;

CREATE TABLE reactions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    message_id BIGINT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    emoji VARCHAR(32) NOT NULL COMMENT 'Emoji character or shortcode',
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE KEY uk_reaction (message_id, user_id, emoji),
    CONSTRAINT fk_react_message FOREIGN KEY (message_id)
        REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB;
