/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const path = require("path")
const fs = require("fs")
const { execFile } = require("child_process")
const sharp = require("sharp")
const { logger } = require("../utils/logger")
const { LIMITS, IMAGE_MIME_TYPES, VIDEO_MIME_TYPES } = require("./constants")
const { dbInsertAttachment, dbGetAttachment } = require("../db/attachments")
const { dbIsUserMember } = require("../db/conversations")

const STORAGE_BASE =
    process.env.LC_STORAGE_PATH ||
    path.join(__dirname, "..", "storage")
const ORIGINALS_DIR = path.join(STORAGE_BASE, "originals")
const THUMBNAILS_DIR = path.join(STORAGE_BASE, "thumbnails")
const AVATARS_DIR = path.join(STORAGE_BASE, "avatars")

// Ensure storage directories exist
for (const dir of [ORIGINALS_DIR, THUMBNAILS_DIR, AVATARS_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
}

async function generateImageThumbnail(sourcePath, thumbnailPath) {
    await sharp(sourcePath)
        .resize(LIMITS.THUMBNAIL_WIDTH)
        .jpeg({ quality: LIMITS.THUMBNAIL_QUALITY })
        .toFile(thumbnailPath)
}

async function generateVideoThumbnail(sourcePath, thumbnailPath) {
    const tmpFrame = thumbnailPath + ".tmp.png"
    try {
        await new Promise((resolve, reject) => {
            execFile(
                "ffmpeg",
                [
                    "-i",
                    sourcePath,
                    "-ss",
                    "1",
                    "-vframes",
                    "1",
                    "-y",
                    tmpFrame,
                ],
                { timeout: 15000 },
                (err) => {
                    if (err) reject(err)
                    else resolve()
                }
            )
        })
        await sharp(tmpFrame)
            .resize(LIMITS.THUMBNAIL_WIDTH)
            .jpeg({ quality: LIMITS.THUMBNAIL_QUALITY })
            .toFile(thumbnailPath)
    } finally {
        try {
            fs.unlinkSync(tmpFrame)
        } catch {
            // tmp file may not exist if ffmpeg failed
        }
    }
}

async function uploadAttachment(file, senderId) {
    const serverFilename = file.filename
    const originalFilename = file.originalname
    const mimeType = file.mimetype
    const size = file.size

    let thumbnailFilename = null
    const sourcePath = path.join(ORIGINALS_DIR, serverFilename)

    try {
        if (IMAGE_MIME_TYPES.has(mimeType)) {
            thumbnailFilename = serverFilename + ".thumb.jpg"
            await generateImageThumbnail(
                sourcePath,
                path.join(THUMBNAILS_DIR, thumbnailFilename)
            )
        } else if (VIDEO_MIME_TYPES.has(mimeType)) {
            thumbnailFilename = serverFilename + ".thumb.jpg"
            try {
                await generateVideoThumbnail(
                    sourcePath,
                    path.join(THUMBNAILS_DIR, thumbnailFilename)
                )
            } catch (err) {
                logger.warn(
                    { senderId },
                    "Video thumbnail generation failed:",
                    err.message
                )
                thumbnailFilename = null
            }
        }
    } catch (err) {
        logger.warn(
            { senderId },
            "Thumbnail generation failed:",
            err.message
        )
        thumbnailFilename = null
    }

    const id = await dbInsertAttachment(
        senderId,
        serverFilename,
        originalFilename,
        mimeType,
        size,
        thumbnailFilename
    )

    return {
        id,
        originalFilename,
        mimeType,
        size,
        hasThumbnail: !!thumbnailFilename,
    }
}

async function getAttachmentForDownload(attachmentId, userId) {
    const att = await dbGetAttachment(attachmentId)
    if (!att) {
        const err = new Error("Attachment not found")
        err.status = 404
        throw err
    }

    // Auth: if linked to a message, user must be conversation member
    // If orphaned (no message), only uploader can access
    if (att.message_id) {
        const { dbGetMessage } = require("../db/messages")
        const msg = await dbGetMessage(att.message_id)
        if (msg) {
            const isMember = await dbIsUserMember(msg.conversation_id, userId)
            if (!isMember) {
                const err = new Error("Not authorized to access this attachment")
                err.status = 403
                throw err
            }
        }
    } else if (att.sender_id !== userId) {
        const err = new Error("Not authorized to access this attachment")
        err.status = 403
        throw err
    }

    return att
}

function safePath(baseDir, filename) {
    const resolved = path.resolve(baseDir, filename)
    if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
        const err = new Error("Invalid file path")
        err.status = 400
        throw err
    }
    return resolved
}

function getOriginalPath(serverFilename) {
    return safePath(ORIGINALS_DIR, serverFilename)
}

function getThumbnailPath(thumbnailFilename) {
    return safePath(THUMBNAILS_DIR, thumbnailFilename)
}

function getAvatarPath(filename) {
    return safePath(AVATARS_DIR, filename)
}

module.exports = {
    uploadAttachment,
    getAttachmentForDownload,
    getOriginalPath,
    getThumbnailPath,
    getAvatarPath,
    ORIGINALS_DIR,
    THUMBNAILS_DIR,
    AVATARS_DIR,
}
