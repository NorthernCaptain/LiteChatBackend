# LiteChatBackend - Family Chat API

Backend service for LiteChat family chat app. Express.js module loaded into LinesBackend.

## Context

Plugs into LinesBackend via dynamic module loader (`MODULES_PATH` env var). All endpoints OAuth-protected using LinesBackend's `app.oauth.authorise()` which populates `req.user.user_id`. Long-polling follows NavalClashBackend's cluster broker pattern, adapted from session-keyed to user-keyed.

## Project Structure

```
LiteChatBackend/
├── index.js                    # Module entry (name, mountPath, createRouter, setupMaster)
├── app.js                      # Standalone dev server with cluster
├── package.json
├── .gitignore
├── db/
│   ├── pool.js                 # mysql2/promise pool (env: LC_DB_*) + authdb ref
│   ├── users.js                # Query authdb.users for chat-enabled users
│   ├── conversations.js        # Conversation CRUD queries
│   ├── messages.js             # Message + pending event queries
│   ├── attachments.js          # Attachment metadata queries
│   ├── reactions.js            # Reaction queries
│   └── fcmTokens.js            # FCM token CRUD
├── routes/
│   └── litechat.js             # All API routes (single router, receives app)
├── services/
│   ├── conversationService.js
│   ├── messageService.js       # Includes long-poll logic
│   ├── attachmentService.js    # Upload, download, thumbnail generation
│   ├── reactionService.js
│   ├── clusterBroker.js        # Master-side IPC broker (lc: prefix)
│   ├── fcmService.js           # Firebase Cloud Messaging (push notifications)
│   └── constants.js
├── middleware/
│   └── upload.js               # Multer config
├── sql/
│   ├── 001_schema.sql
│   ├── 002_conversations.sql
│   ├── 003_messages.sql
│   ├── 004_attachments.sql
│   ├── 005_reactions.sql
│   ├── 006_pending_events.sql
│   ├── 007_authdb_chat_access.sql
│   └── 008-fcm-tokens.sql
└── storage/                    # gitignored
    ├── originals/
    ├── thumbnails/
    └── avatars/
```

## Database Schema

### conversations
```sql
CREATE TABLE conversations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type ENUM('direct','group') NOT NULL DEFAULT 'direct',
    name VARCHAR(255) DEFAULT NULL,
    created_by INT UNSIGNED NOT NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);
```

### conversation_members
```sql
CREATE TABLE conversation_members (
    conversation_id BIGINT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    joined_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (conversation_id, user_id),
    KEY idx_user (user_id, conversation_id)
);
```

### messages
```sql
CREATE TABLE messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id BIGINT UNSIGNED NOT NULL,
    sender_id INT UNSIGNED NOT NULL,
    text TEXT DEFAULT NULL,
    reference_message_id BIGINT UNSIGNED DEFAULT NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_conv (conversation_id, id),
    KEY idx_sender (sender_id)
);
```

### attachments
```sql
CREATE TABLE attachments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    message_id BIGINT UNSIGNED DEFAULT NULL,
    sender_id INT UNSIGNED NOT NULL,
    server_filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(127) NOT NULL,
    size INT UNSIGNED NOT NULL,
    thumbnail_filename VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_message (message_id)
);
```

### reactions
```sql
CREATE TABLE reactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    message_id BIGINT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    emoji VARCHAR(32) NOT NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_reaction (message_id, user_id, emoji)
);
```

### pending_events
```sql
CREATE TABLE pending_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    type ENUM('message','reaction') NOT NULL DEFAULT 'message',
    conversation_id BIGINT UNSIGNED NOT NULL,
    message_id BIGINT UNSIGNED DEFAULT NULL,
    reaction_id BIGINT UNSIGNED DEFAULT NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_user_pending (user_id, id)
);
```
### fcm_tokens
```sql
CREATE TABLE fcm_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    token VARCHAR(512) NOT NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_token (token),
    KEY idx_user (user_id)
);
```

Extensible: new event types can be added to the ENUM and a corresponding `*_id` column added. The `type` column tells the client which payload to expect in the poll response.

## Data Models

### User (from LinesBackend authdb)
```
{
    "userId": 10,               // INT - authdb.users.user_id
    "name": "Leo",              // VARCHAR(255) - display name
    "avatar": "a1b2c3.jpg"     // VARCHAR(255) - avatar server filename (nullable)
}
```
Requires new columns on authdb `users` table:
- `chat_access TINYINT NOT NULL DEFAULT 0` - 1 = user can access chat
- `avatar VARCHAR(255) DEFAULT NULL` - avatar image filename (stored in storage/avatars/)

### Conversation
```
{
    "id": "1",                  // BIGINT as string
    "type": "direct",           // "direct" | "group"
    "name": null,               // string | null (required for group, null for direct)
    "createdBy": 10,            // INT - user who created it
    "members": [Member],        // array of Member objects
    "lastMessage": Message,     // last message preview (nullable, only in list endpoint)
    "createdAt": "2026-03-28T12:00:00.000Z",
    "updatedAt": "2026-03-28T14:30:00.000Z"
}
```

### Member
```
{
    "userId": 10,               // INT
    "joinedAt": "2026-03-28T12:00:00.000Z"
}
```

### Message
```
{
    "id": "151",                // BIGINT as string
    "conversationId": "1",      // BIGINT as string (included in send response & poll)
    "senderId": 10,             // INT
    "text": "Hello!",           // string | null
    "referenceMessageId": "145",// string | null (reply-to)
    "attachments": [Attachment],// array (empty if none)
    "reactions": [ReactionGroup],// array (empty if none)
    "createdAt": "2026-03-28T14:35:00.000Z"
}
```

### Attachment
```
{
    "id": "10",                 // BIGINT as string
    "originalFilename": "photo.jpg",
    "mimeType": "image/jpeg",
    "size": 245000,             // INT bytes
    "hasThumbnail": true        // boolean
}
```
Note: `serverFilename` and `thumbnailFilename` are internal, not exposed to clients.

### ReactionGroup (grouped by emoji in message responses)
```
{
    "emoji": "thumbsup",       // string
    "userIds": [10, 55]        // array of INT
}
```

### Reaction (returned from add reaction endpoint)
```
{
    "id": "50",                 // BIGINT as string
    "messageId": "145",
    "userId": 10,
    "emoji": "thumbsup",
    "createdAt": "2026-03-28T15:00:00.000Z"
}
```

### PendingEvent (returned in poll response)
```
{
    "pendingId": "26",          // BIGINT as string - pending_events.id
    "type": "message",          // "message" | "reaction" | future types
    "conversationId": "1",
    "message": Message,         // full Message object (for type "message")
    "reaction": Reaction,       // Reaction object (for type "reaction", includes messageId)
}
```
Only the field matching `type` is present. This allows future event types without schema changes.

---

## API Endpoints

All mounted at `/litechat/api/v1`. All require OAuth Bearer token (`Authorization: Bearer <token>`).
Auth middleware sets `req.user.user_id` (INT, references LinesBackend authdb users table).

---

### GET /users/me

Get the authenticated user's full profile.

**Response (200):**
```json
{
    "userId": 10,
    "email": "leo@example.com",
    "name": "Leo",
    "avatar": "a1b2c3.jpg",
    "chatAccess": 1
}
```

**Errors:**
- 404: User not found in authdb

---

### GET /users

List all users with chat access. Used by client to show contact list and resolve user names/avatars.

**Response (200):**
```json
{
    "users": [
        { "userId": 10, "name": "Leo", "avatar": "a1b2c3.jpg" },
        { "userId": 42, "name": "Anna", "avatar": null }
    ]
}
```

**Notes:**
- Queries `authdb.users WHERE chat_access = 1`
- Returns all chat-enabled users (family app, small user base)
- `avatar` is null if user hasn't set one

---

### POST /users/me/avatar

Upload a new avatar or remove the existing one.

**Request (upload):** `multipart/form-data`
- Field name: `file` — image file to use as avatar

**Request (remove):** Empty POST (no file field)

**Behavior:**
- Upload: image is resized to 256x256 (cover crop), saved as JPEG in `storage/avatars/`. Old avatar file is deleted.
- Remove: avatar file is deleted from disk, avatar set to null in DB.

**Response (200):**
```json
{
    "avatar": "a1b2c3d4-e5f6.jpg"
}
```
or on removal:
```json
{
    "avatar": null
}
```

---

### GET /users/:userId/avatar

Download a user's avatar image.

**Path parameters:**
- `userId` (int) - User ID

**Response:**
- Binary image file
- `Content-Type: image/jpeg` (or actual mime type)
- Served from `storage/avatars/{avatar_filename}`

**Errors:**
- 404: User not found, user has no avatar, or file not on disk

---

### POST /conversations

Create a new conversation (direct or group).

**Request body:**
```json
{
    "type": "direct",
    "memberIds": [42]
}
```
```json
{
    "type": "group",
    "name": "Family Chat",
    "memberIds": [42, 55, 78]
}
```

**Validation:**
- `type` required, must be `"direct"` or `"group"`
- `memberIds` required, non-empty array of integers (other user IDs, NOT including the sender)
- For `direct`: exactly 1 member in `memberIds` (the other person). If a direct conversation already exists between these two users, return the existing one instead of creating a duplicate.
- For `group`: `name` is required, at least 1 member in `memberIds`
- Sender (`req.user.user_id`) is automatically added as a member

**Response (201 Created):**
```json
{
    "id": "1",
    "type": "direct",
    "name": null,
    "createdBy": 10,
    "members": [
        { "userId": 10, "joinedAt": "2026-03-28T12:00:00.000Z" },
        { "userId": 42, "joinedAt": "2026-03-28T12:00:00.000Z" }
    ],
    "createdAt": "2026-03-28T12:00:00.000Z",
    "updatedAt": "2026-03-28T12:00:00.000Z"
}
```

**Errors:**
- 400: Invalid type, missing memberIds, wrong member count for direct
- 200: Existing direct conversation returned (not 201)

---

### GET /conversations

List all conversations the authenticated user is a member of.

**Query parameters:** none

**Response (200):**
```json
{
    "conversations": [
        {
            "id": "1",
            "type": "direct",
            "name": null,
            "members": [
                { "userId": 10, "joinedAt": "2026-03-28T12:00:00.000Z" },
                { "userId": 42, "joinedAt": "2026-03-28T12:00:00.000Z" }
            ],
            "lastMessage": {
                "id": "150",
                "senderId": 42,
                "text": "Hey there!",
                "createdAt": "2026-03-28T14:30:00.000Z"
            },
            "updatedAt": "2026-03-28T14:30:00.000Z"
        }
    ]
}
```

**Notes:**
- Ordered by `updated_at DESC` (most recently active first)
- `lastMessage` is null if no messages in conversation
- `lastMessage` includes only basic fields (no attachments/reactions)

---

### GET /conversations/:id

Get a single conversation's details.

**Path parameters:**
- `id` (string) - Conversation ID

**Response (200):**
```json
{
    "id": "1",
    "type": "group",
    "name": "Family Chat",
    "createdBy": 10,
    "members": [
        { "userId": 10, "joinedAt": "2026-03-28T12:00:00.000Z" },
        { "userId": 42, "joinedAt": "2026-03-28T12:00:00.000Z" },
        { "userId": 55, "joinedAt": "2026-03-28T12:00:00.000Z" }
    ],
    "createdAt": "2026-03-28T12:00:00.000Z",
    "updatedAt": "2026-03-28T14:30:00.000Z"
}
```

**Errors:**
- 403: User is not a member of this conversation
- 404: Conversation not found

---

### POST /conversations/:id/messages

Send a message to a conversation.

**Path parameters:**
- `id` (string) - Conversation ID

**Request body:**
```json
{
    "text": "Hello everyone!",
    "referenceMessageId": "145",
    "attachmentIds": [10, 11]
}
```

**Validation:**
- At least one of `text` or `attachmentIds` must be present
- `text` (string, optional): Message text, max 10000 characters
- `referenceMessageId` (string, optional): ID of the message being replied to. Must belong to the same conversation.
- `attachmentIds` (array of ints, optional): IDs of previously uploaded attachments. Each must be owned by the sender (`sender_id` match) and not yet linked to any message (`message_id IS NULL`).
- Sender must be a member of the conversation

**Side effects:**
- Sets `message_id` on referenced attachment rows
- Inserts one `pending_events` row (type: `"message"`, message_id set) per conversation member (excluding sender)
- Updates `conversations.updated_at`
- Sends IPC PUBLISH for each recipient to wake their long-polls

**Response (201):**
```json
{
    "id": "151",
    "conversationId": "1",
    "senderId": 10,
    "text": "Hello everyone!",
    "referenceMessageId": "145",
    "attachments": [
        {
            "id": "10",
            "serverFilename": "a1b2c3d4-e5f6.jpg",
            "originalFilename": "photo.jpg",
            "mimeType": "image/jpeg",
            "size": 245000,
            "thumbnailFilename": "a1b2c3d4-e5f6.jpg.thumb.jpg"
        }
    ],
    "createdAt": "2026-03-28T14:35:00.000Z"
}
```

**Errors:**
- 400: No text or attachments, text too long, invalid referenceMessageId, attachment not owned by sender or already linked
- 403: User not a member
- 404: Conversation not found, referenced message not found

---

### GET /conversations/:id/messages

Get messages from a conversation with cursor-based pagination.

**Path parameters:**
- `id` (string) - Conversation ID

**Query parameters:**
- `after` (string, default "0"): Last message ID the client has. "0" means from the very beginning. Returns messages with `id > after`.
- `limit` (int, default 50, max 100): Number of messages to return.

**Response (200):**
```json
{
    "messages": [
        {
            "id": "145",
            "senderId": 42,
            "text": "How is everyone?",
            "referenceMessageId": null,
            "attachments": [],
            "reactions": [
                { "emoji": "thumbsup", "userIds": [10, 55] }
            ],
            "createdAt": "2026-03-28T14:00:00.000Z"
        },
        {
            "id": "151",
            "senderId": 10,
            "text": "Hello everyone!",
            "referenceMessageId": "145",
            "attachments": [
                {
                    "id": "10",
                    "originalFilename": "photo.jpg",
                    "mimeType": "image/jpeg",
                    "size": 245000,
                    "hasThumbnail": true
                }
            ],
            "reactions": [],
            "createdAt": "2026-03-28T14:35:00.000Z"
        }
    ]
}
```

**Notes:**
- Messages ordered by `id ASC` (chronological)
- Reactions grouped by emoji with list of userIds
- Attachments include `hasThumbnail` boolean (client uses attachment ID to fetch)
- Empty array if no messages match

**Errors:**
- 403: User not a member
- 404: Conversation not found

---

### POST /attachments/upload

Upload a file attachment. Uploaded before sending a message.

**Request:** `multipart/form-data`
- Field name: `file`
- Max file size: 50MB

**Thumbnail generation:**
- Images (jpeg, png, gif, webp): Use `sharp` to create 300px-wide thumbnail (JPEG, quality 80)
- Video (mp4, mov, webm, avi): Use `ffmpeg` (via `child_process.execFile`) to extract frame at 1 second, then resize with `sharp`
- Other files: No thumbnail

**Thumbnail naming:** `{serverFilename}.thumb.jpg`

**Response (201):**
```json
{
    "id": "10",
    "originalFilename": "photo.jpg",
    "mimeType": "image/jpeg",
    "size": 245000,
    "hasThumbnail": true
}
```

**Notes:**
- Attachment created with `message_id = NULL` and `sender_id = req.user.user_id`
- Must be linked to a message via POST /conversations/:id/messages within 24 hours
- Server filename is `crypto.randomUUID() + extension`

**Errors:**
- 400: No file provided, file too large
- 413: File exceeds size limit (multer)

---

### GET /attachments/:id

Download the original attachment file.

**Path parameters:**
- `id` (string) - Attachment ID

**Response:**
- Binary file stream
- `Content-Type`: attachment's mime_type
- `Content-Disposition: inline; filename="original_filename"`

**Auth check:** User must be a member of the conversation that contains this attachment's message. If the attachment has no message yet (orphaned), only the uploader can download it.

**Errors:**
- 403: User not authorized to access this attachment
- 404: Attachment not found, file not on disk

---

### GET /attachments/:id/thumbnail

Download the thumbnail for an attachment.

**Path parameters:**
- `id` (string) - Attachment ID

**Response:**
- Binary JPEG thumbnail
- `Content-Type: image/jpeg`

**Auth check:** Same as original attachment download.

**Errors:**
- 403: User not authorized
- 404: Attachment not found or no thumbnail exists

---

### POST /messages/:id/reactions

Add an emoji reaction to a message.

**Path parameters:**
- `id` (string) - Message ID

**Request body:**
```json
{
    "emoji": "thumbsup"
}
```

**Validation:**
- `emoji` required, string, max 32 characters
- User must be a member of the conversation containing this message
- Uses `INSERT ... ON DUPLICATE KEY UPDATE` (same user + same emoji on same message is idempotent)

**Side effects:**
- Inserts `pending_events` rows (type: `"reaction"`, reaction_id set) for other conversation members

**Response (201):**
```json
{
    "id": "50",
    "messageId": "145",
    "userId": 10,
    "emoji": "thumbsup",
    "createdAt": "2026-03-28T15:00:00.000Z"
}
```

**Errors:**
- 400: Missing emoji
- 403: User not a member of the conversation
- 404: Message not found

---

### DELETE /messages/:id/reactions

Remove an emoji reaction from a message.

**Path parameters:**
- `id` (string) - Message ID

**Request body:**
```json
{
    "emoji": "thumbsup"
}
```

**Validation:**
- `emoji` required
- Only the user who added the reaction can remove it

**Response (200):**
```json
{
    "success": true
}
```

**Errors:**
- 400: Missing emoji
- 404: Reaction not found (or not owned by user)

---

### POST /users/me/fcmtoken

Register an FCM push notification token for the authenticated user.

**Request body:**
```json
{
    "token": "fcm_device_token_string"
}
```

**Behavior:**
- Upserts by token (if token already exists, updates the user_id and timestamp)
- A user can have multiple tokens (multiple devices)

**Response (200):**
```json
{
    "success": true
}
```

**Errors:**
- 400: Token missing

---

### DELETE /users/me/fcmtoken

Unregister an FCM token (on logout).

**Request body:**
```json
{
    "token": "fcm_device_token_string"
}
```

**Response (200):**
```json
{
    "success": true
}
```

**Errors:**
- 400: Token missing

---

### POST /poll

Long-poll for new messages/events across ALL user's conversations.

**Request body:**
```json
{
    "after": "25"
}
```

**Parameters:**
- `after` (string, optional, default "0"): The last `pending_events.id` the client received. Server deletes all pending events for this user with `id <= after` (acknowledgment). "0" means first poll, nothing to acknowledge.

**Behavior:**
1. Delete acknowledged pending_events (where `user_id = req.user.user_id AND id <= after`)
2. Query remaining pending_events for this user (LIMIT 50), joined with appropriate tables based on event type
3. If events found: return immediately
4. If no events: hold the connection for up to 15 seconds
5. If a new event arrives during the wait (IPC WAKE): fetch from DB and return
6. If 15 seconds elapse: return empty response

**Response (200) - events available:**
```json
{
    "events": [
        {
            "pendingId": "26",
            "type": "message",
            "conversationId": "1",
            "message": {
                "id": "152",
                "senderId": 42,
                "text": "New message!",
                "referenceMessageId": null,
                "attachments": [],
                "reactions": [],
                "createdAt": "2026-03-28T15:05:00.000Z"
            }
        },
        {
            "pendingId": "27",
            "type": "reaction",
            "conversationId": "1",
            "reaction": {
                "id": "50",
                "messageId": "145",
                "userId": 42,
                "emoji": "thumbsup",
                "createdAt": "2026-03-28T15:06:00.000Z"
            }
        }
    ]
}
```

**Response (200) - timeout, no events:**
```json
{
    "events": []
}
```

**Notes:**
- `pendingId` is the `pending_events.id` - client tracks the highest one and sends it as `after` in next poll
- `type` tells the client which payload field to read (`message`, `reaction`, etc.)
- Client should immediately reconnect after receiving a response (whether events or empty)
- Only one active poll per user at a time. If a new poll arrives while one is pending, the old poll is cancelled (returns empty)
- Returns up to 50 pending events per response
- Extensible: new event types added in the future without breaking existing clients (unknown types can be ignored)

**Errors:**
- 401: Invalid/expired token

---

## Long-Polling Architecture

### Key difference from NavalClash
NavalClash polls are keyed by session ID (one opponent). LiteChat polls are keyed by user ID (messages from any conversation).

### Cluster Broker (master process) - `services/clusterBroker.js`
- IPC messages prefixed with `lc: true` to avoid collision with NavalClash
- Master state: `activePolls` Map (userId -> { requestId, workerId })
- IPC messages: SUBSCRIBE, UNSUBSCRIBE, PUBLISH, WAKE, CANCEL

### Message Service (worker process) - `services/messageService.js`
- `pendingPolls` Map (requestId -> { res, timer, userId, afterId, responded })
- On poll: ack old messages, check for new, if none -> SUBSCRIBE + 15s timer
- Race condition: re-query after SUBSCRIBE in case message arrived during setup
- On WAKE: fetch pending from DB, respond
- On timeout: respond empty, UNSUBSCRIBE

### Flow
1. Client sends POST /poll with `{ after: "25" }`
2. Worker deletes pending_events with id <= 25 for this user
3. Worker queries for new pending_events. If found, returns immediately with full message data
4. If none: stores poll in `pendingPolls`, sends IPC SUBSCRIBE { userId, requestId } to master
5. Re-queries DB (race condition guard). If message appeared, responds immediately + UNSUBSCRIBE
6. Meanwhile, when another user sends a message: worker inserts pending_events rows, sends IPC PUBLISH { userId } for each recipient
7. Master receives PUBLISH, finds userId in activePolls, sends WAKE { requestId } to correct worker
8. Worker receives WAKE, fetches pending_events from DB, responds to held HTTP request
9. If 15s timer fires first: responds with `{ messages: [] }`, sends UNSUBSCRIBE

## Push Notifications (FCM)

When a message is sent, the server notifies recipients via long-polling. After a 1.5s grace period, it checks if each recipient's pending_event is still in the database (meaning polling didn't pick it up). If so, it sends an FCM notification via Firebase Admin SDK.

- FCM is disabled if `LC_FCM_SERVICE_ACCOUNT_PATH` is not set
- Notifications are sent only for new messages, not reactions
- Invalid/expired FCM tokens are automatically cleaned up on send failure
- Each user can have multiple tokens (multiple devices)

## Attachment Handling

- **Upload**: multer saves to `storage/originals/` with `crypto.randomUUID() + ext` filename
- **Image thumbnails**: `sharp` - resize to 300px wide, JPEG quality 80, save to `storage/thumbnails/`
- **Video thumbnails**: `child_process.execFile('ffmpeg', ...)` to extract frame at 1s, then `sharp` to resize
- **Download**: verify user is conversation member, `res.sendFile()` with correct Content-Type
- **Storage paths**: `storage/originals/{uuid}.ext`, `storage/thumbnails/{uuid}.ext.thumb.jpg`

## Dependencies

```json
{
    "express": "^4.22.1",
    "mysql2": "^3.16.0",
    "multer": "^1.4.5-lts.1",
    "sharp": "^0.33.0",
    "firebase-admin": "^13.x"
}
```

ffmpeg is assumed to be installed on the system and invoked via `child_process.execFile`.

## AuthDB Migration

Add to `sql/007_authdb_chat_access.sql` (run against LinesBackend authdb):
```sql
ALTER TABLE users ADD COLUMN chat_access TINYINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN avatar VARCHAR(255) DEFAULT NULL;
```

## Setup

1. Add `../LiteChatBackend` to `MODULES_PATH` in LinesBackend `.env.development`
2. Create the `litechat` database and run SQL migrations in order (`sql/001` through `sql/006`)
3. Run `sql/007_authdb_chat_access.sql` against the LinesBackend authdb
4. Set `chat_access = 1` for users who should have chat access
5. `npm install` in this directory
6. Run `sql/008-fcm-tokens.sql` against the litechat database
7. (Optional) For push notifications: set `LC_FCM_SERVICE_ACCOUNT_PATH` to the Firebase service account JSON file path
8. Start LinesBackend - module loads at `/litechat/api/v1`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LC_DB_HOST` | `db_host` | MySQL host for litechat database |
| `LC_DB_NAME` | `litechat` | Database name |
| `LC_DB_USER` | `db_user` | Database user |
| `LC_DB_PASSWORD` | `db_password` | Database password |
| `LC_STORAGE_PATH` | `./storage` | Base path for file storage |
| `LC_FCM_SERVICE_ACCOUNT_PATH` | *(disabled)* | Path to Firebase service account JSON for push notifications |

Auth database connection uses LinesBackend's `db_auth_*` env vars.
