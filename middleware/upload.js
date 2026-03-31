/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const multer = require("multer")
const crypto = require("crypto")
const path = require("path")
const fs = require("fs")
const {
    LIMITS,
    IMAGE_MIME_TYPES,
    VIDEO_MIME_TYPES,
} = require("../services/constants")

const STORAGE_BASE = path.resolve(
    process.env.LC_STORAGE_PATH || path.join(__dirname, "..", "storage")
)
const ORIGINALS_DIR = path.resolve(STORAGE_BASE, "originals")

fs.mkdirSync(ORIGINALS_DIR, { recursive: true })

const ALLOWED_MIME_TYPES = new Set([
    ...IMAGE_MIME_TYPES,
    ...VIDEO_MIME_TYPES,
    "application/pdf",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "application/zip",
    "application/x-zip-compressed",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])

// Allowed extensions (lowercase, with dot)
const ALLOWED_EXTENSIONS = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".mp4",
    ".mov",
    ".webm",
    ".avi",
    ".pdf",
    ".mp3",
    ".ogg",
    ".wav",
    ".zip",
    ".txt",
    ".doc",
    ".docx",
    ".apk",
    ".exe",
    ".tar",
    ".gz",
    ".rar",
    ".7z",
    ".bz2",
    ".xz",
    ".deb",
    ".rpm",
    ".pkg",
    ".msi",
    ".jar",
    ".war",
    ".ear",
    ".sar",
    ".ipa",
    ".app",
    ".dmg",
    ".xlsx",
    ".xls",
    ".csv",
    ".ppt",
    ".pptx",
])

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, ORIGINALS_DIR)
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase()
        const name = crypto.randomUUID() + ext
        cb(null, name)
    },
})

function fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase()
    if (
        !ALLOWED_MIME_TYPES.has(file.mimetype) ||
        !ALLOWED_EXTENSIONS.has(ext)
    ) {
        return cb(new Error("File type not allowed"))
    }
    cb(null, true)
}

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: LIMITS.MAX_UPLOAD_SIZE,
    },
})

module.exports = { upload }
