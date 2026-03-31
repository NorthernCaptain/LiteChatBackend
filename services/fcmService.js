/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const { logger } = require("../utils/logger")
const { dbGetUserTokens, dbDeleteFcmToken } = require("../db/fcmTokens")

let admin = null
let initialized = false

function initFcm() {
    const serviceAccountPath = process.env.LC_FCM_SERVICE_ACCOUNT_PATH
    if (!serviceAccountPath) {
        logger.info({}, "LC_FCM_SERVICE_ACCOUNT_PATH not set, FCM notifications disabled")
        return
    }

    try {
        const firebaseAdmin = require("firebase-admin")
        const serviceAccount = require(serviceAccountPath)
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(serviceAccount),
        })
        admin = firebaseAdmin
        initialized = true
        logger.info({}, "FCM initialized successfully")
    } catch (err) {
        logger.error({}, "Failed to initialize FCM: %s", err.message)
    }
}

async function sendNotification(userId, { title, body, conversationId }) {
    if (!initialized || !admin) return

    const tokens = await dbGetUserTokens(userId)
    if (tokens.length === 0) return

    for (const token of tokens) {
        try {
            await admin.messaging().send({
                token,
                data: {
                    title: String(title),
                    body: String(body),
                    conversationId: String(conversationId),
                    type: "message",
                },
                android: {
                    priority: "high",
                },
            })
        } catch (err) {
            if (
                err.code === "messaging/registration-token-not-registered" ||
                err.code === "messaging/invalid-registration-token"
            ) {
                logger.info({}, "Removing invalid FCM token for user %d", userId)
                await dbDeleteFcmToken(token)
            } else {
                logger.error({}, "FCM send error for user %d: %s", userId, err.message)
            }
        }
    }
}

module.exports = { initFcm, sendNotification }
