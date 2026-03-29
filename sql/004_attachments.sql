USE litechat;

CREATE TABLE attachments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    message_id BIGINT UNSIGNED DEFAULT NULL,
    sender_id INT UNSIGNED NOT NULL,
    server_filename VARCHAR(255) NOT NULL COMMENT 'UUID-based filename on disk',
    original_filename VARCHAR(255) NOT NULL COMMENT 'Original upload filename',
    mime_type VARCHAR(127) NOT NULL,
    size INT UNSIGNED NOT NULL COMMENT 'File size in bytes',
    thumbnail_filename VARCHAR(255) DEFAULT NULL COMMENT 'Thumbnail file on disk',
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),

    KEY idx_message (message_id),
    KEY idx_sender (sender_id),
    CONSTRAINT fk_att_message FOREIGN KEY (message_id)
        REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB;
