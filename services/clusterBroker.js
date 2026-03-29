/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 *
 * Master-process IPC broker for long-polling.
 * Routes PUBLISH notifications to the correct worker holding a user's poll.
 * Uses "lc: true" prefix to avoid collision with NavalClash broker.
 */

const cluster = require("cluster")
const { logger } = require("../utils/logger")

// Master process state: userId -> { requestId, workerId }
const activePolls = new Map()
const requestToUser = new Map()

function cancelExistingPoll(existing) {
    const ctx = { reqId: existing.requestId, workerId: existing.workerId }
    const oldWorker = cluster.workers[existing.workerId]
    if (oldWorker) {
        logger.debug(ctx, "LC: Cancelling existing poll")
        oldWorker.send({
            lc: true,
            type: "CANCEL",
            requestId: existing.requestId,
        })
    }
    requestToUser.delete(existing.requestId)
}

function handleSubscribe(worker, msg) {
    const { userId, requestId } = msg
    const ctx = { uid: userId, reqId: requestId, workerId: worker.id }
    const existing = activePolls.get(userId)

    if (existing) {
        logger.debug(ctx, "LC: Replacing existing poll for user")
        cancelExistingPoll(existing)
    }

    logger.debug(ctx, "LC: Poll subscribed")
    activePolls.set(userId, { requestId, workerId: worker.id })
    requestToUser.set(requestId, userId)
}

function handleUnsubscribe(msg) {
    const { requestId } = msg
    const userId = requestToUser.get(requestId)

    if (userId !== undefined) {
        const existing = activePolls.get(userId)
        if (existing && existing.requestId === requestId) {
            activePolls.delete(userId)
        }
        requestToUser.delete(requestId)
    }
}

function handlePublish(msg) {
    const { userId } = msg
    const poll = activePolls.get(userId)
    if (poll) {
        const worker = cluster.workers[poll.workerId]
        if (worker) {
            logger.debug(
                { uid: userId, reqId: poll.requestId, workerId: poll.workerId },
                "LC: Waking user poll"
            )
            worker.send({
                lc: true,
                type: "WAKE",
                requestId: poll.requestId,
            })
        }
    }
}

const setupWorkers = new Set()

function setupWorkerHandlers(worker) {
    if (setupWorkers.has(worker.id)) return
    setupWorkers.add(worker.id)

    worker.on("message", (msg) => {
        if (!msg.lc) return

        switch (msg.type) {
            case "SUBSCRIBE":
                handleSubscribe(worker, msg)
                break
            case "UNSUBSCRIBE":
                handleUnsubscribe(msg)
                break
            case "PUBLISH":
                handlePublish(msg)
                break
        }
    })
}

let masterBrokerSetup = false

function setupMasterBroker() {
    if (!cluster.isMaster && !cluster.isPrimary) return
    if (masterBrokerSetup) return
    masterBrokerSetup = true

    const workerCount = Object.keys(cluster.workers || {}).length
    logger.info({}, `LC: Master broker starting with ${workerCount} workers`)

    for (const id in cluster.workers) {
        setupWorkerHandlers(cluster.workers[id])
    }

    cluster.on("fork", (worker) => {
        setupWorkerHandlers(worker)
    })

    cluster.on("exit", (worker) => {
        // Clean up stale polls from the dead worker
        setupWorkers.delete(worker.id)
        for (const [userId, poll] of activePolls) {
            if (poll.workerId === worker.id) {
                logger.debug(
                    { uid: userId, workerId: worker.id },
                    "LC: Cleaning up stale poll for dead worker"
                )
                requestToUser.delete(poll.requestId)
                activePolls.delete(userId)
            }
        }
    })

    logger.info({}, "LC: Master broker ready")
}

function getActivePollCount() {
    return activePolls.size
}

function clearAllPolls() {
    activePolls.clear()
    requestToUser.clear()
}

module.exports = {
    setupMasterBroker,
    getActivePollCount,
    clearAllPolls,
    handleSubscribe,
    handleUnsubscribe,
    handlePublish,
}
