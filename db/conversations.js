/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const { pool } = require("./pool")

const dbCreateConversationWithMembers = async (type, name, createdBy, memberIds) => {
    const conn = await pool.getConnection()
    try {
        await conn.beginTransaction()
        const [result] = await conn.query(
            "INSERT INTO conversations (type, name, created_by) VALUES (?, ?, ?)",
            [type, name, createdBy]
        )
        const convId = result.insertId.toString()
        if (memberIds.length) {
            const values = memberIds.map((uid) => [convId, uid])
            await conn.query(
                "INSERT INTO conversation_members (conversation_id, user_id) VALUES ?",
                [values]
            )
        }
        await conn.commit()
        return convId
    } catch (err) {
        await conn.rollback()
        throw err
    } finally {
        conn.release()
    }
}

const dbGetConversation = async (conversationId) => {
    const [rows] = await pool.query(
        "SELECT id, type, name, created_by, created_at, updated_at FROM conversations WHERE id = ?",
        [conversationId]
    )
    return rows.length ? rows[0] : null
}

const dbGetConversationMembers = async (conversationId) => {
    const [rows] = await pool.query(
        "SELECT user_id, joined_at FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at",
        [conversationId]
    )
    return rows.map((r) => ({ userId: r.user_id, joinedAt: r.joined_at }))
}

const dbIsUserMember = async (conversationId, userId) => {
    const [rows] = await pool.query(
        "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?",
        [conversationId, userId]
    )
    return rows.length > 0
}

const dbFindDirectConversation = async (userId1, userId2) => {
    const [rows] = await pool.query(
        `SELECT c.id FROM conversations c
         JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
         JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
         WHERE c.type = 'direct'
         LIMIT 1`,
        [userId1, userId2]
    )
    return rows.length ? rows[0].id.toString() : null
}

const dbFindOrCreateDirectConversation = async (userId1, userId2) => {
    const conn = await pool.getConnection()
    try {
        await conn.beginTransaction()
        // Lock to prevent duplicate creation
        await conn.query("SELECT GET_LOCK('lc_direct_conv', 5)")
        const [rows] = await conn.query(
            `SELECT c.id FROM conversations c
             JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
             JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
             WHERE c.type = 'direct'
             LIMIT 1`,
            [userId1, userId2]
        )
        if (rows.length) {
            await conn.commit()
            await conn.query("SELECT RELEASE_LOCK('lc_direct_conv')")
            return { id: rows[0].id.toString(), existed: true }
        }
        const [result] = await conn.query(
            "INSERT INTO conversations (type, name, created_by) VALUES ('direct', NULL, ?)",
            [userId1]
        )
        const convId = result.insertId.toString()
        await conn.query(
            "INSERT INTO conversation_members (conversation_id, user_id) VALUES ?",
            [[[convId, userId1], [convId, userId2]]]
        )
        await conn.commit()
        await conn.query("SELECT RELEASE_LOCK('lc_direct_conv')")
        return { id: convId, existed: false }
    } catch (err) {
        await conn.rollback()
        await conn.query("SELECT RELEASE_LOCK('lc_direct_conv')").catch(() => {})
        throw err
    } finally {
        conn.release()
    }
}

const dbListUserConversations = async (userId) => {
    const [rows] = await pool.query(
        `SELECT c.id, c.type, c.name, c.created_by, c.created_at, c.updated_at
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
         ORDER BY c.updated_at DESC`,
        [userId]
    )
    return rows
}

const dbGetLastMessages = async (conversationIds) => {
    if (!conversationIds.length) return new Map()
    const [rows] = await pool.query(
        `SELECT m.* FROM messages m
         INNER JOIN (
             SELECT conversation_id, MAX(id) AS max_id
             FROM messages
             WHERE conversation_id IN (?)
             GROUP BY conversation_id
         ) latest ON m.id = latest.max_id`,
        [conversationIds]
    )
    const map = new Map()
    for (const r of rows) {
        map.set(r.conversation_id.toString(), r)
    }
    return map
}

module.exports = {
    dbCreateConversationWithMembers,
    dbGetConversation,
    dbGetConversationMembers,
    dbIsUserMember,
    dbFindDirectConversation,
    dbFindOrCreateDirectConversation,
    dbListUserConversations,
    dbGetLastMessages,
}
