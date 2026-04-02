/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const express = require("express")
const fs = require("fs")
const { requestLogger } = require("../utils/logger")
const { logger } = require("../utils/logger")
const { upload } = require("../middleware/upload")
const { LIMITS, SAFE_MIME_TYPES } = require("../services/constants")

const { dbGetChatUsers, dbGetUser, dbGetUserAvatar } = require("../db/users")
const {
    createConversation,
    getConversation,
    listConversations,
    requireMembership,
} = require("../services/conversationService")
const {
    sendMessageToConversation,
    getConversationMessages,
    pollForEvents,
    broadcastTyping,
} = require("../services/messageService")
const {
    uploadAttachment,
    getAttachmentForDownload,
    getOriginalPath,
    getThumbnailPath,
    getAvatarPath,
    saveAvatar,
    deleteAvatar,
} = require("../services/attachmentService")
const { addReaction, removeReaction } = require("../services/reactionService")
const { initFcm } = require("../services/fcmService")
const { dbSaveFcmToken, dbDeleteFcmToken } = require("../db/fcmTokens")

function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next)
    }
}

function sanitizeFilenameForHeader(filename) {
    return filename.replace(/["\\\r\n]/g, "_")
}

function router(app) {
    // Initialize FCM in worker processes only (router() is not called in master)
    initFcm()

    const r = express.Router()
    r.use(express.json())
    r.use(requestLogger)
    r.use(app.oauth.authorise())

    // --- Users ---

    r.get(
        "/users/me",
        asyncHandler(async (req, res) => {
            const user = await dbGetUser(req.user.user_id)
            if (!user) {
                return res.status(404).json({ error: "User not found" })
            }
            res.json(user)
        })
    )

    r.post(
        "/users/me/avatar",
        upload.single("file"),
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            if (req.file) {
                const avatar = await saveAvatar(req.file, userId)
                res.json({ avatar })
            } else {
                await deleteAvatar(userId)
                res.json({ avatar: null })
            }
        })
    )

    r.get(
        "/users",
        asyncHandler(async (req, res) => {
            const users = await dbGetChatUsers()
            res.json({ users })
        })
    )

    r.get(
        "/users/:userId/avatar",
        asyncHandler(async (req, res) => {
            const userId = parseInt(req.params.userId, 10)
            const avatar = await dbGetUserAvatar(userId)
            if (!avatar) {
                return res.status(404).json({ error: "Avatar not found" })
            }
            const avatarPath = getAvatarPath(avatar)
            if (!fs.existsSync(avatarPath)) {
                return res.status(404).json({ error: "Avatar file not found" })
            }
            res.sendFile(avatarPath)
        })
    )

    // --- FCM Token ---

    r.post(
        "/users/me/fcmtoken",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const { token } = req.body
            if (!token) return res.status(400).json({ error: "Token required" })
            await dbSaveFcmToken(userId, token)
            res.json({ success: true })
        })
    )

    r.delete(
        "/users/me/fcmtoken",
        asyncHandler(async (req, res) => {
            const { token } = req.body
            if (!token) return res.status(400).json({ error: "Token required" })
            await dbDeleteFcmToken(token)
            res.json({ success: true })
        })
    )

    // --- Conversations ---

    r.post(
        "/conversations",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const { type, name, memberIds } = req.body

            if (!type || !["direct", "group"].includes(type)) {
                return res
                    .status(400)
                    .json({ error: 'type must be "direct" or "group"' })
            }
            if (!Array.isArray(memberIds) || !memberIds.length) {
                return res
                    .status(400)
                    .json({ error: "memberIds must be a non-empty array" })
            }

            const result = await createConversation(
                userId,
                type,
                name,
                memberIds
            )
            const status = result.existed ? 200 : 201
            res.status(status).json(result.conversation)
        })
    )

    r.get(
        "/conversations",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const conversations = await listConversations(userId)
            res.json({ conversations })
        })
    )

    r.get(
        "/conversations/:id",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const convId = req.params.id
            await requireMembership(convId, userId)
            const conversation = await getConversation(convId)
            res.json(conversation)
        })
    )

    // --- Messages ---

    r.post(
        "/conversations/:id/messages",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const convId = req.params.id
            const { text, referenceMessageId, attachmentIds } = req.body

            if (!text && (!attachmentIds || !attachmentIds.length)) {
                return res
                    .status(400)
                    .json({ error: "text or attachmentIds required" })
            }
            if (text && text.length > LIMITS.MAX_MESSAGE_LENGTH) {
                return res.status(400).json({
                    error: `text exceeds max length of ${LIMITS.MAX_MESSAGE_LENGTH}`,
                })
            }

            await requireMembership(convId, userId)

            const message = await sendMessageToConversation(
                convId,
                userId,
                text,
                referenceMessageId || null,
                attachmentIds || []
            )
            res.status(201).json(message)
        })
    )

    r.get(
        "/conversations/:id/messages",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const convId = req.params.id
            const after = req.query.after || "0"
            const limit = Math.min(
                parseInt(req.query.limit, 10) || LIMITS.DEFAULT_PAGE_SIZE,
                LIMITS.MAX_PAGE_SIZE
            )

            await requireMembership(convId, userId)

            const messages = await getConversationMessages(
                convId,
                after,
                limit
            )
            res.json({ messages })
        })
    )

    // --- Attachments ---

    r.post(
        "/attachments/upload",
        upload.single("file"),
        asyncHandler(async (req, res) => {
            if (!req.file) {
                return res.status(400).json({ error: "No file provided" })
            }
            const userId = req.user.user_id
            const result = await uploadAttachment(req.file, userId)
            res.status(201).json(result)
        })
    )

    r.get(
        "/attachments/:id",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const att = await getAttachmentForDownload(req.params.id, userId)
            const filePath = getOriginalPath(att.server_filename)
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: "File not found on disk" })
            }
            const safeName = sanitizeFilenameForHeader(att.original_filename)
            const disposition = SAFE_MIME_TYPES.has(att.mime_type)
                ? "inline"
                : "attachment"
            res.set("Content-Type", att.mime_type)
            res.set(
                "Content-Disposition",
                `${disposition}; filename="${safeName}"`
            )
            res.sendFile(filePath)
        })
    )

    r.get(
        "/attachments/:id/thumbnail",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const att = await getAttachmentForDownload(req.params.id, userId)
            if (!att.thumbnail_filename) {
                return res
                    .status(404)
                    .json({ error: "No thumbnail for this attachment" })
            }
            const filePath = getThumbnailPath(att.thumbnail_filename)
            if (!fs.existsSync(filePath)) {
                return res
                    .status(404)
                    .json({ error: "Thumbnail file not found on disk" })
            }
            res.set("Content-Type", "image/jpeg")
            res.sendFile(filePath)
        })
    )

    // --- Reactions ---

    r.post(
        "/messages/:id/reactions",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const messageId = req.params.id
            const { emoji } = req.body

            if (!emoji || typeof emoji !== "string") {
                return res.status(400).json({ error: "emoji is required" })
            }
            if (emoji.length > 32) {
                return res.status(400).json({ error: "emoji too long" })
            }

            const reaction = await addReaction(messageId, userId, emoji)
            res.status(201).json(reaction)
        })
    )

    r.delete(
        "/messages/:id/reactions",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const messageId = req.params.id
            const { emoji } = req.body

            if (!emoji) {
                return res.status(400).json({ error: "emoji is required" })
            }

            const result = await removeReaction(messageId, userId, emoji)
            res.json(result)
        })
    )

    // --- Typing ---

    r.post(
        "/conversations/:id/typing",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const conversationId = req.params.id
            await requireMembership(conversationId, userId)
            const { typing } = req.body
            const user = await dbGetUser(userId)
            const userName = (user && user.name) || "Unknown"
            await broadcastTyping(conversationId, userId, userName, typing !== false)
            res.json({ success: true })
        })
    )

    // --- Polling ---

    r.post(
        "/poll",
        asyncHandler(async (req, res) => {
            const userId = req.user.user_id
            const afterId = req.body.after || "0"
            await pollForEvents(userId, afterId, req.requestId, res)
        })
    )

    // --- Error handler ---

    r.use((err, req, res, next) => {
        const status = err.status || 500
        logger.error(
            { reqId: req.requestId },
            "Route error:",
            err.message
        )
        res.status(status).json({ error: err.message })
    })

    return r
}

module.exports = { router }
