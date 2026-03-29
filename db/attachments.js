/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const { pool } = require("./pool")

const dbInsertAttachment = async (senderId, serverFilename, originalFilename, mimeType, size, thumbnailFilename) => {
    const [result] = await pool.query(
        `INSERT INTO attachments (sender_id, server_filename, original_filename, mime_type, size, thumbnail_filename)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [senderId, serverFilename, originalFilename, mimeType, size, thumbnailFilename]
    )
    return result.insertId.toString()
}

const dbGetAttachment = async (attachmentId) => {
    const [rows] = await pool.query(
        "SELECT * FROM attachments WHERE id = ?",
        [attachmentId]
    )
    return rows.length ? rows[0] : null
}

const dbLinkAttachmentsToMessage = async (messageId, attachmentIds, senderId) => {
    if (!attachmentIds.length) return 0
    const [result] = await pool.query(
        `UPDATE attachments
         SET message_id = ?
         WHERE id IN (?) AND sender_id = ? AND message_id IS NULL`,
        [messageId, attachmentIds, senderId]
    )
    return result.affectedRows
}

const dbGetAttachmentsByMessageIds = async (messageIds) => {
    if (!messageIds.length) return []
    const [rows] = await pool.query(
        "SELECT * FROM attachments WHERE message_id IN (?)",
        [messageIds]
    )
    return rows
}

module.exports = {
    dbInsertAttachment,
    dbGetAttachment,
    dbLinkAttachmentsToMessage,
    dbGetAttachmentsByMessageIds,
}
