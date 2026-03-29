# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start standalone dev server (uses `.env.development` via env-cmd, clustered)
- `npm start` — start production server (`node app.js`)
- `npm test` — run all tests (Jest)
- `npx jest path/to/file.test.js` — run a single test file
- `npm run format` — format with Prettier
- `npm run format:check` — check formatting

## Architecture

LiteChatBackend is a family chat API that runs in two modes:

1. **Plugin mode** (primary): loaded by LinesBackend's dynamic module system via `index.js`, which exports `{ name, mountPath, createRouter, setupMaster }`. All endpoints mount at `/litechat/api/v1` and are OAuth-protected via `app.oauth.authorise()`.

2. **Standalone mode**: `app.js` boots a clustered Express server directly (no OAuth — useful for dev).

### Cluster + Long-Polling

The app uses Node.js `cluster` module. The master process runs `clusterBroker.js` which routes IPC messages (prefixed `lc: true`) between workers to coordinate long-polling. Pattern adapted from NavalClash but keyed by **user ID** instead of session ID.

Flow: client POSTs `/poll` → worker checks `pending_events` table → if empty, SUBSCRIBE via IPC to master → master tracks `activePolls` map → when another worker inserts a message, it sends PUBLISH via IPC → master forwards WAKE to the correct worker → worker responds to held HTTP request. 15s timeout if no events.

### Database

Two MySQL connection pools in `db/pool.js`:
- **pool**: litechat's own database (env: `LC_DB_*`)
- **authPool**: LinesBackend's auth database (env: `db_auth_*`) — used to query users with `chat_access = 1`

BIGINT columns are returned as strings (mysql2 `bigNumberStrings: true`). All timestamps use millisecond precision (`TIMESTAMP(3)`).

SQL migrations are in `sql/` numbered `001`–`007`. Run `001`–`006` against the litechat DB, `007` against authdb.

### Layer Structure

`routes/litechat.js` (single router) → `services/*` (business logic) → `db/*` (raw queries). Services handle IPC communication and side effects (pending_events insertion, cluster PUBLISH). The route file wraps all handlers with `asyncHandler` for promise error propagation.

### Attachments

Upload flow: multer saves to `storage/originals/`, `attachmentService` generates thumbnails via sharp (images) or ffmpeg+sharp (video), DB row created with `message_id = NULL`. Attachment is linked to a message when the message is sent.

## Code Style

- Prettier: no semicolons, 4-space indent, trailing commas in ES5 positions
- Node.js >= 22, CommonJS (`require`/`module.exports`)
- No linter configured beyond Prettier
