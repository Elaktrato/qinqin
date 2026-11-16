# v0.3.0 stretch — personal access tokens for scripts (#83)

Security-critical. A learner wants a script (a cron job that pushes study events, a reader export,
a quick `curl` lookup) to call the API without their password and without a 90-day web session
pasted into a file. Owner brief: hashed at rest, scoped, revocable, shown once, audited, rate
limited, never usable for account, admin or backup routes unless this spec says so and a review
agrees. This spec says so for none of them.

Builds on `2026-11-15-v030-accounts-users-sessions-design.md` (sessions, the access gate, the
route table) and `2026-11-15-v030-rate-limiting-design.md`.

## 1. What a token is

- **Format**: `qq_pat_` + 64 lowercase hex characters (32 bytes from `crypto/rand`, 256 bits),
  71 characters in all. The regex `qq_pat_[0-9a-f]{64}` is published in the wiki so secret
  scanners (and the owner's own `git grep`) find leaked tokens.
  Ruling: prefix + hex, no checksum suffix — hex never contains `_`/`-`, so the regex has clean
  word boundaries and a session token (64 hex, no prefix) can never look like one; a CRC suffix
  only helps scanners that the prefix already serves — cost if wrong: a scanner partner wants a
  checksum and the format gains a version (`qq_pat2_`).
- **At rest**: only `hex(sha256(token))`, unique index. The plaintext exists in the create
  response and nowhere else (not in logs, audit, list, backups, fixtures).
  Ruling: plain SHA-256, no salt, no argon2 — the input has 256 bits of entropy, so a slow hash
  buys nothing and would put argon2 on every script request — cost if wrong: none known.
- **Hint**: the first 6 hex characters after the prefix are stored (`hint`) so the list can show
  `qq_pat_3f9a1c…` next to the name (24 of 256 bits; the rest stays unguessable).
- **Constant time**: no secret is ever compared in Go. Lookup is `WHERE token_hash = ?` on the
  hash of the presented string, like sessions; timing of an index probe on a SHA-256 reveals
  nothing usable. A presented string that is not exactly `qq_pat_[0-9a-f]{64}` is refused before
  any query (same 401).
- **Shape check at the edge**: a bearer value that starts with `qq_pat_` is a token, anything else
  is a session token. The two never resolve through each other's lookup.

## 2. Scope

Each token has:

- **`scope`**: `read` or `write` (write includes read).
- **`workspaceId`**: `null` (all of the owner's workspaces) or one of the owner's workspaces.
- **`expiresAt`**: always set. Create takes `expiresInDays` 1–365; the UI offers 7, 30, 90
  (default) and 365.
  Ruling: no never-expiring tokens — a forgotten token in a dotfile is the main PAT risk; a year
  is long enough for a cron job and renewing is one dialog — cost if wrong: owners of long-running
  scripts renew yearly (the issue's "optional expiry" is read as "the user picks it").
- **No admin scope.**
  Ruling: v1 offers no admin scope at all; an administrator's token is an ordinary user token and
  every admin route refuses it — admin automation is rare (packs, backups and users are one-off
  admin acts done in the browser or with `qinqin` CLI on the host), and an admin token is the most
  valuable thing a leaked dotfile could hold. The issue's "explicit admin scope" condition is met
  by never granting it — cost if wrong: an admin who scripts pack installs keeps using the browser
  or a session token; adding `admin` later is a new scope value plus its own review.
- **Never more than the owner**: a token acts as its owner through the same handlers, ownership
  checks and 404-for-foreign rules as a session. It narrows, never widens.

## 3. Where a token works (fail closed)

Every `route{}` row gets a `token` field. Its zero value means **not usable with a token**; a
request carrying a `qq_pat_` bearer to such a route is answered `403 token_not_allowed` before
the handler runs and before the token is even looked up.

```go
type tokenRule struct {
    scope tokenScope // tokNone (zero) | tokRead | tokWrite
    ws    tokenWS    // wsNone (zero: refused for a workspace-limited token) | wsGlobal | wsQuery
}
```

- `tokRead` is declared on GET routes (Go's mux serves HEAD through them) and on POST routes in a
  short allowlist in the test whose handlers change nothing (`POST /api/segment`,
  `POST /api/entries/bases`). `tokWrite` on every other method.
- `ws`: `wsQuery` — the route confines itself to the `?workspace=<id>` parameter; a limited token
  must send it and it must equal the token's workspace, else `403 token_workspace`.
  `wsGlobal` — the route reads no per-workspace data (dictionaries, search, segmentation);
  only valid with `tokRead`. Zero — the route spans workspaces or addresses objects by id (sync,
  books by id, workspace list); a limited token gets `403 token_workspace`.
  Ruling: the workspace limit is enforced in the gate from the route row, not in handlers — one
  place to review, and an object-id route (`/books/{id}`) is simply out of reach for limited
  tokens instead of trusting each handler — cost if wrong: limited tokens can do less than they
  could (no sync, no book by id); widening means a handler-level check and its own test.
  Ruling: a workspace-limited token writes only on `wsQuery` routes and reads account-wide data
  that belongs to no workspace (the owner's dictionary edits shown in an entry) on `wsGlobal`
  routes — such data is not in any workspace to be limited — cost if wrong: a limited token
  reveals the owner's dictionary overlays.
- **Forbidden classes** (the test fails if any of these has a token rule): `/api/auth/**`
  (login, logout, me, reset, invites), `/api/account/**` (password, email, MFA, sessions, tokens
  themselves, export, restore, delete), `/api/admin/**`, every ticket route, `/api/ai/**` (keys,
  providers, active choice), AI-spending and photo routes (`/api/journal/**`), `PUT /api/me/time-zone`
  (account setting), `POST /api/library/sources/{source}/import` (server-side outbound fetch),
  `POST /api/audio/resolve`, every `accAdmin`, `accAdminSignedIn` and `accSession` route.
  Ruling: AI routes are excluded — a leaked token must not spend the owner's AI key or read its
  provider setup — cost if wrong: scripted journal review waits for a later scope.
  Ruling: `GET /api/auth/me` is session-only; a script checks its token with `GET /api/workspaces`
  — cost if wrong: one more route for script authors to learn.
- **The v1 set** (the plan's table is binding; the builder may drop a route after reading its
  handler, never add one without a spec amendment): dictionary and content reads (`/api/search`,
  `/api/lookup`, `/api/entries/{id}`, `/api/entries/{id}/chars`, `/api/segment/at`, languages,
  characters, components and component packs (amended at the #71 merge), dictionaries,
  frequency/sentence/audio packs, schemes, grammar) as `tokRead/wsGlobal`;
  `GET /api/workspaces`, `GET /api/sync/pull`, library books/chapters/bookmarks/highlights reads,
  audio entries and clips, `GET /api/plugins`, `GET /api/me/time-zone` as `tokRead`;
  `GET /api/events`, `GET /api/stats/activity`, `GET /api/library/books`, plugin data reads as
  `tokRead/wsQuery`; `POST /api/sync/push`, `POST /api/events/batch`, entry edits and sentences,
  library upload/position/bookmark/highlight writes, `DELETE /api/library/books/{id}`,
  `PUT /api/plugins/{id}/state` as `tokWrite`; plugin data `PUT`/`DELETE` as `tokWrite/wsQuery`.
  Workspace create/update/delete stay session-only.
  Ruling: deleting a workspace is not token-usable — it destroys a whole learning history in one
  call — cost if wrong: scripts cannot clean up workspaces.
- **Restricted users**: the token principal carries the same `Restriction()`; no token route
  allows a restriction, so a user with `must_change_password` gets `403 password_change_required`
  (in practice the token is already gone: forcing a change revokes tokens, §5). Disabled users
  never authenticate (lookup filters `disabled_at IS NULL`, and disabling deletes tokens).
- **Two-step sign-in**: a token is minted from a full session (which passed the second step when
  one is required) plus password re-entry; using it does not ask for a second factor, exactly like
  that session would not for 90 days.
  Ruling: tokens do not re-check MFA policy per request, and creation asks for the password but no
  one-time code — consistent with every other re-auth route (email change, delete account); the
  bounded expiry and revocation contain a leak — cost if wrong: an attacker holding a live session
  and the password can mint a token; that attacker already owns the account.

## 4. The gate

`handler()` wraps every route: `mux.HandleFunc(rt.pattern, s.tokenGate(rt))`. For a `qq_pat_`
bearer, in this order:

1. route has no rule → `403 token_not_allowed`;
2. `auth.AuthenticateToken` → unknown, malformed, expired, revoked or owner disabled → `401
   unauthorized` (one code, one body, one query: enumeration-safe);
3. owner restricted → its 403 restriction code;
4. read token on a `tokWrite` route → `403 token_read_only`;
5. workspace limit (§3) → `403 token_workspace`;
6. per-user token rate limit → `429 rate_limited` + `Retry-After`;
7. the principal goes into the request context and the handler runs; `s.authenticate(r)` returns
   it. A `qq_pat_` bearer without a gate principal in context resolves as anonymous (defence in
   depth), and `requireAdmin*` / `requireCustomAdmin` refuse any token principal with
   `403 token_not_allowed` even if a row were wrongly marked.

Static tests: only `tokenGate` calls `auth.AuthenticateToken`; `auth.Authenticate` (sessions)
never matches a token. Without a `qq_pat_` bearer the wrapper is a pass-through, so every session
behaviour is unchanged.

`Principal` gains `TokenID int64`, `TokenScope string`, `TokenWorkspace *int64` and `ViaToken()`;
`SessionID` is 0 for a token (no token route uses it).

## 5. Lifecycle and containment

- **Create** `POST /api/account/tokens {name, scope, workspaceId?, expiresInDays, currentPassword}`
  → `201 {token, accessToken: TokenInfo}`, `Cache-Control: no-store`. Full session only, password
  re-entry (wrong → `403 wrong_password`, counted in the existing `reauth` bucket). Name: 1–64
  runes after trimming, control characters dropped; duplicates allowed. A foreign or unknown
  workspace → `404 not_found`. At most 20 live (unexpired) tokens per user → `409 token_limit`.
  Bad name/scope/days → `422 invalid_token_request` (message names the field).
- **List** `GET /api/account/tokens` → `{accessTokens: [TokenInfo]}` newest first:
  `{id, name, hint, scope, workspaceId, createdAt, expiresAt, lastUsedAt|null, expired}`. Never the
  token or the hash.
- **Revoke** `DELETE /api/account/tokens/{id}` (204; foreign or unknown → 404 `not_found`) and
  `DELETE /api/account/tokens` (all; `{revoked: n}`). Revoke deletes the row; the audit keeps the
  record.
- **Expiry**: lookup condition `expires_at > now`; expired rows stay listed as expired for 30 days,
  then the janitor deletes them.
- **last_used_at**: written at most every 5 minutes per token (conditional UPDATE, as sessions).
  The first use (NULL → value) writes an audit row `token_first_used`.
- **Containment** — every action that revokes all of a user's sessions also deletes all of their
  tokens, in the same transaction: own password change (any variant, also without "sign out
  others"), forced change by an admin, reset link, `qinqin recover`, admin and CLI MFA reset,
  disable, admin "revoke sessions" for the user, admin "sign everyone out", the user's own "log out
  other devices"/"log out everywhere", account deletion (a `userTables` row), and deleting the
  workspace a token is limited to (tokens bound to it go with it; foreign keys are off, so the
  delete is explicit).
  Ruling: implemented by making the shared `revokeSessions` helper delete tokens too (renamed
  `revokeCredentials`), so no containment path can forget them, plus a table test over every path
  — cost if wrong: a password change silently breaks scripts; the dialog says so.
  Ruling: every password change revokes tokens, even with "sign out other devices" unticked — a
  password change is the documented "I may be compromised" step, and a stolen session could have
  minted a token — cost if wrong: routine password changes break scripts.
  Ruling: a personal restore does NOT revoke tokens (it revokes other sessions because they hold
  stale offline state; scripts do not) and is not a security action — cost if wrong: a script
  pushes old rows after a restore.
  Ruling (review fix): a restore gives the restored workspaces new ids, so in the same
  transaction a workspace-limited token follows its workspace through the archive's id map
  (archive id -> new id); a token limited to a workspace the archive does not hold (made after
  the export) is deleted, audited `token_revoked` {scope: restore, count} — cost if wrong: an
  archive from another server whose workspace ids happen to equal a token's workspace id binds
  that token to the archive's workspace of that id, still one of the owner's own.
  Ruling: existing response shapes (`{revoked: n}` of the session routes, admin routes) do not
  change; revoked token counts go into the audit detail as `tokens` — cost if wrong: the UI cannot
  say how many tokens went, only that they did.
- **Backup**: `access_tokens` is never exported (`ExportSkip`, security) and kept on restore; the
  deletion preview counts it (`accessTokens`). A server backup contains only hashes.

## 6. Audit, logging, rate limits

- Audit actions: `token_created` {tokenId, scope, days, limited}, `token_revoked`
  {scope: one|all, count}, `token_first_used` {tokenId}; containment rows gain `tokens`. New audit
  keys `tokenId`, `days`, `limited`, `tokens` (the allowlist stays closed). Never the name (user
  text), never the hint.
  Ruling: no per-request use audit and no IP history — qinqin stores no client IPs anywhere, and
  per-request rows would bury the log; `lastUsedAt` and first use carry the signal — cost if
  wrong: an owner cannot see from where a token was used.
- Logging: the token never reaches a log line; gate refusals log nothing; a test captures the
  server log during the token test suite and asserts no `qq_pat_` substring.
- Rate limits (named buckets, keyed by user id, shared by all of a user's tokens): `pat` burst 120,
  one more per 500 ms (sustained 120/min); `pat-create` burst 10, one per 6 minutes. Session
  traffic stays unthrottled as today.
  Ruling: per user, not per token — minting more tokens must not buy more throughput — cost if
  wrong: two scripts of one user share a budget.
  Ruling: no throttle on unknown tokens — 256-bit secrets are not guessable, and sessions have no
  such throttle either — cost if wrong: noise requests cost one indexed query each.

## 7. Errors (added to `docs/contracts/auth/errors.json`)

| Code | Status | Meaning |
|---|---|---|
| `token_not_allowed` | 403 | Access tokens cannot be used on this route (account, admin, backup, AI…). |
| `token_read_only` | 403 | The token is read-only and the route writes. |
| `token_workspace` | 403 | The token is limited to one workspace and the request is not inside it. |
| `token_limit` | 409 | 20 live access tokens already; revoke one first. |
| `invalid_token_request` | 422 | Name, scope or expiry out of range (message names the field). |

`unauthorized`'s meaning gains "or the access token is unknown, expired or revoked".

## 8. Web UI (Settings → Account → Access tokens)

- Section below Sessions: a short explanation, the list (name, `qq_pat_3f9a1c…`, scope badge
  "Read only"/"Read and write", workspace name or "All workspaces", "Expires in 12 days"/"Expired",
  "Last used 5 minutes ago"/"Never used"), Revoke per row (confirm), "Revoke all" (confirm).
- "New token" dialog: name, scope radio (read default), workspace select (All default), expiry
  select (90 days default), current password. On success the dialog switches to a one-time view:
  the token in a read-only monospaced field, Copy button (clipboard; "Copied" text, not colour),
  "You will not see this token again", a `curl` example with the token, and Done. Closing drops the
  token from memory; it is never put in `localStorage`, the outbox or the service worker cache.
- Password change, "Log out other devices" and "Log out everywhere" confirmations say "Your access
  tokens are revoked too" when the user has any.
- Logic in pure `tokensView.ts` (rows, expiry text, form validation, the example command);
  components stay thin. The new `/api/account/tokens*` routes are `bypass` in the service worker.

## 9. Documentation

New wiki page `API-Access-tokens.md` (#80 API reference): what a token can and cannot do, format
and the scanner regex, scopes and workspace limit, the route table (generated from the route rows:
`docs/contracts/auth/tokens-routes.json` rendered by `scripts/gen-api-docs.mjs` into
`API-Routes.md` as a "Token" column), error codes, curl examples (list workspaces, look up a word,
pull, push events, read plugin data of one workspace, what a 403 looks like), revocation and
containment, "treat it like a password". Links from API overview, Accounts and sign-in, Settings
tour and the sidebar; README API section.

## 10. Contracts

`docs/contracts/auth/tokens.json` (create, list, revoke, revoke-all and every refusal of §4/§7
with real bodies, placeholder `<token>`), `tokens-format.json` (valid and invalid strings, hint
derivation, hash of a fixed test string), `tokens-routes.json` (generated: pattern, scope, ws of
every token-usable route). Go: `contract_auth_test.go` compares bodies; web: `tokensView.test.ts`
decodes `tokens.json` and `tokens-format.json`.

## 11. Not in v1

Admin scope; per-route or per-plugin scopes; token-usable workspace management, AI or journal;
IP allowlists; mail notification on token creation (audit only); OAuth-style flows; an Android
UI (the contract is ready for one).
  Ruling: no "a token was created" mail — it needs a template, mail outage handling and a setting,
  and the audit plus the list carry the signal — cost if wrong: a silent malicious mint is noticed
  only when the user looks at the list.
