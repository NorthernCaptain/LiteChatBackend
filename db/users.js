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

module.exports = { dbGetChatUsers, dbGetUserAvatar }
