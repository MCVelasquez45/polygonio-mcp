# Conversations Feature

Tracks user chat transcripts:
- `chat.routes.ts`: `/api/chat` endpoint that proxies to the agent and records message history.
- `conversations.routes.ts`: `/api/conversations` for listing/fetching saved sessions.
- `services/conversationStore.ts`: Mongo layer that stores transcripts + metadata.
