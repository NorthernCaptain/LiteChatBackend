/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const { authPool } = require("./pool")

const dbGetChatUsers = async () => {
    const [rows] = await authPool.query(
        "SELECT user_id, name, avatar FROM users WHERE chat_access = 1"
    )
    return rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        avatar: r.avatar || null,
    }))
}

const dbGetUserAvatar = async (userId) => {
    const [rows] = await authPool.query(
        "SELECT avatar FROM users WHERE user_id = ? AND chat_access = 1",
        [userId]
    )
    return rows.length ? rows[0].avatar : null
}

const dbGetUser = async (userId) => {
    const [rows] = await authPool.query(
        "SELECT user_id, email, name, avatar, chat_access FROM users WHERE user_id = ?",
        [userId]
    )
    if (!rows.length) return null
    const r = rows[0]
    return {
        userId: r.user_id,
        email: r.email,
        name: r.name,
        avatar: r.avatar || null,
        chatAccess: r.chat_access,
    }
}

module.exports = { dbGetChatUsers, dbGetUser, dbGetUserAvatar }
