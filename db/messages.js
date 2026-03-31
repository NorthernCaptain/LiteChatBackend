/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const { pool } = require("./pool")

const dbInsertMessage = async (conversationId, senderId, text, referenceMessageId) => {
    const [result] = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, text, reference_message_id)
         VALUES (?, ?, ?, ?)`,
        [conversationId, senderId, text ?? null, referenceMessageId ?? null]
    )
    return result.insertId.toString()
}

const dbGetMessage = async (messageId) => {
    const [rows] = await pool.query(
        "SELECT * FROM messages WHERE id = ?",
        [messageId]
    )
    return rows.length ? rows[0] : null
}

const dbGetMessages = async (conversationId, afterId, limit) => {
    const [rows] = await pool.query(
        `SELECT id, conversation_id, sender_id, text, reference_message_id, created_at
         FROM messages
         WHERE conversation_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
        [conversationId, afterId, limit]
    )
    return rows
}

const dbTouchConversation = async (conversationId) => {
    await pool.query(
        "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
        [conversationId]
    )
}

// --- Pending events ---

const dbInsertPendingEvents = async (events) => {
    if (!events.length) return
    const values = events.map((e) => [
        e.userId,
        e.type,
        e.conversationId,
        e.messageId ?? null,
        e.reactionId ?? null,
    ])
    await pool.query(
        `INSERT INTO pending_events (user_id, type, conversation_id, message_id, reaction_id)
         VALUES ?`,
        [values]
    )
}

const dbDeleteAcknowledgedEvents = async (userId, afterId) => {
    if (!afterId || afterId === "0") return
    await pool.query(
        "DELETE FROM pending_events WHERE user_id = ? AND id <= ?",
        [userId, afterId]
    )
}

const dbFetchPendingEvents = async (userId, limit) => {
    const [rows] = await pool.query(
        `SELECT pe.id AS pending_id, pe.type, pe.conversation_id, pe.message_id, pe.reaction_id
         FROM pending_events pe
         WHERE pe.user_id = ?
         ORDER BY pe.id ASC
         LIMIT ?`,
        [userId, limit]
    )
    return rows
}

const dbGetMessagesByIds = async (messageIds) => {
    if (!messageIds.length) return []
    const [rows] = await pool.query(
        "SELECT * FROM messages WHERE id IN (?)",
        [messageIds]
    )
    return rows
}

const dbSendMessageTx = async (conversationId, senderId, text, referenceMessageId, attachmentIds, recipientIds) => {
    const conn = await pool.getConnection()
    try {
        await conn.beginTransaction()

        // Insert message
        const [msgResult] = await conn.query(
            `INSERT INTO messages (conversation_id, sender_id, text, reference_message_id)
             VALUES (?, ?, ?, ?)`,
            [conversationId, senderId, text ?? null, referenceMessageId ?? null]
        )
        const messageId = msgResult.insertId.toString()

        // Link attachments
        if (attachmentIds && attachmentIds.length) {
            const [linkResult] = await conn.query(
                `UPDATE attachments SET message_id = ?
                 WHERE id IN (?) AND sender_id = ? AND message_id IS NULL`,
                [messageId, attachmentIds, senderId]
            )
            if (linkResult.affectedRows !== attachmentIds.length) {
                await conn.rollback()
                const err = new Error(
                    "Some attachments could not be linked (not owned or already linked)"
                )
                err.status = 400
                throw err
            }
        }

        // Touch conversation
        await conn.query(
            "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
            [conversationId]
        )

        // Insert pending events
        if (recipientIds.length) {
            const values = recipientIds.map((uid) => [
                uid, "message", conversationId, messageId, null,
            ])
            await conn.query(
                `INSERT INTO pending_events (user_id, type, conversation_id, message_id, reaction_id)
                 VALUES ?`,
                [values]
            )
        }

        await conn.commit()
        return messageId
    } catch (err) {
        await conn.rollback()
        throw err
    } finally {
        conn.release()
    }
}

async function dbCheckPendingEvent(messageId, userId) {
    const [rows] = await pool.query(
        "SELECT 1 FROM pending_events WHERE message_id = ? AND user_id = ? LIMIT 1",
        [messageId, userId]
    )
    return rows.length > 0
}

module.exports = {
    dbInsertMessage,
    dbGetMessage,
    dbGetMessages,
    dbTouchConversation,
    dbInsertPendingEvents,
    dbDeleteAcknowledgedEvents,
    dbFetchPendingEvents,
    dbGetMessagesByIds,
    dbSendMessageTx,
    dbCheckPendingEvent,
}
