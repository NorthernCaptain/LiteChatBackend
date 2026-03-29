/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const { pool } = require("./pool")

const dbAddReaction = async (messageId, userId, emoji) => {
    const [result] = await pool.query(
        `INSERT INTO reactions (message_id, user_id, emoji)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [messageId, userId, emoji]
    )
    return result.insertId.toString()
}

const dbRemoveReaction = async (messageId, userId, emoji) => {
    const [result] = await pool.query(
        "DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
        [messageId, userId, emoji]
    )
    return result.affectedRows > 0
}

const dbGetReaction = async (reactionId) => {
    const [rows] = await pool.query(
        "SELECT * FROM reactions WHERE id = ?",
        [reactionId]
    )
    return rows.length ? rows[0] : null
}

const dbGetReactionsByMessageIds = async (messageIds) => {
    if (!messageIds.length) return []
    const [rows] = await pool.query(
        "SELECT id, message_id, user_id, emoji, created_at FROM reactions WHERE message_id IN (?) ORDER BY id",
        [messageIds]
    )
    return rows
}

const dbGetReactionsByIds = async (reactionIds) => {
    if (!reactionIds.length) return []
    const [rows] = await pool.query(
        "SELECT * FROM reactions WHERE id IN (?)",
        [reactionIds]
    )
    return rows
}

module.exports = {
    dbAddReaction,
    dbRemoveReaction,
    dbGetReaction,
    dbGetReactionsByIds,
    dbGetReactionsByMessageIds,
}
