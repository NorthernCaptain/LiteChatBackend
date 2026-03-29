/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const {
    dbCreateConversationWithMembers,
    dbGetConversation,
    dbGetConversationMembers,
    dbIsUserMember,
    dbFindOrCreateDirectConversation,
    dbListUserConversations,
    dbGetLastMessages,
} = require("../db/conversations")

function formatConversation(conv, members) {
    return {
        id: conv.id.toString(),
        type: conv.type,
        name: conv.name || null,
        createdBy: conv.created_by,
        members,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
    }
}

async function createConversation(userId, type, name, memberIds) {
    if (type === "direct") {
        if (memberIds.length !== 1) {
            const err = new Error(
                "Direct conversation requires exactly 1 other member"
            )
            err.status = 400
            throw err
        }
        if (memberIds[0] === userId) {
            const err = new Error("Cannot create a direct conversation with yourself")
            err.status = 400
            throw err
        }
        // Atomic find-or-create to prevent duplicate direct conversations
        const result = await dbFindOrCreateDirectConversation(
            userId,
            memberIds[0]
        )
        const conversation = await getConversation(result.id)
        return { existed: result.existed, conversation }
    }

    if (type === "group" && !name) {
        const err = new Error("Group conversation requires a name")
        err.status = 400
        throw err
    }

    const allMemberIds = [userId, ...memberIds.filter((id) => id !== userId)]
    const convId = await dbCreateConversationWithMembers(
        type,
        name || null,
        userId,
        allMemberIds
    )

    const conversation = await getConversation(convId)
    return { existed: false, conversation }
}

async function getConversation(conversationId) {
    const conv = await dbGetConversation(conversationId)
    if (!conv) return null
    const members = await dbGetConversationMembers(conversationId)
    return formatConversation(conv, members)
}

async function listConversations(userId) {
    const convs = await dbListUserConversations(userId)
    const convIds = convs.map((c) => c.id)
    const [membersMap, lastMessages] = await Promise.all([
        loadMembersForConversations(convIds),
        dbGetLastMessages(convIds),
    ])

    return convs.map((conv) => {
        const cid = conv.id.toString()
        const formatted = formatConversation(
            conv,
            membersMap.get(cid) || []
        )
        const lastMsg = lastMessages.get(cid)
        formatted.lastMessage = lastMsg
            ? {
                  id: lastMsg.id.toString(),
                  senderId: lastMsg.sender_id,
                  text: lastMsg.text || null,
                  createdAt: lastMsg.created_at,
              }
            : null
        return formatted
    })
}

async function loadMembersForConversations(convIds) {
    const map = new Map()
    await Promise.all(
        convIds.map(async (id) => {
            const members = await dbGetConversationMembers(id)
            map.set(id.toString(), members)
        })
    )
    return map
}

async function requireMembership(conversationId, userId) {
    const conv = await dbGetConversation(conversationId)
    if (!conv) {
        const err = new Error("Conversation not found")
        err.status = 404
        throw err
    }
    const isMember = await dbIsUserMember(conversationId, userId)
    if (!isMember) {
        const err = new Error("Not a member of this conversation")
        err.status = 403
        throw err
    }
    return conv
}

module.exports = {
    createConversation,
    getConversation,
    listConversations,
    requireMembership,
}
