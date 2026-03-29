# LiteChat CLI

Interactive command-line tool for testing the LiteChat API.

## Requirements

- Node.js >= 22
- A running LinesBackend instance with the LiteChat module loaded
- Valid OAuth client credentials (from `authdb.client_tokens`)
- A user account with `chat_access = 1`

## Usage

```bash
node tools/chat-cli.js \
  --email user@example.com \
  --password mypass \
  --host https://localhost:3002 \
  --client-id myapp \
  --client-secret mysecret
```

All five arguments are required. The password is SHA256-hashed before being sent to the server.

## Commands

| Command | Description |
|---|---|
| `/users` | List all chat-enabled users |
| `/convos` | List your conversations |
| `/convo direct <userId>` | Create a direct conversation |
| `/convo group <id1,id2> <name>` | Create a group conversation |
| `/msg <convId>` | Show last 50 messages |
| `/msg <convId> after <msgId>` | Show messages after a cursor |
| `/send <convId> <text...>` | Send a text message |
| `/upload <filepath>` | Upload a file attachment |
| `/sendfile <convId> <filepath>` | Upload and send a file in one step |
| `/react <msgId> <emoji>` | Add a reaction to a message |
| `/help` | Show command list |
| `/quit` | Exit |

## Background polling

The tool automatically long-polls for new events (messages, reactions) and prints them above the prompt as they arrive. The auth token is refreshed every 15 minutes.

## TLS

Self-signed certificates are accepted (`NODE_TLS_REJECT_UNAUTHORIZED=0`) since this is a development tool.
