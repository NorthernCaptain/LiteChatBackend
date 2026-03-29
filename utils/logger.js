/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const crypto = require("crypto")

const pid = String(process.pid).padStart(7, " ")
const workerId = String(process.env.WORKER_ID || "0").padStart(2, " ")

const LOG_LEVEL = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
}

const currentLogLevel = LOG_LEVEL[process.env.LOG_LEVEL] || LOG_LEVEL.DEBUG

function generateRequestId() {
    return crypto.randomUUID().substring(0, 8)
}

function formatTimestamp() {
    const now = new Date()
    const pad = (n, len = 2) => String(n).padStart(len, "0")
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)} ${pid}:${workerId}:`
}

function formatContext(ctx) {
    if (!ctx || Object.keys(ctx).length === 0) return ""
    const parts = []
    for (const [key, value] of Object.entries(ctx)) {
        if (value === undefined || value === null) continue
        if (typeof value === "bigint") {
            parts.push(`${key}=${value.toString()}`)
        } else if (typeof value === "object") {
            parts.push(`${key}=${JSON.stringify(value)}`)
        } else {
            parts.push(`${key}=${value}`)
        }
    }
    return parts.length > 0 ? `[${parts.join(" ")}]` : ""
}

function logWithContext(level, ctx, message, ...args) {
    const levelNum = LOG_LEVEL[level] || LOG_LEVEL.INFO
    if (levelNum < currentLogLevel) return

    const prefix = `${formatTimestamp()} ${level.substring(0, 3)}`
    const context = formatContext(ctx)
    const fullMessage = context
        ? `${prefix} ${context} ${message}`
        : `${prefix} ${message}`

    switch (level) {
        case "ERROR":
            console.error(fullMessage, ...args)
            break
        case "WARN":
            console.warn(fullMessage, ...args)
            break
        default:
            console.log(fullMessage, ...args)
    }
}

const logger = {
    debug: (ctx, message, ...args) =>
        logWithContext("DEBUG", ctx, message, ...args),
    info: (ctx, message, ...args) =>
        logWithContext("INFO", ctx, message, ...args),
    warn: (ctx, message, ...args) =>
        logWithContext("WARN", ctx, message, ...args),
    error: (ctx, message, ...args) =>
        logWithContext("ERROR", ctx, message, ...args),
}

function requestLogger(req, res, next) {
    const requestId = generateRequestId()
    const startTime = Date.now()
    req.requestId = requestId

    const sourceIp =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        "-"
    const userAgent = req.headers["user-agent"] || "-"

    console.log(
        `${formatTimestamp()}: ${requestId} ${req.method} ${req.originalUrl} ${sourceIp} "${userAgent}"`
    )

    res.on("finish", () => {
        const duration = Date.now() - startTime
        const status = res.statusCode
        const statusText = status >= 400 ? "Error" : "OK"
        console.log(
            `${formatTimestamp()}: ${requestId} ${status} ${statusText} (${duration}ms)`
        )
    })

    next()
}

module.exports = {
    requestLogger,
    formatTimestamp,
    generateRequestId,
    logger,
    LOG_LEVEL,
}
