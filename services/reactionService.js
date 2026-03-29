/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const { dbAddReaction, dbRemoveReaction, dbGetReaction } = require("../db/reactions")
const { dbGetMessage } = require("../db/messages")
const { dbInsertPendingEvents } = require("../db/messages")
const { dbGetConversationMembers } = require("../db/conversations")
const { requireMembership } = require("./conversationService")
const { publishToUser } = require("./messageService")

async function addReaction(messageId, userId, emoji) {
    const msg = await dbGetMessage(messageId)
    if (!msg) {
        const err = new Error("Message not found")
        err.status = 404
        throw err
    }

    await requireMembership(msg.conversation_id, userId)

    const reactionId = await dbAddReaction(messageId, userId, emoji)
    const reaction = await dbGetReaction(reactionId)

    // Create pending events for other members
    const members = await dbGetConversationMembers(msg.conversation_id)
    const recipients = members
        .filter((m) => m.userId !== userId)
        .map((m) => m.userId)

    if (recipients.length) {
        const events = recipients.map((uid) => ({
            userId: uid,
            type: "reaction",
            conversationId: msg.conversation_id.toString(),
            reactionId,
        }))
        await dbInsertPendingEvents(events)
        for (const uid of recipients) {
            publishToUser(uid)
        }
    }

    return {
        id: reaction.id.toString(),
        messageId: reaction.message_id.toString(),
        userId: reaction.user_id,
        emoji: reaction.emoji,
        createdAt: reaction.created_at,
    }
}

async function removeReaction(messageId, userId, emoji) {
    const msg = await dbGetMessage(messageId)
    if (!msg) {
        const err = new Error("Message not found")
        err.status = 404
        throw err
    }

    await requireMembership(msg.conversation_id, userId)

    const removed = await dbRemoveReaction(messageId, userId, emoji)
    if (!removed) {
        const err = new Error("Reaction not found")
        err.status = 404
        throw err
    }

    // Notify other members about the removal
    const members = await dbGetConversationMembers(msg.conversation_id)
    const recipients = members
        .filter((m) => m.userId !== userId)
        .map((m) => m.userId)

    if (recipients.length) {
        const events = recipients.map((uid) => ({
            userId: uid,
            type: "reaction",
            conversationId: msg.conversation_id.toString(),
        }))
        await dbInsertPendingEvents(events)
        for (const uid of recipients) {
            publishToUser(uid)
        }
    }

    return { success: true }
}

module.exports = { addReaction, removeReaction }
