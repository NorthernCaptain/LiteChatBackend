#!/usr/bin/env node

/**
 * LiteChat CLI — interactive testing tool for the LiteChat API.
 * Zero npm dependencies. Requires Node.js >= 22.
 *
 * Usage:
 *   node tools/chat-cli.js \
 *     --email user@example.com \
 *     --password mypass \
 *     --host https://localhost:3002 \
 *     --client-id myapp \
 *     --client-secret mysecret
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0" // dev tool, may hit self-signed certs

const readline = require("node:readline")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")

// ── ANSI colors ──────────────────────────────────────────────────────────────

const C = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
}

// ── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2)
    const opts = {}
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--") && i + 1 < args.length) {
            opts[args[i].slice(2)] = args[++i]
        }
    }

    const missing = [
        "email",
        "password",
        "host",
        "client-id",
        "client-secret",
    ].filter((k) => !opts[k])

    if (missing.length) {
        console.error(
            `${C.red}Missing required arguments: ${missing.map((k) => "--" + k).join(", ")}${C.reset}\n`
        )
        console.error(
            "Usage: node tools/chat-cli.js \\\n" +
                "  --email <email> --password <password> --host <url> \\\n" +
                "  --client-id <id> --client-secret <secret>"
        )
        process.exit(1)
    }

    return {
        email: opts.email,
        password: opts.password,
        host: opts.host.replace(/\/$/, ""),
        clientId: opts["client-id"],
        clientSecret: opts["client-secret"],
    }
}

const config = parseArgs()

// ── State ────────────────────────────────────────────────────────────────────

let accessToken = null
let tokenTimer = null
let polling = true
let lastPendingId = "0"
let busy = false
const userCache = new Map() // userId -> name

// ── Readline setup ───────────────────────────────────────────────────────────

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.cyan}litechat>${C.reset} `,
})

function printAbove(text) {
    readline.clearLine(process.stdout, 0)
    readline.cursorTo(process.stdout, 0)
    process.stdout.write(text + "\n")
    rl.prompt(true)
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function api(method, apiPath, body) {
    const url = `${config.host}/litechat/api/v1${apiPath}`
    const headers = { Authorization: `Bearer ${accessToken}` }
    const opts = { method, headers }

    if (body !== undefined) {
        headers["Content-Type"] = "application/json"
        opts.body = JSON.stringify(body)
    }

    const res = await fetch(url, opts)
    const data = await res.json()
    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
    }
    return data
}

async function apiUpload(filePath) {
    const url = `${config.host}/litechat/api/v1/attachments/upload`
    const fullPath = path.resolve(filePath)

    if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${fullPath}`)
    }

    const buf = fs.readFileSync(fullPath)
    const filename = path.basename(fullPath)
    const mime = guessMime(filename)
    const blob = new Blob([buf], { type: mime })

    const form = new FormData()
    form.append("file", blob, filename)

    const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
    })
    const data = await res.json()
    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
    }
    return data
}

function guessMime(filename) {
    const ext = path.extname(filename).toLowerCase()
    const map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
        ".avi": "video/x-msvideo",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".json": "application/json",
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".zip": "application/zip",
    }
    return map[ext] || "application/octet-stream"
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function login() {
    const body = new URLSearchParams({
        grant_type: "password",
        username: config.email,
        password: config.password,
        client_id: config.clientId,
        client_secret: config.clientSecret,
    })

    const res = await fetch(`${config.host}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    })

    if (!res.ok) {
        const text = await res.text()
        throw new Error(`Login failed (${res.status}): ${text}`)
    }

    const data = await res.json()
    accessToken = data.access_token
    return data
}

function startTokenRefresh() {
    tokenTimer = setInterval(
        async () => {
            try {
                await login()
                printAbove(`${C.dim}[token refreshed]${C.reset}`)
            } catch (err) {
                printAbove(
                    `${C.red}[token refresh failed: ${err.message}]${C.reset}`
                )
            }
        },
        15 * 60 * 1000
    )
}

// ── User cache ───────────────────────────────────────────────────────────────

async function loadUsers() {
    const data = await api("GET", "/users")
    userCache.clear()
    for (const u of data.users) {
        userCache.set(u.userId, u.name)
    }
    return data.users
}

function userName(id) {
    return userCache.get(id) || `user#${id}`
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtTime(isoStr) {
    if (!isoStr) return ""
    const d = new Date(isoStr)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function truncate(str, len) {
    if (!str) return ""
    return str.length > len ? str.slice(0, len - 1) + "\u2026" : str
}

function padR(str, len) {
    return (str + " ".repeat(len)).slice(0, len)
}

// ── Command implementations ──────────────────────────────────────────────────

async function cmdUsers() {
    const users = await loadUsers()
    console.log(
        `\n${C.bold}  ${padR("ID", 8)}${padR("Name", 20)}Avatar${C.reset}`
    )
    console.log(`  ${"-".repeat(40)}`)
    for (const u of users) {
        console.log(
            `  ${padR(String(u.userId), 8)}${padR(u.name, 20)}${u.avatar || C.dim + "none" + C.reset}`
        )
    }
    console.log()
}

async function cmdConversations() {
    const data = await api("GET", "/conversations")
    const convos = data.conversations
    if (!convos.length) {
        console.log(`\n${C.dim}  No conversations.${C.reset}\n`)
        return
    }

    console.log(
        `\n${C.bold}  ${padR("ID", 8)}${padR("Type", 8)}${padR("Name", 16)}${padR("Members", 24)}Last message${C.reset}`
    )
    console.log(`  ${"-".repeat(72)}`)
    for (const c of convos) {
        const members = c.members.map((m) => userName(m.userId)).join(", ")
        const last = c.lastMessage
            ? `"${truncate(c.lastMessage.text, 30)}" (${fmtTime(c.lastMessage.createdAt)})`
            : C.dim + "none" + C.reset
        console.log(
            `  ${padR(c.id, 8)}${padR(c.type, 8)}${padR(c.name || "-", 16)}${padR(truncate(members, 22), 24)}${last}`
        )
    }
    console.log()
}

async function cmdCreateConvo(type, memberIds, name) {
    const body = { type, memberIds }
    if (name) body.name = name
    const data = await api("POST", "/conversations", body)
    const members = data.members.map((m) => userName(m.userId)).join(", ")
    console.log(
        `\n${C.green}  Created ${data.type} conversation #${data.id} with [${members}]${C.reset}\n`
    )
}

async function cmdMessages(convId, after) {
    const query = after ? `?after=${after}&limit=50` : "?after=0&limit=50"
    const data = await api("GET", `/conversations/${convId}/messages${query}`)
    const msgs = data.messages
    if (!msgs.length) {
        console.log(`\n${C.dim}  No messages.${C.reset}\n`)
        return
    }

    console.log()
    for (const m of msgs) {
        const time = fmtTime(m.createdAt)
        const name = userName(m.senderId)
        let line = `  ${C.dim}[${time}]${C.reset} ${C.bold}${name}:${C.reset} `

        if (m.text) line += m.text
        if (m.attachments && m.attachments.length) {
            const files = m.attachments
                .map((a) => `\u{1F4CE} ${a.originalFilename}`)
                .join(", ")
            line += (m.text ? " " : "") + files
        }
        if (m.referenceMessageId) {
            line += ` ${C.dim}(reply to #${m.referenceMessageId})${C.reset}`
        }
        if (m.reactions && m.reactions.length) {
            const reacts = m.reactions
                .map((r) => `${r.emoji}(${r.userIds.length})`)
                .join(" ")
            line += ` ${C.yellow}${reacts}${C.reset}`
        }
        console.log(`${line}  ${C.dim}#${m.id}${C.reset}`)
    }
    console.log()
}

async function cmdSend(convId, text, attachmentIds) {
    const body = {}
    if (text) body.text = text
    if (attachmentIds && attachmentIds.length)
        body.attachmentIds = attachmentIds
    const msg = await api("POST", `/conversations/${convId}/messages`, body)
    console.log(
        `${C.green}  Sent message #${msg.id} to conversation #${msg.conversationId}${C.reset}`
    )
}

async function cmdUpload(filePath) {
    const data = await apiUpload(filePath)
    console.log(
        `${C.green}  Uploaded: id=${data.id}, ${data.originalFilename} (${data.mimeType}, ${data.size} bytes, thumbnail: ${data.hasThumbnail})${C.reset}`
    )
    return data
}

async function cmdSendFile(convId, filePath) {
    const att = await cmdUpload(filePath)
    await cmdSend(convId, null, [parseInt(att.id, 10)])
}

async function cmdReact(messageId, emoji) {
    const data = await api("POST", `/messages/${messageId}/reactions`, {
        emoji,
    })
    console.log(
        `${C.green}  Reacted ${data.emoji} on message #${data.messageId}${C.reset}`
    )
}

async function cmdAck(convId, messageId) {
    await api("POST", `/conversations/${convId}/ack`, { messageId })
    console.log(
        `${C.green}  Delivery ack sent for conversation #${convId} up to msg #${messageId}${C.reset}`
    )
}

async function cmdRead(convId, messageId) {
    await api("POST", `/conversations/${convId}/read`, { messageId })
    console.log(
        `${C.green}  Read receipt sent for conversation #${convId} up to msg #${messageId}${C.reset}`
    )
}

async function cmdTyping(convId, onOff) {
    const typing = onOff !== "off"
    await api("POST", `/conversations/${convId}/typing`, { typing })
    console.log(
        `${C.green}  Typing ${typing ? "ON" : "OFF"} in conversation #${convId}${C.reset}`
    )
}

function cmdHelp() {
    console.log(`
${C.bold}Commands:${C.reset}
  /users                          List chat users
  /convos                         List conversations
  /convo direct <userId>          Create direct conversation
  /convo group <id1,id2> <name>   Create group conversation
  /msg <convId>                   List messages (last 50)
  /msg <convId> after <msgId>     List messages after cursor
  /send <convId> <text...>        Send a text message
  /upload <filepath>              Upload file, get attachment ID
  /sendfile <convId> <filepath>   Upload + send in one step
  /react <msgId> <emoji>          Add reaction to a message
  /ack <convId> <msgId>            Send delivery acknowledgment
  /read <convId> <msgId>           Send read receipt
  /type <convId> [on|off]         Send typing indicator (default: on)
  /help                           Show this help
  /quit                           Exit
`)
}

// ── Command dispatcher ───────────────────────────────────────────────────────

async function handleCommand(line) {
    if (!line) return
    if (!line.startsWith("/")) {
        console.log(
            `${C.dim}  Commands start with /. Type /help for a list.${C.reset}`
        )
        return
    }

    const parts = line.slice(1).split(/\s+/)
    const cmd = parts[0].toLowerCase()

    try {
        switch (cmd) {
            case "users":
                await cmdUsers()
                break

            case "convos":
            case "conversations":
                await cmdConversations()
                break

            case "convo": {
                const type = parts[1]
                if (!type || !["direct", "group"].includes(type)) {
                    console.log(
                        `${C.red}  Usage: /convo direct <userId>  or  /convo group <id1,id2> <name>${C.reset}`
                    )
                    break
                }
                if (type === "direct") {
                    const userId = parseInt(parts[2], 10)
                    if (!userId) {
                        console.log(
                            `${C.red}  Usage: /convo direct <userId>${C.reset}`
                        )
                        break
                    }
                    await cmdCreateConvo("direct", [userId])
                } else {
                    const ids = (parts[2] || "")
                        .split(",")
                        .map((s) => parseInt(s.trim(), 10))
                        .filter(Boolean)
                    const name = parts.slice(3).join(" ")
                    if (!ids.length || !name) {
                        console.log(
                            `${C.red}  Usage: /convo group <id1,id2> <name>${C.reset}`
                        )
                        break
                    }
                    await cmdCreateConvo("group", ids, name)
                }
                break
            }

            case "msg":
            case "messages": {
                const convId = parts[1]
                if (!convId) {
                    console.log(
                        `${C.red}  Usage: /msg <convId> [after <msgId>]${C.reset}`
                    )
                    break
                }
                const after = parts[2] === "after" ? parts[3] || "0" : undefined
                await cmdMessages(convId, after)
                break
            }

            case "send": {
                const convId = parts[1]
                const text = parts.slice(2).join(" ")
                if (!convId || !text) {
                    console.log(
                        `${C.red}  Usage: /send <convId> <text...>${C.reset}`
                    )
                    break
                }
                await cmdSend(convId, text)
                break
            }

            case "upload": {
                const filePath = parts[1]
                if (!filePath) {
                    console.log(`${C.red}  Usage: /upload <filepath>${C.reset}`)
                    break
                }
                await cmdUpload(filePath)
                break
            }

            case "sendfile": {
                const convId = parts[1]
                const filePath = parts[2]
                if (!convId || !filePath) {
                    console.log(
                        `${C.red}  Usage: /sendfile <convId> <filepath>${C.reset}`
                    )
                    break
                }
                await cmdSendFile(convId, filePath)
                break
            }

            case "react": {
                const msgId = parts[1]
                const emoji = parts[2]
                if (!msgId || !emoji) {
                    console.log(
                        `${C.red}  Usage: /react <msgId> <emoji>${C.reset}`
                    )
                    break
                }
                await cmdReact(msgId, emoji)
                break
            }

            case "ack": {
                const convId = parts[1]
                const msgId = parts[2]
                if (!convId || !msgId) {
                    console.log(
                        `${C.red}  Usage: /ack <convId> <msgId>${C.reset}`
                    )
                    break
                }
                await cmdAck(convId, msgId)
                break
            }

            case "read": {
                const convId = parts[1]
                const msgId = parts[2]
                if (!convId || !msgId) {
                    console.log(
                        `${C.red}  Usage: /read <convId> <msgId>${C.reset}`
                    )
                    break
                }
                await cmdRead(convId, msgId)
                break
            }

            case "type":
            case "typing": {
                const convId = parts[1]
                const onOff = (parts[2] || "on").toLowerCase()
                if (!convId) {
                    console.log(
                        `${C.red}  Usage: /type <convId> [on|off]${C.reset}`
                    )
                    break
                }
                await cmdTyping(convId, onOff)
                break
            }

            case "help":
                cmdHelp()
                break

            case "quit":
            case "exit":
                polling = false
                if (tokenTimer) clearInterval(tokenTimer)
                console.log("Bye!")
                process.exit(0)
                break

            default:
                console.log(
                    `${C.red}  Unknown command: /${cmd}. Type /help for a list.${C.reset}`
                )
        }
    } catch (err) {
        const detail = err.cause ? `: ${err.cause.message}` : ""
        console.error(`${C.red}  Error: ${err.message}${detail}${C.reset}`)
    }
}

// ── Poll loop ────────────────────────────────────────────────────────────────

function displayEvent(evt) {
    const convId = evt.conversationId
    if (evt.type === "message" && evt.message) {
        const m = evt.message
        const name = userName(m.senderId)
        let text = m.text || ""
        if (m.attachments && m.attachments.length) {
            const files = m.attachments
                .map((a) => `\u{1F4CE} ${a.originalFilename}`)
                .join(", ")
            text += (text ? " " : "") + files
        }
        printAbove(
            `${C.green}\u2190 [${convId}:${m.id}] ${name}: ${text}${C.reset}`
        )
    } else if (evt.type === "reaction" && evt.reaction) {
        const r = evt.reaction
        printAbove(
            `${C.yellow}\u2190 [conv:${convId}] ${userName(r.userId)} reacted ${r.emoji} on msg #${r.messageId}${C.reset}`
        )
    } else if (evt.type === "delivery" && evt.meta) {
        printAbove(
            `${C.blue}\u2190 [conv:${convId}] \u2713 delivered up to msg #${evt.meta.messageId}${C.reset}`
        )
    } else if (evt.type === "read" && evt.meta) {
        printAbove(
            `${C.blue}\u2190 [conv:${convId}] \u2713\u2713 read up to msg #${evt.meta.messageId}${C.reset}`
        )
    } else if (evt.type === "typing" && evt.meta) {
        const name = evt.meta.name || `user#${evt.meta.userId}`
        const state = evt.meta.active ? "typing" : "stopped typing"
        printAbove(
            `${C.magenta}\u2190 [conv:${convId}] ${name} ${state}${C.reset}`
        )
    } else {
        printAbove(
            `${C.dim}\u2190 [conv:${convId}] event: ${evt.type}${C.reset}`
        )
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollLoop() {
    while (polling) {
        try {
            const data = await api("POST", "/poll", {
                after: lastPendingId,
            })
            if (data.events && data.events.length) {
                for (const evt of data.events) {
                    displayEvent(evt)
                    if (BigInt(evt.pendingId) > BigInt(lastPendingId)) {
                        lastPendingId = evt.pendingId
                    }
                    // Auto-send delivery ack for messages
                    if (evt.type === "message" && evt.message) {
                        api("POST", `/conversations/${evt.conversationId}/ack`, {
                            messageId: evt.message.id,
                        }).catch(() => {})
                    }
                }
            }
        } catch (err) {
            if (polling) {
                printAbove(`${C.red}[poll error: ${err.message}]${C.reset}`)
                await sleep(3000)
            }
        }
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

;(async () => {
    try {
        console.log(`${C.cyan}Logging in as ${config.email}...${C.reset}`)
        const authData = await login()
        console.log(
            `${C.green}Logged in. Token expires in ${authData.expires_in}s.${C.reset}`
        )

        console.log(`${C.dim}Loading users...${C.reset}`)
        await loadUsers()
        console.log(
            `${C.dim}Loaded ${userCache.size} user(s). Starting poll...${C.reset}\n`
        )

        startTokenRefresh()
        pollLoop() // intentionally not awaited — runs in background

        rl.prompt()
        rl.on("line", async (line) => {
            if (busy) return
            busy = true
            await handleCommand(line.trim())
            busy = false
            rl.prompt()
        })

        rl.on("SIGINT", () => {
            polling = false
            if (tokenTimer) clearInterval(tokenTimer)
            console.log("\nBye!")
            process.exit(0)
        })
    } catch (err) {
        const detail = err.cause ? `: ${err.cause.message}` : ""
        console.error(`${C.red}Fatal: ${err.message}${detail}${C.reset}`)
        process.exit(1)
    }
})()
