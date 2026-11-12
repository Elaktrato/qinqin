# MCP Foundation and Journal Plugin — Design

Date: 2026-11-12
Status: agreed direction (hybrid plugin extensibility); awaiting owner review.

## Intent

Let the learner's **own external AI client** work with qinqin data. The app hosts an
MCP server; the user connects their AI; the AI reads journals/study data and writes
feedback and suggestions back through MCP. The app never calls an LLM and stores no
provider keys. The Journal plugin is the first feature built on this foundation.

## Goals

- A core MCP server (HTTP, authenticated per user) exposing workspace-scoped tools
  over journals, dictionary entries, and study data.
- A declarative way for plugins to add named MCP tools/resources (hybrid model):
  manifests declare tools with JSON schemas mapped onto a fixed, safe operation set
  over their own plugin data. A compile-time Go backend module escape hatch stays
  possible later but is not built now.
- A Journal plugin: dated entries per workspace, inline AI feedback anchored to
  spans, correction-guidance settings, and topic suggestions — all authored by the
  external AI through MCP.
- Workspace/language correctness: every tool is workspace-scoped; the AI receives
  the workspace language and cannot read across workspaces.

## Non-goals

- In-app AI calls, API keys, prompt management, chat UI.
- Arbitrary backend code execution from plugins (future escape hatch only).
- Grammar lessons and cross-plugin statistics (separate issues #47/#48).
- Multi-user sharing of journals; mobile UI (phase 3 later, data model stays portable).

## Architecture

### MCP server (core, Go)

- Endpoint: streamable HTTP at `/mcp`, JSON-RPC, official MCP Go SDK
  (`github.com/modelcontextprotocol/go-sdk`; new dependency, noted in the plan).
- Auth: per-user **MCP tokens** (separate from login sessions), created/revoked in
  Settings; stored hashed (`mcp_tokens` table). A token authenticates exactly one
  user; requests carry no session cookie.
- Workspace context: tools take `workspaceId`; `workspaces.list` is the discovery
  tool. The server rejects ids not owned by the user (404) — the same
  existence-leak policy as the REST API.
- Tool guarantees: user-scoped reads; writes only into plugin data (never entries,
  events, decks or reviews); rate/volume limits; AI-originated writes are marked in
  the stored document metadata (`source: "mcp"`).

### Plugin-declared MCP tools (hybrid, data-driven now)

A plugin manifest may add an `mcp` section:

```json
"mcp": {
  "resources": [
    {"name": "journal.entries", "description": "The user's journal entries",
     "kind": "pluginData.list", "keyPrefix": "entry:"}
  ],
  "tools": [
    {"name": "journal.get_feedback",
     "description": "Feedback for one journal entry",
     "inputSchema": {"type": "object", "properties": {"workspaceId": {"type": "integer"}, "entryId": {"type": "string"}}, "required": ["workspaceId", "entryId"]},
     "operation": {"kind": "pluginData.get", "keyTemplate": "feedback:{{entryId}}"}},
    {"name": "journal.add_feedback",
     "description": "Attach corrections to a journal entry",
     "inputSchema": { "...": "..." },
     "operation": {"kind": "pluginData.put", "keyTemplate": "feedback:{{entryId}}", "valueFrom": "feedback"}}
  ]
}
```

Fixed operation set (v1): `pluginData.list` (prefix, optional filters), `pluginData.get`
(key template), `pluginData.put` (key template + value path from arguments),
`pluginData.delete` (soft delete). Core adds its own generic read tools:
`entries.search`, `entries.get`, `study.summary` (events aggregated by day/type),
`workspaces.list`. Future escape hatch: compile-time Go modules may register tools
beyond this vocabulary.

### Journal plugin (`qinqin-journal`)

- Data (workspace-scoped plugin data; `source:"mcp"` on AI writes):
  - `entry:<ulid>` — `{id, workspaceId, date, title, text, language, createdAt, updatedAt}`
  - `feedback:<entryId>` — `{entryId, annotations: [{quote, startHint?, endHint?, explanation, category, status}], overall?, updatedAt, source}`
  - `suggestions` — one document with a list of draft topics `{title, prompt, createdAt}`
  - `settings` — `{guidance}` (correction style/guidance the AI should follow)
- Anchoring: `quote` is authoritative; `startHint`/`endHint` are best-effort offsets.
  On journal edit, annotations whose quote is no longer found are marked `orphaned`
  (UI shows them in a separate list) rather than silently dropped.
- UI: journal list/editor; feedback rendered inline (quoted span underlined, explanation
  on hover/expanded); guidance settings; suggestions panel. No AI controls in the app —
  only display/edit what the AI wrote.
- MCP tools exposed by the manifest: `journal.list_entries`, `journal.get_entry`,
  `journal.add_feedback`, `journal.get_feedback`, `journal.add_suggestions`,
  `journal.get_settings` (plus core `entries.*`, `study.summary`, `workspaces.list`).

### Tokens and settings UI

Settings gains an "AI access" section: create/revoke MCP tokens (name, created, last
used), copyable endpoint URL and connection instructions (e.g. `claude mcp add`).
Tokens are shown once at creation.

## Constraints

- Go: module `qinqin`; the MCP SDK is the only new dependency; SQLite table added via
  migration `011_mcp.sql`.
- Web: no new dependencies beyond the existing whitelist; journal UI is a feature
  plugin registered like flashcards.
- Data: journals/feedback/suggestions live in plugin data; no schema coupling to core
  beyond the generic APIs.
- Tests: Go — token auth, workspace scoping, manifest tool parsing/validation, and
  operation execution against real SQLite; web — plugin manifest tools rendering,
  quote anchoring/reconciliation, feedback UI logic.

## Phasing (one plan)

1. Core: MCP tokens + migration + auth, MCP server with core tools, manifest `mcp`
   parsing/validation, operation executor, tests.
2. Journal plugin: manifest tools, storage helpers, list/editor/feedback/suggestions UI.
3. Settings UI for MCP tokens + connection instructions; docs (`docs/mcp.md`).

## Open questions (resolved during planning, defaults noted)

- Tool naming style (`journal.list_entries` vs `journal_list_entries`) — default dot.
- Feedback revisions: one feedback document per entry, replaced on new AI feedback;
  history is not required (default). Revisit if the owner wants revision history.
- Rate limits: fixed conservative defaults (e.g. 60 tool calls/min/token).
