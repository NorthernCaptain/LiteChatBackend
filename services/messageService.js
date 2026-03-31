/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 *
 * Message sending and long-poll logic.
 */

const cluster = require("cluster")
const { logger } = require("../utils/logger")
const { TIMING, LIMITS } = require("./constants")
const {
    dbGetMessage,
    dbGetMessages,
    dbInsertPendingEvents,
    dbDeleteAcknowledgedEvents,
    dbFetchPendingEvents,
    dbGetMessagesByIds,
    dbSendMessageTx,
    dbCheckPendingEvent,
} = require("../db/messages")
const fcmService = require("./fcmService")
const { dbGetUser } = require("../db/users")
const {
    dbGetConversationMembers,
    dbIsUserMember,
} = require("../db/conversations")
const { dbGetAttachmentsByMessageIds } = require("../db/attachments")
const { dbGetReactionsByMessageIds, dbGetReactionsByIds } = require("../db/reactions")

// Worker-local pending polls: requestId -> { res, timer, userId, responded }
const pendingPolls = new Map()

// --- Worker IPC handlers ---

function handleWake(requestId) {
    const pollData = pendingPolls.get(requestId)
    if (!pollData || pollData.responded) return
    logger.debug({ uid: pollData.userId, reqId: requestId }, "LC: WAKE received")
    fetchAndRespond(pollData)
}

function handleCancel(requestId) {
    const pollData = pendingPolls.get(requestId)
    if (!pollData || pollData.responded) return

    logger.debug({ uid: pollData.userId, reqId: requestId }, "LC: CANCEL received")
    cleanupPoll(requestId)
    if (!pollData.res.writableEnded) {
        pollData.res.json({ events: [] })
    }
}

let workerHandlersSetup = false

function setupWorkerHandlers() {
    if (!cluster.isWorker) return
    if (workerHandlersSetup) return
    workerHandlersSetup = true

    process.on("message", (msg) => {
        if (!msg.lc) return
        switch (msg.type) {
            case "WAKE":
                handleWake(msg.requestId)
                break
            case "CANCEL":
                handleCancel(msg.requestId)
                break
        }
    })
}

setupWorkerHandlers()

// --- Helpers to enrich events with full data ---

function formatAttachment(a) {
    return {
        id: a.id.toString(),
        originalFilename: a.original_filename,
        mimeType: a.mime_type,
        size: a.size,
        hasThumbnail: !!a.thumbnail_filename,
    }
}

function groupReactions(reactions) {
    const map = new Map()
    for (const r of reactions) {
        if (!map.has(r.emoji)) {
            map.set(r.emoji, [])
        }
        map.get(r.emoji).push(r.user_id)
    }
    return Array.from(map.entries()).map(([emoji, userIds]) => ({
        emoji,
        userIds,
    }))
}

function formatMessage(msg, attachments, reactions) {
    return {
        id: msg.id.toString(),
        conversationId: msg.conversation_id.toString(),
        senderId: msg.sender_id,
        text: msg.text || null,
        referenceMessageId: msg.reference_message_id
            ? msg.reference_message_id.toString()
            : null,
        attachments: attachments.map(formatAttachment),
        reactions: groupReactions(reactions),
        createdAt: msg.created_at,
    }
}

async function enrichMessages(messages) {
    if (!messages.length) return []
    const messageIds = messages.map((m) => m.id)
    const [attachments, reactions] = await Promise.all([
        dbGetAttachmentsByMessageIds(messageIds),
        dbGetReactionsByMessageIds(messageIds),
    ])

    const attMap = new Map()
    for (const a of attachments) {
        const mid = a.message_id.toString()
        if (!attMap.has(mid)) attMap.set(mid, [])
        attMap.get(mid).push(a)
    }
    const reactMap = new Map()
    for (const r of reactions) {
        const mid = r.message_id.toString()
        if (!reactMap.has(mid)) reactMap.set(mid, [])
        reactMap.get(mid).push(r)
    }

    return messages.map((msg) => {
        const mid = msg.id.toString()
        return formatMessage(
            msg,
            attMap.get(mid) || [],
            reactMap.get(mid) || []
        )
    })
}

// --- Fetch pending events and respond ---

async function fetchAndRespond(pollData) {
    if (pollData.responded) return
    cleanupPoll(pollData.requestId)

    try {
        const events = await buildEventResponse(pollData.userId)
        if (!pollData.res.writableEnded) {
            pollData.res.json({ events })
        }
    } catch (error) {
        logger.error(
            { uid: pollData.userId, reqId: pollData.requestId },
            "LC: fetchAndRespond error:",
            error.message
        )
        if (!pollData.res.writableEnded) {
            pollData.res.json({ events: [] })
        }
    }
}

async function buildEventResponse(userId) {
    const pendingRows = await dbFetchPendingEvents(
        userId,
        TIMING.POLL_MAX_EVENTS
    )
    if (!pendingRows.length) return []

    // Collect message IDs to load
    const messageIds = pendingRows
        .filter((r) => r.message_id)
        .map((r) => r.message_id)
    const uniqueMessageIds = [...new Set(messageIds.map(String))]
    const messages =
        uniqueMessageIds.length > 0
            ? await dbGetMessagesByIds(uniqueMessageIds)
            : []
    const enriched = await enrichMessages(messages)
    const msgMap = new Map()
    for (const m of enriched) {
        msgMap.set(m.id, m)
    }

    // Batch-load reactions
    const reactionIds = pendingRows
        .filter((r) => r.type === "reaction" && r.reaction_id)
        .map((r) => r.reaction_id)
    const uniqueReactionIds = [...new Set(reactionIds.map(String))]
    const reactionRows =
        uniqueReactionIds.length > 0
            ? await dbGetReactionsByIds(uniqueReactionIds)
            : []

    const reactionMap = new Map()
    for (const reaction of reactionRows) {
        reactionMap.set(reaction.id.toString(), {
            id: reaction.id.toString(),
            messageId: reaction.message_id.toString(),
            userId: reaction.user_id,
            emoji: reaction.emoji,
            createdAt: reaction.created_at,
        })
    }

    const events = []
    for (const row of pendingRows) {
        const event = {
            pendingId: row.pending_id.toString(),
            type: row.type,
            conversationId: row.conversation_id.toString(),
        }
        if (row.type === "message" && row.message_id) {
            event.message = msgMap.get(row.message_id.toString()) || null
        } else if (row.type === "reaction" && row.reaction_id) {
            event.reaction =
                reactionMap.get(row.reaction_id.toString()) || null
        }
        events.push(event)
    }
    return events
}

// --- Long-poll setup ---

function cleanupPoll(requestId) {
    const pollData = pendingPolls.get(requestId)
    if (!pollData) return
    pollData.responded = true
    clearTimeout(pollData.timer)
    pendingPolls.delete(requestId)
    if (cluster.isWorker) {
        process.send({ lc: true, type: "UNSUBSCRIBE", requestId })
    }
}

function setupLongPoll(res, userId, requestId) {
    const ctx = { uid: userId, reqId: requestId }
    logger.debug(ctx, "LC: Setting up long poll")

    const timer = setTimeout(() => {
        const pollData = pendingPolls.get(requestId)
        if (pollData && !pollData.responded) {
            logger.debug(ctx, "LC: Poll timeout, returning empty")
            cleanupPoll(requestId)
            res.json({ events: [] })
        }
    }, TIMING.POLL_TIMEOUT_MS)

    pendingPolls.set(requestId, {
        res,
        timer,
        userId,
        requestId,
        responded: false,
    })

    // Clean up if client disconnects
    res.on("close", () => {
        const pollData = pendingPolls.get(requestId)
        if (pollData && !pollData.responded) {
            logger.debug(ctx, "LC: Client disconnected, cleaning up poll")
            cleanupPoll(requestId)
        }
    })

    if (cluster.isWorker) {
        process.send({
            lc: true,
            type: "SUBSCRIBE",
            userId,
            requestId,
        })
    }
}

// --- Public API ---

async function sendMessageToConversation(
    conversationId,
    senderId,
    text,
    referenceMessageId,
    attachmentIds
) {
    // Validate reference message belongs to same conversation
    if (referenceMessageId) {
        const refMsg = await dbGetMessage(referenceMessageId)
        if (!refMsg || refMsg.conversation_id.toString() !== conversationId) {
            const err = new Error("Referenced message not found in conversation")
            err.status = 400
            throw err
        }
    }

    // Get recipients before the transaction
    const members = await dbGetConversationMembers(conversationId)
    const recipientIds = members
        .filter((m) => m.userId !== senderId)
        .map((m) => m.userId)

    // Atomic: insert message + link attachments + touch conversation + insert pending events
    const messageId = await dbSendMessageTx(
        conversationId,
        senderId,
        text,
        referenceMessageId,
        attachmentIds,
        recipientIds
    )

    // Notify each recipient via polling (outside transaction)
    for (const uid of recipientIds) {
        publishToUser(uid)
    }

    // After a delay, send FCM to recipients who didn't pick up via poll
    const senderInfo = await dbGetUser(senderId)
    const senderName = (senderInfo && senderInfo.name) || "New message"
    const bodyText = text ? text.substring(0, 200) : "Attachment"
    for (const uid of recipientIds) {
        setTimeout(async () => {
            try {
                const pending = await dbCheckPendingEvent(messageId, uid)
                if (pending) {
                    await fcmService.sendNotification(uid, {
                        title: senderName,
                        body: bodyText,
                        conversationId: String(conversationId),
                    })
                }
            } catch (err) {
                logger.error({}, "FCM notification error for user %d: %s", uid, err.message)
            }
        }, 1500)
    }

    // Return the full message
    const msg = await dbGetMessage(messageId)
    const enriched = await enrichMessages([msg])
    return enriched[0]
}

async function getConversationMessages(conversationId, afterId, limit) {
    const messages = await dbGetMessages(conversationId, afterId, limit)
    return enrichMessages(messages)
}

async function pollForEvents(userId, afterId, requestId, res) {
    // Acknowledge old events
    await dbDeleteAcknowledgedEvents(userId, afterId)

    // Check for pending events
    const events = await buildEventResponse(userId)
    if (events.length) {
        return res.json({ events })
    }

    // No events - setup long poll
    setupLongPoll(res, userId, requestId)

    // Race condition check
    const raceEvents = await buildEventResponse(userId)
    if (raceEvents.length && pendingPolls.has(requestId)) {
        logger.debug(
            { uid: userId, reqId: requestId },
            "LC: Race condition, events arrived during setup"
        )
        const pollData = pendingPolls.get(requestId)
        if (pollData && !pollData.responded) {
            pollData.responded = true
            clearTimeout(pollData.timer)
            pendingPolls.delete(requestId)
            if (cluster.isWorker) {
                process.send({
                    lc: true,
                    type: "UNSUBSCRIBE",
                    requestId,
                })
            }
            return res.json({ events: raceEvents })
        }
    }
}

function publishToUser(userId) {
    if (cluster.isWorker) {
        process.send({
            lc: true,
            type: "PUBLISH",
            userId,
        })
    }
}

function getPendingPollCount() {
    return pendingPolls.size
}

function clearPendingPolls() {
    for (const [, pollData] of pendingPolls) {
        clearTimeout(pollData.timer)
    }
    pendingPolls.clear()
}

module.exports = {
    sendMessageToConversation,
    getConversationMessages,
    pollForEvents,
    publishToUser,
    enrichMessages,
    formatAttachment,
    groupReactions,
    getPendingPollCount,
    clearPendingPolls,
    handleWake,
    handleCancel,
}
