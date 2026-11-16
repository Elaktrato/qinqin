# Personal Access Tokens (issue #83) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task or per few tasks, independent SECURITY review on the strongest model, one fix wave, mutation
> checks). Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it fail,
> implement, see it pass.

**Goal:** Personal access tokens (`qq_pat_…`) that scripts send as `Authorization: Bearer`, hashed at rest,
read or read/write, optionally limited to one workspace, always expiring, shown once, listed with last use,
revocable one by one or all, revoked by every containment action, audited, rate limited, and refused (fail
closed) on every route whose row does not declare token use — never account, auth, admin, backup, AI.

**Architecture:** `server/internal/auth/tokens.go` (mint, hash, create, list, revoke, `AuthenticateToken`);
one migration; `revokeSessions` becomes `revokeCredentials` (sessions + tokens); every `route{}` row gains a
`token tokenRule` field whose zero value refuses tokens; `handler()` wraps each route in `tokenGate`, the only
caller of `AuthenticateToken`, which puts the principal in the request context for `s.authenticate`. Web: pure
`tokensView.ts`, thin `AccessTokens.svelte` + `CreateTokenDialog.svelte` in Settings → Account.

**Tech stack:** Go 1.26 stdlib, SQLite, SvelteKit 2 / Svelte 5, vitest (unit + jsdom). No new dependencies.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-16-v030s-access-tokens-design.md`.
Base: `2026-11-15-v030-accounts-users-sessions-design.md`, `2026-11-15-v030-rate-limiting-design.md`.

**Branch / worktree:** `feature/v030s-access-tokens`, worktree `/home/user/qinqin/.claude/worktrees/access-tokens`
(`<wt>`). Rebase-free: if the collection branch moved (e.g. #71 added a migration), merge it in before Task 2.

**Migration number:** the NEXT FREE number at build time (`ls server/internal/db/migrations | tail -1` + 1).
On this branch today that is `036`; #71 or another item may take it first. **Taken at build time: `037_access_tokens.sql`** (#71 radicals, built in parallel, holds `036_components.sql`; the runner applies a missing version by name, so the gap on this branch is harmless). Never reuse or renumber a merged
migration; if a collision appears at merge, renumber only this branch's unmerged file and re-run the db tests.

## Gates

- Go (always under the lock, proxies unset, targeted packages per task):
  `cd <wt>/server && flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./internal/auth ./internal/api ./internal/db ./internal/backup && go test -count=1 -p 2 -timeout 30m ./internal/auth ./internal/api ./internal/db ./internal/backup'`
  `gofmt -l` prints nothing. ONE full `./...` run before the branch's last commit (known env failure:
  `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` only). `-race` on `internal/auth` once (the
  last-used throttle and first-use audit run under concurrent requests); never on all of `api`.
- Web: `npm --prefix <wt>/apps/web ci` once; per web task `run check`, `test`, `run build` (read exit codes);
  targeted `cd apps/web && npx vitest run <paths>`. Before the last commit the full vitest once with Node 26:
  `cd apps/web && PATH=/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH npx vitest run`.
- `node scripts/gen-api-docs.mjs --check` exits 0 from Task 9 on.
- One commit per task, explicit `git add <files>`, message ends with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, never merge. `git status` clean.

## Global constraints

- Token string `qq_pat_` + 64 lowercase hex; regex `^qq_pat_[0-9a-f]{64}$`; stored `hex(sha256(full string))`;
  `hint` = the 6 hex characters after the prefix. Session tokens are untouched.
- No plaintext token in logs, audit, list responses, errors, fixtures (placeholder `<token>`), test names or
  commit messages. Tests that need a real token mint it at run time.
- Scope `read` | `write`; `workspace_id` NULL or the owner's; `expiresInDays` integer 1–365; 20 live tokens.
- Route rule zero value = refused. Only `tokenGate` calls `auth.AuthenticateToken`.
- New error codes exactly as spec §7, added to `docs/contracts/auth/errors.json` (API-Errors.md regenerated).
- Buckets `pat` {Burst 120, Every 500ms} and `pat-create` {Burst 10, Every 6m}, keyed `user:<id>`.

## Review Focus (security review on the strongest model; must-fix findings block)

1. **Fail-closed eligibility.** A route without a rule refuses a token before lookup; the route walk drives
   every route with token actors; the forbidden-class test (Task 7) has no escape hatch except the documented
   read-POST allowlist.
2. **No widening.** A token principal reaches only the owner's data through unchanged handlers; admin helpers
   refuse token principals even if a row were wrong; an admin's token cannot reach any admin route.
3. **Containment completeness.** Every path in Task 5's table deletes tokens in the same transaction; a static
   test fails on any `DELETE FROM sessions WHERE user_id` outside `revokeCredentials`, the `userTables`
   row and the documented restore exception.
4. **Workspace limit.** `wsQuery` routes truly confine to the parameter (per-route two-workspace tests);
   object-id and spanning routes refuse limited tokens; limited tokens never write outside `wsQuery`.
5. **Secrets.** Shown once (create response only, `no-store`), hash-only storage (read the DB file in a test),
   no token in any captured log, enumeration-safe 401, 404 for foreign ids.
6. **Order of gate checks** and that sessions behave exactly as before (existing route walk unchanged).

## Security test matrix

Each cell names the test (Task) that proves it. "W" = write token, "R" = read token, "L" = write token limited
to workspace A of user 1, "S" = full session. User 2 owns workspace B.

| # | Case | Expected | Task |
|---|---|---|---|
| 1 | Stored row after create | hash = sha256(token), no plaintext anywhere in the DB file | 3 |
| 2 | List / create responses | list never has `token`; create has it once; `Cache-Control: no-store` | 9 |
| 3 | Malformed `qq_pat_x`, unknown valid-shaped, expired, revoked, owner disabled | 401 `unauthorized`, identical body | 4, 6 |
| 4 | Any route without a rule (every one, walked) | W → 403 `token_not_allowed` | 6, 7 |
| 5 | Admin's W on every `/api/admin/**` and AI custom route | 403 `token_not_allowed` (also with a wrongly marked row: helper test) | 6 |
| 6 | R on every `tokWrite` route | 403 `token_read_only` | 6, 7 |
| 7 | R on every `tokRead` route | through (no gate code) | 6, 7 |
| 8 | L on `wsQuery` route with `?workspace=A` | through, only A's rows in the body | 7 |
| 9 | L with `?workspace=` other own workspace, missing, or B | 403 `token_workspace` | 7 |
| 10 | L on zero-ws routes (sync, workspaces, books/{id}) | 403 `token_workspace` | 6, 7 |
| 11 | W of user 1 on user 2's book id / plugin data / events | 404 as for a session (no leak) | 7 |
| 12 | User 2 `DELETE /api/account/tokens/{id of user 1}` | 404 `not_found`; token still works | 9 |
| 13 | Each containment action (Task 5 table) | all tokens of that user gone; other users' tokens untouched | 5 |
| 14 | Personal restore | tokens kept (documented exception) | 5 |
| 15 | Delete workspace A | L gone, other tokens stay | 5 |
| 16 | Forced password change flag (no revoke path) on a token owner | 403 `password_change_required` | 4 |
| 17 | Token on `/api/account/tokens*` (create a token with a token) | 403 `token_not_allowed` | 6 |
| 18 | `pat` bucket exhausted | 429 `rate_limited` + `Retry-After`; sessions of that user unaffected | 8 |
| 19 | Wrong password on create ×6 | 403 `wrong_password` then 429 (`reauth`) | 9 |
| 20 | 21st live token | 409 `token_limit`; an expired one does not count | 3, 9 |
| 21 | `last_used_at` written at most every 5 min; first use audited once under 20 parallel requests | | 4 |
| 22 | Server log during the whole token test suite | no `qq_pat_` substring | 9 |
| 23 | `PAT` bearer with no gate principal (direct handler call) | anonymous | 6 |
| 24 | Session token and PAT cross-lookup | a session token never resolves as PAT, nor the reverse | 4 |

---

### Task 1: Contract fixtures and error codes

**Files:** Create `docs/contracts/auth/tokens.json`, `docs/contracts/auth/tokens-format.json`;
modify `docs/contracts/auth/errors.json`, `docs/contracts/auth/README.md` (file table + a "Personal access
tokens" section), `docs/contracts/overview.md` (auth summary bullet), `docs/contracts/README.md` (auth row lists
the new files); `apps/web/src/lib/account/tokensFormat.ts`, `tokensFormat.test.ts`.

- [ ] **Step 1:** Write `tokensFormat.test.ts` decoding `tokens-format.json` (`valid`, `invalid` arrays,
  `hint` cases, `sha256` of the fixed string `qq_pat_` + 64 `0`s — a well-known test value, never a real
  token) and `tokens.json` (every case has `request`, `status`, `body`; every `error` code exists in
  `errors.json` with the same status). Run: fails (no module, no fixtures).
- [ ] **Step 2:** Write the fixtures (cases: `create`, `create_limited`, `list`, `revoke_one`, `revoke_all`,
  `not_allowed`, `read_only`, `workspace`, `limit`, `invalid_name`, `invalid_days`, `wrong_password`,
  `unauthorized_expired`, `foreign_revoke`); add the five codes and the `unauthorized` wording to `errors.json`;
  `tokensFormat.ts`: `TOKEN_RE`, `isTokenShaped(s)`, `tokenHint(s)`. Run: passes. `node scripts/gen-api-docs.mjs`
  (API-Errors.md changes). Commit `docs(contracts): personal access token fixtures and error codes`.

### Task 2: Migration `NNN_access_tokens.sql`

**Files:** Create `server/internal/db/migrations/NNN_access_tokens.sql` (next free number); test in
`server/internal/db/db_test.go` (or the file holding the schema tests).

```sql
CREATE TABLE access_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    hint TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('read','write')),
    workspace_id INTEGER REFERENCES workspaces(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_used_at TEXT
);
CREATE INDEX idx_access_tokens_user ON access_tokens (user_id);
CREATE INDEX idx_access_tokens_workspace ON access_tokens (workspace_id);
```

- [ ] Test first: table exists, CHECK refuses `scope='admin'`, UNIQUE on `token_hash`; schema holds with
  `PRAGMA foreign_keys = ON` (existing FK test). Fail → add → pass. Commit `feat(db): access tokens table`.

### Task 3: `auth/tokens.go` — mint, create, list, revoke

**Files:** Create `server/internal/auth/tokens.go`, `tokens_test.go`; modify `audit.go` (keys `tokenId`, `days`,
`limited`, `tokens`).

```go
const TokenPrefix = "qq_pat_"
const MaxTokens = 20
const TokenExpiredKeep = 30 * 24 * time.Hour
var ErrTokenLimit, ErrTokenRequest, ErrTokenNotFound, ErrWorkspaceNotFound error
type TokenRequest struct { Name, Scope string; WorkspaceID *int64; ExpiresInDays int }
type TokenInfo struct {
    ID int64 `json:"id"`; Name string `json:"name"`; Hint string `json:"hint"`; Scope string `json:"scope"`
    WorkspaceID *int64 `json:"workspaceId"`; CreatedAt string `json:"createdAt"`; ExpiresAt string `json:"expiresAt"`
    LastUsedAt *string `json:"lastUsedAt"`; Expired bool `json:"expired"`
}
func IsTokenShaped(s string) bool
func CreateToken(ctx context.Context, db *sql.DB, userID int64, req TokenRequest) (token string, info TokenInfo, err error) // audits token_created in the tx
func ListTokens(ctx context.Context, db *sql.DB, userID int64) ([]TokenInfo, error)
func RevokeToken(ctx context.Context, db *sql.DB, userID, tokenID int64) error        // ErrTokenNotFound for foreign/unknown; audits
func RevokeAllTokens(ctx context.Context, db *sql.DB, userID int64) (int64, error)     // audits scope all
```

- [ ] Tests first: format and entropy (1000 mints distinct, all shaped); hint; **stored row holds only
  sha256 and hint — read the whole DB file bytes and assert the plaintext is absent**; name trimming, control
  characters, 0 and 65 runes refused; scope and days 0/366 refused (`ErrTokenRequest` with field); foreign
  workspace → `ErrWorkspaceNotFound`; 21st live → `ErrTokenLimit`, an expired token does not count; list order,
  `expired` flag, no secret field (marshal and grep); revoke foreign → not found and the row survives; audit
  rows and their detail keys (never the name). Fail → implement → pass.
  Commit `feat(auth): create, list and revoke personal access tokens`.

### Task 4: `auth.AuthenticateToken`

**Files:** `server/internal/auth/tokens.go`, `tokens_test.go`, `principal.go`.

```go
// Principal additions
TokenID int64; TokenScope string; TokenWorkspace *int64
func (p *Principal) ViaToken() bool
func AuthenticateToken(ctx context.Context, db *sql.DB, raw string) (*Principal, error) // nil,nil = refuse (401)
func TokenFromRequest(r *http.Request) (raw string, ok bool) // ok: bearer starts with TokenPrefix
```

- [ ] Tests first: malformed / unknown / expired (clock) / revoked / disabled owner → nil; valid → principal
  with user fields like `Authenticate`, `Level` full, `SessionID` 0; `must_change_password` set directly →
  `Restriction()` = `password_change`; session token passed to `AuthenticateToken` → nil and a PAT passed to
  `Authenticate` → nil (matrix 24); `last_used_at` throttled to 5 min; first use writes one `token_first_used`
  under 20 concurrent calls (`-race` once). Fail → implement → pass. Commit `feat(auth): authenticate access tokens`.

### Task 5: Containment — `revokeCredentials`

**Files:** `server/internal/auth/session.go` (rename `revokeSessions` → `revokeCredentials`: deletes sessions
except `keep` AND all tokens of the user, returns both counts), its callers `password.go`, `resets.go`,
`recover.go`, `users.go`, `mfa.go`, `RevokeOthersAudited`, `RevokeAllExcept` (also `DELETE FROM access_tokens`);
audit details gain `tokens`; `delete.go` (`userTables` row `access_tokens`, `PreviewKey: "accessTokens"`,
`ExportSkip`/`skipSecurity`, `RestoreKeep`); `janitor.go` (prune tokens expired longer than
`TokenExpiredKeep`); workspace deletion (`server/internal/api/handlers_workspaces.go` or the store it calls:
delete tokens with that `workspace_id` in the same transaction); tests `server/internal/auth/containment_tokens_test.go`,
`server/internal/api/` workspace delete test, a static test in `auth`.

| Path | Function |
|---|---|
| own password change, with and without signOutOthers | `ChangePassword` |
| forced change by admin / temporary password | `forceChangeTx` |
| reset link used | `resets.go` spend |
| `qinqin recover` (with/without `--reset-mfa`) | `recover.go` |
| admin / CLI MFA reset | `ResetMFA` |
| disable user | `users.go` set disabled |
| admin revoke sessions of a user | `users.go` revoke |
| admin sign everyone out | `RevokeAllExcept` (all users' tokens) |
| own "log out others" / "log out everywhere" | `RevokeOthersAudited` |
| account deletion (own and admin) | `userTables` |
| workspace deletion | workspace store |
| personal restore | `backup/restore.go` — tokens KEPT |

- [ ] Tests first: table test, two users each with tokens; run each path for user 1; assert user 1 has 0
  tokens and user 2 keeps theirs (restore: kept; workspace: only bound tokens). Static test: no
  `DELETE FROM sessions WHERE user_id` in `server/internal/**` outside `revokeCredentials`,
  `backup/restore.go` (documented exception) and the `userTables` row in `auth/delete.go`. `delete_test` table-coverage tests updated. Janitor test. Fail → implement → pass.
  Commit `feat(auth): every containment action revokes access tokens`.

### Task 6: Route rule, `tokenGate`, route walk

**Files:** `server/internal/api/api.go` (`route.token tokenRule`, `handler()` wraps), new
`server/internal/api/tokengate.go`, `handlers_auth.go` (`s.authenticate` reads the context principal; a PAT
bearer without one is anonymous; `requireAdminPrincipal` refuses `ViaToken()`), `handlers_ai_custom.go`
(`requireCustomAdmin` the same), `gate_test.go` (token actors), `gate_static_test.go` (only `tokengate.go`
calls `auth.AuthenticateToken`), new `tokengate_test.go`.

```go
type tokenScope int; const (tokNone tokenScope = iota; tokRead; tokWrite)
type tokenWS int;    const (wsNone tokenWS = iota; wsGlobal; wsQuery)
type tokenRule struct { scope tokenScope; ws tokenWS }
func (s *server) tokenGate(rt route) http.HandlerFunc
```

Rows keep positional form for the existing four fields; add the rule as a fifth field (`tokenRule{}` omitted
via a keyed helper is fine — pick one form and use it everywhere). In this task NO route gets a rule yet.

- [ ] Tests first: gate order (spec §4) on a stub route table; route walk: actors `patW`, `patR`, `patL`,
  `patExpired`, `adminPatW`; with no rules every route answers `patW` 403 `token_not_allowed`, also public
  ones; session actors unchanged; `requireAdminPrincipal` with a token principal in context → 403
  `token_not_allowed` (matrix 5, wrongly-marked row); direct handler call with a PAT bearer and no context →
  anonymous (matrix 23). Fail → implement → pass. Commit `feat(api): fail-closed access token gate`.

### Task 7: The v1 token route set

**Files:** `server/internal/api/api.go` (rules), `tokengate_test.go` (consistency + per-route), new
`server/internal/api/tokens_routes_fixture_test.go` writing `docs/contracts/auth/tokens-routes.json`
(`UPDATE_TOKEN_ROUTES_FIXTURE=1`), `docs/contracts/auth/tokens-routes.json`.

Binding table (drop a row only after reading its handler and recording why; never add one):

| Rule | Routes |
|---|---|
| tokRead / wsGlobal | `GET /api/search`, `/api/lookup`, `/api/entries/{id}`, `/api/entries/{id}/chars`, `/api/segment/at`, `/api/languages`, `/api/characters`, `/api/dictionaries`, `/api/frequency-packs`, `/api/sentence-packs`, `/api/audio-packs`, `/api/audio-packs/{id}/credits`, `/api/schemes`, `/api/schemes/{id}/entries`, `/api/schemes/{id}/characters`, `/api/grammar`, `/api/grammar/{pack}/{lesson}`; `POST /api/segment`, `POST /api/entries/bases` (read-POST allowlist) |
| tokRead / zero | `GET /api/workspaces`, `/api/sync/pull`, `/api/me/time-zone`, `/api/plugins`, `/api/library/books/{id}`, `/api/library/books/{id}/chapters/{n}`, `/api/library/books/{id}/bookmarks`, `/api/library/books/{id}/highlights`, `/api/audio/entries/{id}`, `/api/audio/clips/{file}` |
| tokRead / wsQuery | `GET /api/events`, `/api/stats/activity`, `/api/library/books`, `/api/plugins/{id}/data`, `/api/plugins/{id}/data/{key}` |
| tokWrite / zero | `POST /api/sync/push`, `POST /api/events/batch`, `PUT /api/entries/{id}`, `POST /api/entries/{id}/sentences`, `POST /api/library/upload`, `PUT /api/library/books/{id}/position`, `DELETE /api/library/books/{id}`, bookmark and highlight `POST`/`PUT`/`DELETE`, `PUT /api/plugins/{id}/state` |
| tokWrite / wsQuery | `PUT /api/plugins/{id}/data/{key}`, `DELETE /api/plugins/{id}/data/{key}` |

**Re-check after merging the collection branch (#67, #75), at build time.** The merge added two routes; each got a
deliberate decision, and every other route outside the table above stays session-only (no rule):

- `POST /api/entries/frequency-ranks` (#75, `accUser`): **no token rule.** Ruling: session-only — the handler reads
  shared data only (read-only POST), but the spec's v1 set is binding and adding a route needs a spec amendment; a
  script gets ranks from `GET /api/frequency-packs` + lookups — cost if wrong: one more row and a spec line later.
- `GET /api/frequency-packs/{id}/top` (#75, `accUser`): **no token rule.** Ruling: session-only — the first call per
  pack resolves a whole starter deck (expensive), which is why the route needs sign-in at all; a token's 120/min
  budget would let a script keep it busy — cost if wrong: scripts cannot fetch starter decks.
- Also deliberately session-only although they read only: `GET /api/library/sources` and its `search`/`browse`
  (outbound fetches to remote libraries on the server's behalf), `GET /api/ai/*` and `GET /api/journal/*` (spec §3),
  `GET /healthz` (public, but a token on it is still `403 token_not_allowed`: every route without a rule refuses).
- **Amendment at the second merge (#71 radicals, #77 notes):** `GET /api/components` and `GET /api/component-packs`
  (#71, `accPublic`) are **`tokRead / wsGlobal`**, added to the pinned set and to spec §3. Ruling: both are public
  reads of shared pack data (the handlers read no user or workspace data), exactly like `GET /api/characters` and
  `GET /api/frequency-packs`; anyone may call them without a token, so accepting one exposes nothing, while refusing
  it would make a script drop its header for two routes — cost if wrong: none known. #77 added no server route.
- No route was dropped from the table after reading its handlers. Noted: `GET /api/stats/activity` with a limited
  token also returns the account's current `timeZone` (account-wide, like the wsGlobal overlays ruling).

- [ ] Tests first: consistency — forbidden prefixes/classes (spec §3) have no rule; `tokRead` only on GET or
  the read-POST allowlist; `tokWrite` never on GET; `wsGlobal` only with `tokRead`; no rule on
  `accAdmin`/`accAdminSignedIn`/`accSession`; route walk with rules: `patR` through on reads and 403
  `token_read_only` on writes, `patW` through on all, `patL` 403 `token_workspace` on zero-ws rows, through on
  `wsGlobal`, on `wsQuery` with `?workspace=A` through and with B / other / missing 403. Per `wsQuery` route a
  two-workspace data test (only A's rows). Cross-user (matrix 11) for sync pull, events, a book, plugin data.
  `tokens-routes.json` fixture test. Fail → declare → pass. Commit `feat(api): routes usable with access tokens`.

### Task 8: Token rate limits

**Files:** `server/internal/api/authlimit.go` (`pat`, `pat-create`), `tokengate.go`, `tokengate_test.go`.

- [ ] Tests first (with `WithAuthPolicy` small numbers): the bucket keyed per user is shared by two tokens of
  the same user, separate for another user; 429 `rate_limited` with whole-second `Retry-After`; session requests
  of the same user never consume it. Fail → implement → pass. Commit `feat(api): rate limit access token requests`.

### Task 9: Token management routes

**Files:** new `server/internal/api/handlers_tokens.go`, `handlers_tokens_test.go`; `api.go` rows
(`GET /api/account/tokens`, `POST /api/account/tokens`, `DELETE /api/account/tokens`,
`DELETE /api/account/tokens/{id}`, all `accUser`, no token rule); `contract_auth_test.go` (compare
`tokens.json`); routes fixture (`UPDATE_ROUTES_FIXTURE=1`, all four `bypass` in
`apps/web/src/lib/pwa/sw/classify.ts` — default, check the classify test); `docs/wiki/API-Routes.md` via
`node scripts/gen-api-docs.mjs`.

- [ ] Tests first: 401 anonymous, 403 restricted, 403 `token_not_allowed` with a token (matrix 17);
  create → 201, body has `token` once, `Cache-Control: no-store`, `wrong_password`/`reauth` bucket (matrix 19),
  `pat-create` bucket, `token_limit`, `invalid_token_request` field messages, foreign workspace 404; list
  without secrets; revoke one/all, two-user isolation (matrix 12); contract bodies equal `tokens.json`; capture
  the server log (`log.SetOutput` to a buffer for the package's token tests) and assert no `qq_pat_` (matrix
  22). Fail → implement → pass. Commit `feat(api): create, list and revoke access tokens`.

### Task 10: Web — API client and `tokensView.ts`

**Files:** new `apps/web/src/lib/api/tokens.ts`, `apps/web/src/lib/account/tokensView.ts`, `tokensView.test.ts`.

```ts
export interface TokenDto { id: number; name: string; hint: string; scope: 'read' | 'write'; workspaceId: number | null; createdAt: string; expiresAt: string; lastUsedAt: string | null; expired: boolean }
export const EXPIRY_CHOICES = [7, 30, 90, 365] as const; export const DEFAULT_EXPIRY = 90;
export interface TokenRow { id: number; name: string; masked: string; scopeLabel: string; workspaceLabel: string; expiryText: string; lastUsedText: string; expired: boolean }
export function tokenRows(list: TokenDto[], workspaces: { id: number; name: string }[], now: Date, tz?: string): TokenRow[]
export function validateTokenForm(f: { name: string; scope: string; days: number; password: string }): { ok: true } | { ok: false; field: string; message: string }
export function exampleCommand(origin: string, token: string): string // curl -H "Authorization: Bearer …" <origin>/api/workspaces
export function containmentNote(tokenCount: number): string | null // "Your access tokens are revoked too."
```

- [ ] Tests first (decode `tokens.json` list case, reuse `relativeTime`): masked `qq_pat_3f9a1c…`, "Read only"
  / "Read and write", "All workspaces" / name / "Deleted workspace", "Expires in 12 days" / "Expired",
  "Never used", form errors, the example command. Fail → implement → pass.
  Commit `feat(web): access token view logic`.

### Task 11: Web — Settings UI

**Files:** new `apps/web/src/lib/settings/AccessTokens.svelte`, `CreateTokenDialog.svelte`,
`AccessTokens.dom.test.ts`; modify `AccountSettings.svelte` (section under Sessions; password change and
log-out-others/everywhere confirmations show `containmentNote`), `AccountSettings.dom.test.ts`.

- [ ] DOM tests first: list renders rows; create posts the form and then shows the token exactly once with
  Copy (mock `navigator.clipboard`; text "Copied"), the warning and the example; Done/close clears it (re-open
  shows the empty form; the token string is not in the DOM nor in `localStorage`); 422/403/409 messages shown
  in the dialog; revoke and revoke-all confirm then refresh; the containment note appears when tokens exist.
  Fail → implement → pass. Commit `feat(web): access tokens in Settings`.

### Task 12: Documentation

**Files:** new `docs/wiki/API-Access-tokens.md`; modify `scripts/gen-api-docs.mjs` (reads
`docs/contracts/auth/tokens-routes.json`, adds a "Token" column: `read`, `read (workspace)`, `write`,
`write (workspace)`, `—`), its test if one exists, `docs/wiki/API-Routes.md` (regenerated),
`docs/wiki/API-Overview.md` (Authentication: tokens paragraph, link), `docs/wiki/Accounts-and-sign-in.md`,
`docs/wiki/Settings-tour.md`, `docs/wiki/Your-data.md` (never in backups), `docs/wiki/_Sidebar.md`,
`docs/contracts/backup/README.md` ("Never in an archive" gains access tokens), `README.md` (API section).

The wiki page holds: what tokens are for; "treat it like a password"; the format and scanner regex; scopes,
workspace limit, expiry, 20-token cap; what never works (account, auth, admin, backup/export/restore, MFA,
sessions, tokens, AI, journal, workspace management) and why; the gate's error codes with a sample body;
rate limits; revocation and the containment list; examples with `curl`:

```sh
export QQ=https://qinqin.example.org QQ_TOKEN=qq_pat_...   # from Settings → Account → Access tokens
curl -sS -H "Authorization: Bearer $QQ_TOKEN" "$QQ/api/workspaces"
curl -sS -H "Authorization: Bearer $QQ_TOKEN" "$QQ/api/lookup?q=%E5%AD%A6&lang=zh"
curl -sS -H "Authorization: Bearer $QQ_TOKEN" "$QQ/api/sync/pull?collections=events"
curl -sS -H "Authorization: Bearer $QQ_TOKEN" -H 'Content-Type: application/json' \
     -X POST "$QQ/api/events/batch" --data @events.json
curl -sS -H "Authorization: Bearer $QQ_TOKEN" "$QQ/api/plugins/qinqin-flashcards/data?workspace=3"
```

(Builder: copy each query string from the real handler/tests; do not invent parameters. Every example is run
in Task 13's real-app check.)

- [ ] Wiki tests (sidebar links, generated pages `--check`) fail first where they apply, then pass.
  Commit `docs: personal access tokens in the wiki and README`.

### Task 13: Real-app check, full gates, Execution record

- [ ] Build from a scratch copy: `cp -r <wt>/server $SCRATCH/srv && cd $SCRATCH/srv && go build -o $SCRATCH/qinqin ./cmd/qinqin`;
  run on a free port (not 8080/8085/8300), data dir in `$SCRATCH`, stderr to `$SCRATCH/server.log`.
- [ ] With curl: register user 1 (admin) and user 2; user 1 creates workspaces A and B; create R, W, L(A)
  tokens via `POST /api/account/tokens` with the session; then:
  1. every Task 12 example with W → 200; the same with R on `POST /api/events/batch` → 403 `token_read_only`;
  2. W on `GET /api/auth/me`, `GET /api/account/tokens`, `POST /api/account/export`, `GET /api/admin/users`
     (admin's token), `PUT /api/ai/keys/openai` → 403 `token_not_allowed`;
  3. L on `GET /api/events?workspace=A` 200, `?workspace=B` 403 `token_workspace`, `GET /api/sync/pull` 403;
  4. user 2's session lists no tokens of user 1 and `DELETE /api/account/tokens/<id of user 1>` → 404;
  5. change user 1's password → all three tokens 401; create a new one, admin disables user 2 after giving
     user 2 a token → 401;
  6. hammer `GET /api/workspaces` with a token beyond 120 → 429 with `Retry-After`;
  7. `sqlite3 $SCRATCH/data/qinqin.db 'select token_hash, hint from access_tokens'` shows hashes only;
     `grep -c qq_pat_ $SCRATCH/server.log` prints 0;
  8. `GET /api/admin/audit` shows `token_created`, `token_first_used`, `token_revoked` and `tokens` counts.
  Kill the server, delete `$SCRATCH` contents.
- [ ] One full Go `./...` gate, full web gates, Node 26 vitest; `node scripts/gen-api-docs.mjs --check`;
  `git status` clean. Fill the Execution record (below) honestly. Commit `docs(plan): access tokens execution record`.

## Execution record

Built in one session by one implementer (no separate per-task subagents). The independent security review and its mutation checks followed the build:
see **Review fixes** at the end.

**Merge first:** `df624c5` merges `feature/v0.3.0-stretch` (#67 daily goals, #75 frequency decks) into this branch.
Migration number taken: **037** (`036_components.sql` belongs to #71, built in parallel).

| Task | Commit | Test-first evidence / deviation |
|---|---|---|
| 1 Contracts | `155a499` | `tokensFormat.test.ts` failed (no module, no fixtures), then 52 passed. |
| 2 Migration | `033c69e` | `TestMigration037AccessTokens` failed (table missing), then passed. Deviation: the `userTables` row (delete with user, `ExportSkip`, `RestoreKeep`) landed here, because the existing schema guard `TestSchemaGuardEveryUserTableIsListed` failed on the new table; the preview key followed in Task 5. |
| 3 create/list/revoke | `8447a86` | Build failure (undefined API), then pass. Creation's 20-token cap is checked inside the `INSERT … SELECT … WHERE (count) < 20`, so parallel creates cannot exceed it. |
| 4 AuthenticateToken | `a270855` | Build failure, then pass; `-race` on `internal/auth` token tests passed (first-use audit exactly once under 20 goroutines). `auth.Authenticate` returns nil for any `qq_pat_` bearer before querying. |
| 5 Containment | `022392c` | 5 tests failed (11 of 12 containment paths kept tokens, sign-everyone-out, audit counts, janitor, static test), then passed; workspace-delete test failed then passed; restore keeps tokens (assertion added to the existing restore test; it passed before and after, as expected for a "keep"). Deviation: the existing `TestAuditHoldsNoSecrets` bans the substring "token" in audit bodies; the new detail key `tokens` (a count) is stripped before that check and `qq_pat_` was added to the banned list. Web: `accessTokens` in the deletion preview (`deleteView` line) — that small web change was written together with its test, not strictly test-first. |
| 6 Gate | `a31c2e7` | Build failure (no `route.token`), then pass. Rows got a fifth positional field (`noTok`, `tokReadGlobal`, `tokReadAny`, `tokReadWS`, `tokWriteAny`, `tokWriteWS`). `requireCustomAdmin` now resolves a principal and refuses `ViaToken()`. The gate's rate-limit call landed here (it used the client policy until Task 8 defined `pat`). |
| 7 v1 route set | `e6b4f2d` | `TestTokenRulesAreTheV1Set` failed (no rules), then the route walk with token actors, consistency, two-workspace confinement and cross-user tests passed. Route decisions after the merge: see the note under the Task 7 table (both #75 routes session-only). |
| 8 Rate limits | `f6a056c` | Policy test failed (no `pat`/`pat-create` buckets), then passed. The per-user/shared/session-unaffected test passed on first run because the gate already called the bucket (Task 6). Bucket keys are `int64Key(userID)` under the bucket name (the keyer namespaces by name), not the literal `user:<id>` of the plan. |
| 9 Management routes | `a439620` | Handler tests failed (404, no routes), then passed. The tokens.json contract test was written after the handlers (it replays the Task 1 fixture and passed first time). PWA routes fixture regenerated; the four routes are `bypass` (classify is allowlist-based; explicit assertions added). Log capture (`captureLog`) wraps every token handler test and the contract test and asserts no `qq_pat_`. Order in create: form (422) → password present (403 `current_password_required`) → `pat-create` (429) → `reauth` + verify (403 `wrong_password`) → create (404/409). |
| 10 tokensView | `f498afc` | Failed (no module), then one real failure (a fresh 7-day token read "6 days"; days are now rounded), then 25 passed. |
| 11 Settings UI | `8a22e0c` | DOM tests failed (no component), then a jsdom `dialog.close` gap was fixed, then 9 passed; AccountSettings note tests failed then passed. The full web suite found the `utcGuard` ban on `/ DAY` in `tokensView.ts`; it got an allow-list entry (a duration, not a day bucket). The token list reloads (`{#key}`) after a password change or "log out others". |
| 12 Docs | `32d77e2` | `gen-api-docs.test.mjs` token-column tests failed (2), then passed; new wiki page `API-Access-tokens.md`, sidebar, overview, accounts, settings tour, your data, backup contract, README. |
| 13 Real app, gates | this commit | below |

Rulings taken while building:

- Ruling: `POST /api/entries/frequency-ranks` and `GET /api/frequency-packs/{id}/top` (added by #75) take no token —
  the spec's v1 set is binding and needs an amendment to grow — cost if wrong: scripts cannot fetch ranks or
  starter decks until a later amendment.
- Ruling: the create form is validated before the password is asked for (no reauth token spent on a typo); the
  `pat-create` budget is spent before the password check, so wrong guesses also count — cost if wrong: a user who
  mistypes the password ten times waits 6 minutes.
- Ruling: a workspace-limited token's `?workspace=` must appear exactly once and parse (as the handlers parse it)
  to the token's id — cost if wrong: none known (stricter than the handlers).
- Ruling: a personal restore replaces workspaces with new ids, so a token limited to a replaced workspace keeps
  existing but matches nothing (ids are never reused; the list shows "Deleted workspace") — cost if wrong: the
  user recreates such tokens after a restore.
- Ruling: `GET /api/stats/activity` with a limited token also returns the account's current `timeZone` —
  account-wide, like the wsGlobal overlays ruling — cost if wrong: a limited token reveals the owner's zone.

Real-app check (scratch-built server on 127.0.0.1:18473, data dir in the scratchpad, killed and deleted
afterwards): all five wiki curl examples answered 200 with a write token (plugin data with the real workspace id 1
instead of the page's illustrative 3; lookup `{"results":[]}` because no dictionary was installed); the refusal
example 403 `token_not_allowed`; a read token on `POST /api/events/batch` 403 `token_read_only`; the admin's write
token on `/api/auth/me`, `/api/account/tokens`, `POST /api/account/export`, `/api/admin/users`,
`PUT /api/ai/keys/openai` all 403 `token_not_allowed`; the limited token 200 on `?workspace=A`, 403
`token_workspace` on B and on `/api/sync/pull`; bob's session listed no tokens and his `DELETE` of alice's token was
404 while it kept working; a password change with "sign out others" off made all three tokens 401 (audit
`password_changed` `tokens: 3`); bob's token 401 after the admin disabled him (`user_disabled` `tokens: 1`); 130
requests with one token gave 121×200 and 9×429 with `Retry-After: 1`, the session unaffected; the database held
only `token_hash`/`hint` (no token suffix in `qinqin.db`, `-wal`, `-shm`); `qq_pat_` occurred 0 times in the server
log and 0 times in the audit answer; the audit showed `token_created`, `token_first_used`, `token_revoked`
(`scope: all`) and the `tokens` counts; a malformed token 401 with the one body.

Gates before this commit (proxy variables unset, under the lock): full Go `gofmt -l` empty, `go vet ./...` clean,
`go test ./...` exit 1 with 35 packages ok and the one known environment failure only
(`internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused`, no IPv6 sockets here); `-race` on the `internal/auth`
token tests passed (Task 4). Web: `npm run check` 0 (0 errors, 0 warnings), `npm test` 0 (329 files, 5203 tests),
`npm run build` 0; Node 26 vitest 0 (329 files, 5203 tests); `node scripts/gen-api-docs.mjs --check` 0;
`node --test scripts/*.test.mjs` 93 pass, 0 fail.

Not verified: the Settings UI in a real browser (jsdom only: the `<dialog>` modal behaviour, focus, layout on a
phone), the clipboard on iOS Safari and other browsers, an Android client, the janitor running in a live server
(unit-tested only), HEAD requests with a token (served through the GET rows by Go's mux, not tested separately),
`-race` on the api package (not run, per the brief), lookups with a real dictionary in the real-app check. The
independent security review and its mutation checks happened afterwards: see Review fixes.

## Review fixes

The independent security review found no MUST-FIX. One fix wave, after merging the collection branch again
(`ce075e3`: #77 notes added no server route; #71 radicals holds migration `036`, this branch keeps `037`; #71's
public `GET /api/components` and `GET /api/component-packs` became `tokRead / wsGlobal`, pinned, with a spec §3
amendment and a Ruling under the Task 7 table). Each fix test-first (the new test failed, then passed):

| # | Finding | Commit | Fix |
|---|---|---|---|
| 1 | (SHOULD, blocking) A personal restore left workspace-limited tokens on deleted workspace ids | `ef6ce89` | In the restore transaction a limited token follows its workspace through the archive's id map; a token whose workspace is not in the archive is deleted, audited `token_revoked` {scope: restore, count}. Spec Ruling and wiki updated. `TestRestoreRemapsWorkspaceLimitedTokens` failed (stale ids, token survived, no audit), then passed. |
| 2 | A refused request counted as a use | `6fd36f8` | `AuthenticateToken` no longer touches the row; `auth.TouchToken` runs in the gate after the read-only, workspace and rate-limit checks. `TestRefusedTokenRequestsAreNotUses` failed (2 first-use rows from refused requests), then passed; the auth last-used test now calls `TouchToken` and proves authenticating alone writes nothing; `-race` on it passed. |
| 3 | Revoke-one audit lacked the token id | `f833c44` | `token_revoked` {scope: one, count: 1, tokenId}. |
| 4 | Workspace deletion revoked tokens unaudited | `f833c44` | `token_revoked` {scope: workspace, count: n} in the deletion transaction, only when n > 0 (the shape of the other `token_revoked` rows uses `count`). |
| 5 | Token management handlers relied on the gate alone | `9050d2b` | `requireTokenManager` refuses a token principal with 403 `token_not_allowed` (like the admin helpers); a direct-call test over all four handlers failed (200/403 wrong_password/404/200), then passed. |
| 6 | The session-delete guard walked only `internal/` | `6f7f3e0` | It walks the whole server module and asserts it saw `cmd/qinqin/main.go` and `recover.go` (failed before, passed after). |
| 7 | Server-backup restores bring revoked sessions and tokens back | `8796d5a`, this commit | Wiki (backup and recovery): sign everyone out afterwards. Found while writing it: there is no one-click "sign everyone out" in the UI; the page names Admin, Users, "Sign out everywhere" per user, or the two-step switch with "Sign everyone else out now" (which ends every other session and revokes every access token, the administrator's own tokens included). |

Mutation checks by the reviewer (harness `/tmp/claude-0/review-83/mut/run.py`, run against the pre-fix branch):
20 mutants, **all killed**.

| Mutant | Result |
|---|---|
| M1 no expiry check at authentication | killed |
| M2 `revokeCredentials` skips tokens | killed |
| M3 plain password change keeps tokens | killed |
| M4 `wsNone` lets a limited token through | killed |
| M5 no read-only check | killed |
| M6 workspace delete keeps tokens | killed |
| M7 sign-everyone-out keeps tokens | killed |
| M8 disabled owner still authenticates | killed |
| M9 account deletion keeps tokens | killed |
| M10 gate uses the last `?workspace=` value, no duplicate check | killed |
| M11 no rate limit | killed |
| M12 gate skips the restriction | killed |
| M13 token cap removed | killed |
| M14 janitor never prunes tokens | killed |
| M15 MFA reset deletes sessions only | killed |
| M16 create without the password check | killed |
| M19 custom-admin token check removed | killed |
| M22 create skips workspace ownership | killed |
| M23 revoke-one ignores the owner | killed |
| M24 admin helper token check removed | killed |

(M6's patch text targets the pre-fix workspace-deletion code; fix 4 moved that statement, so the mutant would need
re-targeting to be re-run on the current branch. Not re-run here.)

Gates after the fixes (proxy variables unset, under the lock): targeted `go vet` + `go test` of `internal/auth`,
`internal/api`, `internal/backup` exit 0; full Go `./...` exit 1 with 37 packages ok and only the known
`internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 here), `gofmt -l` empty; web `npm ci` 0,
`check` 0 (0 errors, 0 warnings), `test` 0 (342 files, 5377 tests), `build` 0; Node 26 vitest 0 (342 files,
5377 tests); `gen-api-docs --check` 0; `node --test scripts/*.test.mjs` 105 pass.

Not verified in this wave: no new real-app run (the fixes are covered by Go tests only); the restore remap across
servers (an archive whose workspace ids collide with a token's workspace id binds it to that archive workspace,
see the spec Ruling).
