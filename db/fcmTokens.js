/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const { pool } = require("./pool")

async function dbSaveFcmToken(userId, token) {
    await pool.query(
        `INSERT INTO fcm_tokens (user_id, token) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), updated_at = CURRENT_TIMESTAMP(3)`,
        [userId, token]
    )
}

async function dbDeleteFcmToken(token) {
    await pool.query("DELETE FROM fcm_tokens WHERE token = ?", [token])
}

async function dbDeleteUserTokens(userId) {
    await pool.query("DELETE FROM fcm_tokens WHERE user_id = ?", [userId])
}

async function dbGetUserTokens(userId) {
    const [rows] = await pool.query(
        "SELECT token FROM fcm_tokens WHERE user_id = ?",
        [userId]
    )
    return rows.map((r) => r.token)
}

module.exports = {
    dbSaveFcmToken,
    dbDeleteFcmToken,
    dbDeleteUserTokens,
    dbGetUserTokens,
}
