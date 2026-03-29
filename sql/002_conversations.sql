USE litechat;

CREATE TABLE conversations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    type ENUM('direct', 'group') NOT NULL DEFAULT 'direct',
    name VARCHAR(255) DEFAULT NULL COMMENT 'Display name for group conversations',
    created_by INT UNSIGNED NOT NULL COMMENT 'User ID from authdb.users',
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    KEY idx_created_by (created_by)
) ENGINE=InnoDB;

CREATE TABLE conversation_members (
    conversation_id BIGINT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL COMMENT 'User ID from authdb.users',
    joined_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (conversation_id, user_id),
    KEY idx_user (user_id, conversation_id),
    CONSTRAINT fk_cm_conversation FOREIGN KEY (conversation_id)
        REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB;
