/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const TIMING = {
    POLL_TIMEOUT_MS: 15000,
    POLL_MAX_EVENTS: 50,
}

const LIMITS = {
    MAX_MESSAGE_LENGTH: 10000,
    MAX_PAGE_SIZE: 100,
    DEFAULT_PAGE_SIZE: 50,
    MAX_UPLOAD_SIZE: 150 * 1024 * 1024, // 150MB
    THUMBNAIL_WIDTH: 300,
    THUMBNAIL_QUALITY: 80,
}

const IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
])

const VIDEO_MIME_TYPES = new Set([
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "video/x-msvideo",
])

// MIME types safe for inline display (no XSS risk)
const SAFE_MIME_TYPES = new Set([
    ...IMAGE_MIME_TYPES,
    ...VIDEO_MIME_TYPES,
    "application/pdf",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
])

module.exports = {
    TIMING,
    LIMITS,
    IMAGE_MIME_TYPES,
    VIDEO_MIME_TYPES,
    SAFE_MIME_TYPES,
}
