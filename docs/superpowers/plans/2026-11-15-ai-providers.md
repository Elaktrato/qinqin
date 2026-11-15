# Journal AI: Choose Any Provider (issue #87) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner always runs plans subagent-driven, but they must say "start" before anyone dispatches an implementer.

**Goal:** The learner stores a key per AI provider (Anthropic, OpenAI, Gemini, DeepSeek, Mistral, xAI, Groq, OpenRouter, or an admin-registered OpenAI-compatible endpoint), picks one as active with a model, and the journal's Review, Ideas and Read with AI use it.

**Architecture:** `internal/ai` gains a provider registry (Go data + a custom-endpoint table), two plain `net/http` adapters (OpenAI-compatible, Gemini native) next to the unchanged Anthropic SDK adapter, an SSRF-guarded HTTP client, and a key store keyed by `(user, provider)` with a per-user active selection. `internal/api` swaps `/api/ai/key` for per-provider routes plus admin custom-provider routes. The web Settings → AI tab is rebuilt around the registry.

**Tech Stack:** Go 1.26 stdlib (`net/http`, `net/netip`), existing `anthropic-sdk-go/v2` v2.9.0; SvelteKit 2 + Svelte 5 runes, vitest + jsdom. **No new Go or npm dependencies.**

**Spec:** `docs/superpowers/specs/2026-11-15-ai-providers-design.md`; it builds on `docs/superpowers/specs/2026-11-14-journal-design.md` and the rulings in `docs/superpowers/plans/2026-11-15-journal.md`. Read all three.

**Worktree:** `<wt>` = `/home/user/www/github/qinqin/.claude/worktrees/ai-providers`, branch `feature/ai-providers` from `develop` (edca5fc or later): `git worktree add -b feature/ai-providers .claude/worktrees/ai-providers develop`. Ledger (git-ignored): `<wt>/.superpowers/sdd/2026-11-15-ai-providers/progress.md`. Run `npm --prefix <wt>/apps/web ci` once before the first web gate.

## Gates

`<sp>` = `/tmp/claude-1000/-home-user-www-github-qinqin--claude-worktrees-feature-reader/768f9452-f6f2-4d96-9ec8-321a7a58ebb3/scratchpad`. The machine has 4 cores: run **one Go gate at a time**, only the packages the task touched, with `-p 2`.

- Go (`<pkgs>` = the task's packages, e.g. `./internal/ai/...`):
  `docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -e GOPATH=/gp -e GOCACHE=/gc -v <sp>/gp-m:/gp -v <sp>/gc-m:/gc -v <wt>:/src -w /src/server -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false golang:1.26 sh -c "go vet <pkgs> && go test -p 2 <pkgs>"` → exit 0.
- Go race for tasks touching `internal/ai` or `internal/api`: same, `go test -race -p 2 <pkgs>`.
- Web: `npm --prefix <wt>/apps/web run check`, `npm --prefix <wt>/apps/web test`, `npm --prefix <wt>/apps/web run build`, each exit 0.
- Every task ends green and with a commit on `feature/ai-providers`; the message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge or push.

## Global Constraints

- **Never call a real AI API.** No test, check or real-app run may reach any provider host. Tests use `httptest` servers with canned replies, `ai.Fake`, or the `aitest` fake server. The owner tests each provider with a real key.
- **No browser automation** (no Playwright). UI is covered by pure-module tests and jsdom component tests named `*.dom.test.ts`; the real-app check uses curl against a built server.
- AAD: built-ins keep the frozen `qinqin/ai_keys/v1|user=<id>|provider=<provider id>` (`KeyAAD`, `secret.go`); custom providers use `qinqin/ai_keys/v2|user=<id>|provider=<custom id>|base=<normalised base URL>` (`KeyAADCustom`). Built-in provider ids are frozen strings: `anthropic`, `openai`, `gemini`, `deepseek`, `mistral`, `xai`, `groq`, `openrouter`. Custom ids are `custom-` + 10 lowercase base32 chars from `crypto/rand`, never reused.
- A key never appears in a response body, log line, error string, plugin data or stored row in plain text, and is never sent to a host other than its provider's base URL host (no redirects followed).
- AI errors are never HTTP 401. Body `{"error": code, "message": text}`. Existing codes keep their statuses; new: `unknown_provider` 404, `no_selection` 409, `no_vision` 409, `provider_disabled` 409, `endpoint_blocked` 422, `forbidden` 403 (non-admin on custom-provider routes), `invalid_endpoint` 422.
- Limits unchanged: 30 provider calls per user per rolling hour across all providers (validation and repair calls count), one in flight per user, 5,000 code points per review, provider timeout 150 s. New: response bodies capped at 8 MiB; dial and TLS handshake 10 s each.
- Model ids: 1–200 chars matching `^[A-Za-z0-9][A-Za-z0-9._:/@-]*$`; any such id is accepted for any provider. Registry suggestions (spec, Research): anthropic `claude-opus-5-5` (default), `claude-sonnet-5-5`, `claude-haiku-5-5`; openai `gpt-6-astra` (default), `gpt-6-luna`; gemini `gemini-3.8-flash` (default), `gemini-3.5-flash-lite`; deepseek `deepseek-flash` (default, vision), `deepseek-v4-pro` (no vision); mistral `mistral-large-latest` (default, vision), `mistral-small-latest`; xai `grok-4.7`; groq `openai/gpt-oss-120b`; openrouter `openrouter/auto`. Mark ids the spec lists as UNVERIFIED with a `// UNVERIFIED 2026-11-15` comment.
- Migration: `030_ai_providers.sql` (develop's last is `029_audio.sql`; re-check with `ls server/internal/db/migrations` and take the next free number, renaming everywhere if it moved).
- Model output is text only in the UI (no `{@html}`, no markdown).
- Web style: tabs, single quotes, Svelte 5 runes, touch targets ≥ 44 px, everything reachable by keyboard, labels on every control.

## Review Focus

1. **Key leakage.** Through adapter error paths (provider error bodies echo request fields), `fmt` of new structs, the guard's error strings (they must not include the URL's query or headers), and the redirect path. Pinned in Tasks 2, 4, 5, 6 and 13 (grep logs, responses and the DB file for `sk-fake-…`).
2. **SSRF.** Admin URL `http://169.254.169.254/`, `https://metadata.google.internal`, a hostname that resolves public then private (rebinding), `http://[::ffff:127.0.0.1]`, a decimal IP `http://2130706433/`, a 302 to `http://127.0.0.1`. Expected: `endpoint_blocked` or `bad_request`, and no connection to the blocked address. Pinned in Task 4 and Task 13.
3. **Provider confusion and cross-user access.** A key stored for `openai` used against DeepSeek's URL; user B testing/removing/activating user A's custom-provider key; a deleted custom id still selected; a non-admin creating an endpoint. Pinned in Tasks 2, 3, 8 and 9.
4. **Migration safety.** An 029 database with an Anthropic key sealed under the current secret, and one under the previous secret: after 030 both decrypt, the first is active, rotation re-seals the second; a DB with no keys migrates to empty tables. Pinned in Task 1 and Task 2.
5. **Injection and reply shape across providers.** The nonce-tag prompts are byte-identical for every adapter; a `json_object`/`prompt`-mode reply with extra fields, missing fields, a markdown fence, or whitespace-only content goes through strict decode → one repair → `bad_reply`, never into the page. Pinned in Tasks 5 and 6.

## Rulings

Each reads "Ruling: what — why — cost if wrong". Decision rule: licensing first, then best learner experience even at higher development cost.

- Ruling: three adapter families — Anthropic (existing SDK), OpenAI-compatible (plain HTTP), Gemini native generateContent (plain HTTP) — Gemini's compat endpoint is beta, undocumented for raw `json_schema`, and hides block/finish reasons; Google itself recommends the native API — cost if wrong: ~250 lines of a second adapter to maintain.
- Ruling: Gemini uses `generateContent` (labelled "Legacy" but supported, no sunset) rather than the new Interactions API — it is the documented, stable request/response shape with `responseJsonSchema`; Interactions is days old and changes shape — cost if wrong: a later port when Google sets a sunset date.
- Ruling: no new SDKs (openai-go, genai) — Apache-2.0 is fine, but they pull Azure/AWS/gRPC/Cloud-auth trees and bring their own HTTP stack that would bypass the SSRF guard — cost if wrong: we track API changes by hand (small: two endpoints each).
- Ruling: the Anthropic adapter stays on its SDK but gets the built-in client via `option.WithHTTPClient` — today the SDK's default client follows redirects and resends `x-api-key` across hosts (builder check finding) — cost if wrong: none; the SDK accepts any `*http.Client`.
- Ruling: Lumo is not built; the custom endpoint covers it if Proton ships an OpenAI-compatible API (roadmap announces "the Lumo API", no date or docs) — nothing to build against — cost if wrong: an admin adds it as a custom endpoint, or a later registry entry.
- Ruling: one key per (user, provider), one active provider per user, model stored per key — keys and costs are personal; the journal's language/guidance settings stay per workspace — cost if wrong: a learner wanting different providers per workspace switches manually.
- Ruling: deleting the active provider's key clears the selection instead of switching to another configured provider — a silent switch would send text to a provider the learner did not choose — cost if wrong: one extra click.
- Ruling: the first stored key becomes active automatically; later keys do not — matches today's single-key behaviour and avoids surprise switches — cost if wrong: none.
- Ruling: custom endpoints are admin-only and server-wide; every user stores their own key for them — any-user URLs would hand every registered account an SSRF primitive — cost if wrong: a non-admin asks the admin to add an endpoint.
- Ruling: custom endpoints are OpenAI-compatible only — that shape covers Ollama, LM Studio, vLLM, Together, Cohere compat, Azure-style gateways — cost if wrong: an exotic API needs a registry change.
- Ruling: a custom endpoint's base URL, name and key-required flag are immutable (PATCH: default model, vision, structured mode, max tokens); names equal (case-insensitive) to a built-in id or name are rejected; the key form shows "Added by your admin · <host>" — admins are trusted as operators, but this stops bait-and-switch and look-alike "OpenAI" endpoints harvesting keys — cost if wrong: delete and re-add, users re-enter keys.
- Ruling: custom-provider keys bind the normalised base URL in the AAD (v2) — someone who can write the DB but lacks `QINQIN_SECRET` could otherwise repoint `base_url` and have the server deliver keys to them; no custom keys exist yet, so no re-encryption — cost if wrong: none.
- Ruling: `QINQIN_AI_PROVIDERS` (comma list of built-in ids plus `custom`, default all) restricts providers; an explicit legacy `QINQIN_AI_PROVIDER=anthropic` means `QINQIN_AI_PROVIDERS=anthropic` and logs a hint; disabled providers' keys stay stored, listed with Remove only, a selection on one reads `provider_disabled` — operators who pinned Anthropic must not find text going to DeepSeek after an upgrade — cost if wrong: one env var to widen.
- Ruling: custom endpoints: `https` only, except `http` to loopback/private targets when `QINQIN_AI_ALLOW_PRIVATE=1`; link-local, metadata, unspecified, multicast always blocked; the check runs on the dialled IP in `net.Dialer.Control`; no redirects; `Proxy: nil` (through a proxy the dialled IP is the proxy's) — standard SSRF defence that also defeats DNS rebinding; local Ollama gets an explicit switch — cost if wrong: a custom endpoint behind an egress proxy cannot be reached (documented).
- Ruling: the built-in client (all three adapters) keeps `http.ProxyFromEnvironment`, follows no redirects, and blocks only the always-blocked set — hosts are fixed in code and today's Anthropic calls honour `HTTPS_PROXY`; blocking private ranges would break private egress proxies — cost if wrong: a poisoned resolver could aim a built-in call at a LAN host (no response data is exposed beyond our error codes).
- Ruling: structured output per provider — `json_schema` strict (OpenAI, xAI), `json_schema` non-strict (Mistral, Groq, OpenRouter with `provider.require_parameters: true`), `json_object` with the schema in the system prompt (DeepSeek; default for custom), Gemini `responseJsonSchema` — the docs say exactly this per provider — cost if wrong: a 400 shown as `bad_request`, fixed by flipping one registry field.
- Ruling: one repair request when a reply fails strict decoding, recorded as its own `ai_calls` row of kind `<kind>-repair` without a new in-flight acquire — a paid reply is worth one retry; counting it keeps usage honest — cost if wrong: at most one extra call per action.
- Ruling: `FallbackFrom` is set only by the Anthropic adapter (new field `FallbackFrom` on `ReviewReply`) instead of comparing model strings — OpenAI and Gemini report dated snapshot ids that would read as false "fallback" — cost if wrong: none.
- Ruling: vision is a registry flag per provider with per-model overrides; a free-text model inherits the provider flag; custom endpoints take the admin's flag. Transcribe with `engine: "ai"` on a non-vision model is 409 `no_vision` without a provider call, and the UI offers Read offline — no paid call that cannot work — cost if wrong: a vision-capable free-text model on a no-vision provider needs offline reading (or the admin flag).
- Ruling: validation per provider: `GET /models` with the key (OpenAI, DeepSeek, Mistral, xAI, Groq; the model must be listed), Gemini `GET /v1beta/models/{model}`, a 1-token chat call for OpenRouter (its `/models` needs no key) and for custom endpoints whose `/models` is 404 — free where the provider offers it — cost if wrong: one tiny paid call.
- Ruling: `QINQIN_AI_PROVIDER=fake` replaces every adapter kind with `ai.Fake` (badge stays) — real-app checks of every provider row without the network — cost if wrong: none (test only).
- Ruling: the old `PUT/GET/DELETE /api/ai/key` routes are removed — only this web client uses them; Android is v0.4.0 — cost if wrong: an external script breaks (none known).
- Ruling: provider error bodies are parsed (≤ 64 KiB) for `error.code`/`error.status`/`error.details[].reason` only and never logged or returned; logs carry `kind`, provider id, HTTP status and our code — provider errors can echo request content — cost if wrong: harder debugging.
- Ruling: the usage line stays aggregate (calls and tokens this hour, all providers); `ai_calls.provider` is recorded for later — YAGNI on per-provider breakdown — cost if wrong: none.

---

## File Structure

- `server/internal/db/migrations/030_ai_providers.sql`, `server/internal/db/migrate_030_test.go`
- `server/internal/ai/keys.go` (per-provider store), `selection.go` (active provider)
- `server/internal/ai/registry.go` (built-ins, `ProviderSpec`), `custom.go` (custom-provider store)
- `server/internal/ai/netguard.go` (URL policy + guarded client)
- `server/internal/ai/openai.go`, `gemini.go` (adapters), `jsonreply.go` (strict decode + repair)
- `server/internal/ai/aitest/` (fake OpenAI-compatible and Gemini HTTP handlers with canned replies; used by tests and `server/tools/fakeai`)
- `server/internal/ai/service.go`, `provider.go`, `claude.go` (dispatch, credentials, fallback field)
- `server/cmd/qinqin/ai_env.go` (`QINQIN_AI_ALLOW_PRIVATE`, clients)
- `server/internal/api/handlers_ai.go`, `handlers_ai_custom.go`, `handlers_journal*.go`, `api.go`
- `server/internal/journal/docs.go` (`Provider` on reviews and suggestions)
- `apps/web/src/lib/api/ai.ts`, `apps/web/src/lib/settings/aiSettingsView.ts`, `AiSettings.svelte`, `AiProviderForm.svelte`, `AiCustomEndpoints.svelte`
- `apps/web/src/lib/plugins/journal/OverallReview.svelte`, `PhotoImport.svelte`, `photoFlow.ts`, `types.ts`, `aiErrors.ts`
- `README.md`, `docker-compose.yml`

### Task 1: Migration 030 (keys per provider, selection, custom providers, call provider)

**Files:** Create `server/internal/db/migrations/030_ai_providers.sql`, `server/internal/db/migrate_030_test.go`.

**Interfaces:** Produces tables `ai_keys(user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at, last_used_at, PRIMARY KEY(user_id, provider))`, `ai_selection(user_id INTEGER PRIMARY KEY, provider TEXT NOT NULL, updated_at TEXT NOT NULL)`, `ai_custom_providers(id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, default_model TEXT NOT NULL, vision INTEGER NOT NULL, structured TEXT NOT NULL, max_output_tokens INTEGER, key_required INTEGER NOT NULL, created_by INTEGER NOT NULL, created_at TEXT NOT NULL)`, column `ai_calls.provider TEXT NOT NULL DEFAULT 'anthropic'`.

- [ ] **Step 1: Write `TestMigrate030KeepsAnthropicKey`** following `migrate_025_test.go`: `migrateThrough(sqlDB, "029_audio")`, insert an `ai_keys` row for user 7 sealed with `ai.NewSealer(secret).Seal([]byte("sk-ant-test-0001…"), ai.KeyAAD(7, "anthropic"))`, plus two `ai_calls` rows; `migrate(sqlDB)`; assert the row is unchanged byte-for-byte (`ciphertext`, `nonce`, `secret_fp`, `hint`, `model`), opens with `KeyAAD(7,"anthropic")`, `ai_selection` has `(7,'anthropic')`, both `ai_calls` rows have `provider='anthropic'`, and inserting a second row `(7,'openai')` succeeds while a duplicate `(7,'anthropic')` fails. `TestMigrate030Empty`: no keys → empty `ai_selection`.
- [ ] **Step 2: Run** the Go gate for `./internal/db/...` → FAIL (no migration).
- [ ] **Step 3: Write the migration**: `CREATE TABLE ai_keys_new (…, PRIMARY KEY (user_id, provider))`, `INSERT INTO ai_keys_new SELECT user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at, last_used_at FROM ai_keys`, `DROP TABLE ai_keys`, `ALTER TABLE ai_keys_new RENAME TO ai_keys`; `INSERT INTO ai_selection SELECT user_id, provider, created_at FROM ai_keys`; the two new tables; `ALTER TABLE ai_calls ADD COLUMN provider …`. Header comment says why the copy keeps ciphertexts valid (AAD is user+provider, both unchanged).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(db): AI keys per provider, active selection, custom providers`.
- Ruling: the migration test lives in external package `db_test` (with `export_test.go` exposing `Migrate`/`MigrateThrough`) because `ai` imports `db` and an in-package test importing `ai` would be an import cycle; the 029-era row is sealed with `ai.NewSealer` + `ai.KeyAAD` exactly as `KeyStore.Put` does, since `Put` on a 029 schema cannot run once its upsert targets `(user_id, provider)` — cost if wrong: none. The `Put` upsert conflict target moves to `(user_id, provider)` in this task so the tree stays green until Task 2 rewrites the store.

### Task 2: Key store per provider and the active selection

**Files:** Modify `server/internal/ai/keys.go`, `keys_test.go`; create `server/internal/ai/selection.go`, `selection_test.go`.

**Interfaces:**
- Produces: `func (k *KeyStore) Put(ctx context.Context, userID int64, provider, apiKey, model string, opt PutOptions) error` with `PutOptions{AllowEmptyKey bool}` (an empty key is an error unless set); `Info(ctx, userID, provider) (*StoredKey, error)`; `List(ctx, userID) ([]StoredKey, error)` ordered by `created_at`; `Credentials(ctx, userID, provider) (Credentials, error)`; `SetModel(ctx, userID, provider, model) error`; `Delete(ctx, userID, provider) error`; `DeleteProvider(ctx, provider) error` (all users); `Rotate(ctx) (int, error)` (per row: `WHERE user_id = ? AND provider = ?`). The store takes `AADFor func(userID int64, provider string) (string, error)` (Task 7 wires it to the registry: v1 for built-ins, `KeyAADCustom(userID, id, baseURL)` for custom; unknown provider → `ErrKeyUndecryptable` state, never a panic). `func KeyAADCustom(userID int64, provider, baseURL string) string` goes in `secret.go`. `ValidModelID(id string) bool` (the Global Constraints pattern) replaces `ValidModel`; `Models`/`DefaultModel` move into the registry (Task 3).
- `type Selection struct{ DB *sql.DB; Now func() time.Time }` with `Active(ctx, userID) (provider string, err error)` (`ErrNoSelection` when none), `SetActive(ctx, userID, provider) error` (requires an `ai_keys` row for that user and provider, else `ErrNoKey`), `Clear(ctx, userID) error`, `ClearProvider(ctx, provider) error`.
- `Credentials` gains `BaseURL string` and keeps its redacting `String/GoString/Format/MarshalJSON/MarshalText`.

- [ ] **Step 1: Tests** — `TestPutPerProviderIndependent` (anthropic and openai keys for one user coexist; deleting one keeps the other), `TestKeyOfOtherProviderDoesNotOpen` (copy user 1's openai ciphertext into its deepseek row → `Info` state `undecryptable`, `Credentials` → `ErrKeyUndecryptable`), `TestCrossUserRowDoesNotOpen` (copy into user 2 → undecryptable), `TestCustomKeyBoundToBaseURL` (seal for `custom-abc` at `https://a.example/v1`, change the AADFor base to `https://b.example/v1` → undecryptable), `TestV1AADUnchanged` (`KeyAAD(7,"anthropic")` equals the literal `qinqin/ai_keys/v1|user=7|provider=anthropic`), `TestRotatePerRow` (two providers sealed with Previous → both re-sealed, count 2), `TestEmptyKeyOnlyWhenAllowed`, `TestSelectionRequiresKey`, `TestCredentialsNeverFormatted` (`fmt.Sprintf("%v %+v %#v %s", c, c, c, c)` and `json.Marshal(struct{C Credentials}{c})` contain no key or base URL query).
- [ ] **Step 2: Run** `./internal/ai/...` → FAIL. **Step 3: Implement** as in Interfaces. **Step 4: Run** → PASS (race). **Step 5: Commit** `feat(ai): one key per provider and an active selection`.
- Ruling: until Task 3/7/8 land, `Models`/`DefaultModel` stay in `provider.go`, `Put` with an empty model uses `DefaultModel` for `anthropic` only (any other provider needs an explicit model; the API layer will pass the registry default), `AADFor == nil` means the frozen `KeyAAD`, and the existing `/api/ai/key` handlers are bridged to `provider="anthropic"` so the tree stays green; the old route's `invalid_model` test now uses `gpt 4` because any id matching the pattern is accepted — cost if wrong: none.

### Task 3: Registry and custom-provider store

**Files:** Create `server/internal/ai/registry.go`, `registry_test.go`, `custom.go`, `custom_test.go`.

**Interfaces:**
- `type Kind string` (`KindAnthropic`, `KindOpenAI`, `KindGemini`); `type Structured string` (`StructuredSchema` "json_schema", `StructuredObject` "json_object", `StructuredPrompt` "prompt").
- `type ModelSpec struct{ ID, Label string; Vision *bool }`
- `type ProviderSpec struct{ ID, Name string; Kind Kind; BaseURL string; Custom, KeyRequired bool; KeyURL string; DefaultModel string; Models []ModelSpec; Structured Structured; Strict, Vision bool; TokenField string; MaxOutputTokens int; ValidateBy string; Extra map[string]any }` with JSON tags for the public fields only (`baseUrl` omitted for non-admins by the handler).
- `func Builtins() []ProviderSpec` (the eight ids, base URLs from the spec's Research; `TokenField` `max_completion_tokens` for openai, `max_tokens` otherwise; anthropic `Kind` anthropic; gemini base `https://generativelanguage.googleapis.com/v1beta`); `func (p ProviderSpec) VisionFor(model string) bool`.
- `type CustomStore struct{ DB *sql.DB; Now func() time.Time }`: `Create(ctx, adminID int64, in CustomInput) (ProviderSpec, error)`, `Update(ctx, id string, in CustomPatch) (ProviderSpec, error)` (`CustomPatch{DefaultModel *string; Vision *bool; Structured *Structured; MaxOutputTokens *int}` — no URL, name or key-required), `Delete(ctx, id) error`, `List(ctx) ([]ProviderSpec, error)`, `Get(ctx, id) (ProviderSpec, error)` (`ErrUnknownProvider`). `CustomInput{Name, BaseURL, DefaultModel string; Vision, KeyRequired bool; Structured Structured; MaxOutputTokens *int}`; Create calls `CheckEndpointURL` from Task 4, so **execute Task 4 before Task 3**; the tests here use `https://llm.example.com/v1`.
- `type Registry struct{ Custom *CustomStore; Enabled map[string]bool /* nil = all; key "custom" covers every custom id */ }` with `Lookup(ctx, id) (ProviderSpec, error)` (`ErrProviderDisabled` for a known but disabled id), `All(ctx) ([]ProviderSpec, error)` (enabled only) and `IsEnabled(id string) bool`.

- [ ] **Step 1: Tests** — `TestBuiltinIDsFrozen` (exact id list), `TestBuiltinBaseURLsHTTPS`, `TestDefaultModelInModels`, `TestVisionFor` (`deepseek-v4-pro` false, `deepseek-flash` true, free-text inherits), `TestCustomIDFormat` (`^custom-[a-z2-7]{10}$`, 100 creates unique), `TestCustomNameRules` (1–40 chars, no control chars, unique; `openai`, `OpenAI`, `Google Gemini` → rejected as built-in look-alikes), `TestCustomUpdateCannotChangeURL`, `TestLookupUnknown` → `ErrUnknownProvider`, `TestLookupDisabled` (`Enabled{"anthropic":true}` → openai `ErrProviderDisabled`, custom ids disabled, `All` lists only anthropic).
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS. **Step 5: Commit** `feat(ai): provider registry and admin custom endpoints store`.
- Ruling: `CustomStore` gains a `Policy GuardPolicy` field (the `QINQIN_AI_ALLOW_PRIVATE` switch reaches `CheckEndpointURL` through it), field refusals wrap `ErrInvalidEndpoint` (Task 9 maps it to `invalid_endpoint` 422) while URL refusals stay `ErrEndpointBlocked`; built-in look-alike names are compared after folding to lowercase letters and digits ("Open AI", "open-ai" and "gemini" are refused, "OpenAI (EU gateway)" is not); max output tokens 1..1,000,000; an empty structured mode on create means `json_object`; custom ids are drawn at random with no tombstones (50 bits, collisions retried) — a freshly deleted id could only repeat by chance. `Models`/`DefaultModel` stay in `provider.go` for now and feed the anthropic registry entry (a test pins them together) so the existing `/api/ai/key` handlers keep compiling; Task 7/8 remove them. Vision flags for OpenRouter (`true`, routed model decides), xAI (`true`), Mistral (`true`) are UNVERIFIED and commented — cost if wrong: a vision call fails as `bad_request`, or Read offline is offered needlessly.

### Task 4: Outbound guard (URL policy and guarded client)

**Files:** Create `server/internal/ai/netguard.go`, `netguard_test.go`.

**Interfaces:**
- `type GuardPolicy struct{ AllowPrivate bool }`
- `func CheckEndpointURL(raw string, p GuardPolicy) (*url.URL, error)` → `ErrEndpointBlocked` wrapped with a reason word (`scheme`, `userinfo`, `query`, `host`, `address`). Rules: absolute; scheme `https`, or `http` only when the host is an IP literal or `localhost`-style name **and** `p.AllowPrivate`; no userinfo, query, fragment; literal IPs (incl. decimal/octal/hex IPv4 forms, which `net/netip` rejects → reject the URL) checked with `allowedAddr`. Trailing `/` trimmed.
- `func allowedAddr(a netip.Addr, p GuardPolicy) bool` — `a.Unmap()` first; always false for unspecified, link-local unicast/multicast, multicast, broadcast `255.255.255.255`, `100.100.100.200`, `fd00:ec2::254`; loopback, private (RFC 1918, `fc00::/7`), CGNAT `100.64.0.0/10` only with `AllowPrivate`.
- `func NewBuiltinClient(resolver *net.Resolver) *http.Client` — `Proxy: http.ProxyFromEnvironment`, Control blocks only the always-blocked set, same redirect/timeouts as below.
- `func NewGuardedClient(p GuardPolicy, resolver *net.Resolver) *http.Client` (custom endpoints) — `Transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 10s, Resolver: resolver, Control: <parse address, allowedAddr or ErrEndpointBlocked>}).DialContext, TLSHandshakeTimeout: 10s, ResponseHeaderTimeout: 150s, ForceAttemptHTTP2: true}`, `CheckRedirect: func(...) error { return http.ErrUseLastResponse }`.
- `func readCapped(r io.Reader, n int64) ([]byte, error)` → `ErrBadReply` past 8 MiB.

- [ ] **Step 1: Tests** — table `TestCheckEndpointURL` (`http://169.254.169.254/` blocked even with AllowPrivate; `https://[::ffff:169.254.169.254]/`; `http://2130706433/`; `http://127.0.0.1:11434/v1` blocked without, allowed with AllowPrivate; `https://u:p@x.example/`; `https://x.example/v1?k=1`; `ftp://…`), `TestDialBlocksResolvedPrivate` (a `net.Resolver` with a custom `Dial` that answers `evil.test` → `127.0.0.1`; GET via the client fails with `ErrEndpointBlocked` and the httptest server on 127.0.0.1 sees zero requests), `TestRebindingSecondAnswerChecked` (resolver answers public `203.0.113.5` first then `127.0.0.1`; the dial to `127.0.0.1` is refused), `TestRedirectNotFollowed` (server A 302 → server B; B receives no request and A's response status 302 reaches the caller; B's handler fails the test if it sees `Authorization`), `TestNoProxyFromEnv` (`HTTPS_PROXY` set via `t.Setenv` is ignored by the guarded client and used by the built-in client — assert via `Transport.Proxy` on a request), `TestBuiltinClientNoRedirect`, `TestBuiltinBlocksMetadata` (resolver → `169.254.169.254` refused), `TestReadCapped`, `TestGuardErrorsHaveNoQuery` (error strings contain the host only).
- [ ] **Step 2–4:** FAIL, implement, PASS (race). **Step 5: Commit** `feat(ai): SSRF-guarded HTTP client for provider calls`.
- Ruling: `http` is accepted only for `localhost`-style names or loopback/private/CGNAT IP literals and only with `QINQIN_AI_ALLOW_PRIVATE`; an `http` URL to a public name or IP is reason `scheme`, link-local/metadata literals are reason `address` whatever the scheme; `https://localhost` without the switch is `address`; a `#` anywhere or an empty `?` is reason `query`; IPv6 zones are `address`; `0.0.0.0/8` joins the always-blocked set; the rebinding test uses two sequential requests against a UDP DNS stub (first answer public TEST-NET with a 300 ms deadline, second loopback) because a single response with two addresses would make the first dial hang — cost if wrong: none.

### Task 5: OpenAI-compatible adapter

**Files:** Create `server/internal/ai/openai.go`, `openai_test.go`, `jsonreply.go`, `jsonreply_test.go`, `server/internal/ai/aitest/openai.go`, `server/internal/ai/testdata/openai/*.json`; modify `prompts.go`.

**Interfaces:**
- `type OpenAICompat struct{ HTTP *http.Client; Spec func(ctx context.Context, providerID string) (ProviderSpec, error) }` — implements `Provider`. `Credentials` carries `Provider string` too (add it in this task; still redacted).
- `prompts.go`: `func systemPrompt(task string, mode Structured) string` returns the existing constant, plus for `StructuredObject`/`StructuredPrompt` the constant suffix `"\n\nReply with one JSON object (json) that matches this JSON Schema, with no other text:\n" + schema`. The base constants stay byte-identical (test asserts equality with the Anthropic adapter's input).
- `jsonreply.go`: `func decodeStrict(text string, dst any, required []string) error` — trims whitespace and one surrounding ```` ```json ```` fence, `json.Decoder` with `DisallowUnknownFields`, checks the required top-level keys are present and not null, rejects whitespace-only. `func repairMessage(bad string, err error) string` (≤ 2,000 chars of the bad output, the decode error words only).
- Request: `POST {base}/chat/completions`, headers `Authorization: Bearer <key>` (omitted when the key is empty and `KeyRequired` false), `Content-Type: application/json`; body `{model, messages:[system, user], response_format, <TokenField>: n, ...Extra}`; `response_format` = `{type:"json_schema", json_schema:{name:"<task>", schema, strict}}` | `{type:"json_object"}` | omitted. Token budgets: review 16000, suggest 4000, transcribe 8000, each `min(budget, MaxOutputTokens)` when set; custom without `MaxOutputTokens` sends none. Image: user content `[{type:"image_url", image_url:{url:"data:image/jpeg;base64,…"}}, {type:"text", text}]`.
- Reply: `choices[0].message.content`, `.refusal`, `finish_reason`, `model`, `usage.prompt_tokens/completion_tokens/prompt_tokens_details.cached_tokens` (also DeepSeek `prompt_cache_hit_tokens`).
- Errors: `func mapOpenAIError(kind, provider string, status int, body []byte, h http.Header) error` per the spec table (`insufficient_quota` → `ErrQuota`).
- Validate per `ValidateBy` (Rulings).
- Repair: the adapter returns `ErrNeedsRepair{Bad string; Err error}` internally; one more request with messages `[system, user, assistant(bad), user(repairMessage)]`; the second failure is `ErrBadReply`. The adapter reports the extra call through `ReviewReply.Calls`/`SuggestReply.Calls`/`TranscribeReply.Calls []CallUsage{Kind, Usage}` so `runAI` records each (Task 8).

- [ ] **Step 1: Tests** with `httptest` + canned fixtures shaped like the providers' docs examples. Request-shape table `TestOpenAIRequestShape` over specs openai/deepseek/mistral/groq/openrouter/custom: path, `Authorization`, `response_format.type`, `strict`, token field name and value, `provider.require_parameters` only for openrouter, no `Authorization` for a keyless custom endpoint, image data URL prefix. Reply tables `TestOpenAIReplyMapping` (`refusal` non-null → `ErrRefused`; `finish_reason` `length` → `ErrTruncated`, `content_filter` → `ErrRefused`; cached tokens mapped). `TestOpenAIErrorMapping` (401, 403 → key_rejected; 402 → quota; 429 `insufficient_quota` → quota; 429 other with `Retry-After: 12` → busy 12 s; 404 → model_unavailable; 500/503 → busy; 302 → bad_request; 400 → bad_request; connection refused → busy). `TestRepairOnce` (first reply has a markdown fence plus an extra field → second request carries the assistant turn; second good → success with 2 `Calls`), `TestRepairFailsOnce` (two bad → `ErrBadReply`, exactly 2 requests), `TestDeepSeekWhitespaceContent` → repair. `TestOpenAIValidate` per `ValidateBy` (models list missing the model → model_unavailable; 404 `/models` on custom → chat fallback). `TestOpenAINoKeyInErrors`: every error path's `err.Error()` and captured `log` output lack `sk-fake-` and the request body text. `TestPromptsProviderNeutral`: the base system prompts equal the constants used by `claude.go`.
- [ ] **Step 2–4:** FAIL, implement, PASS (race). **Step 5: Commit** `feat(ai): OpenAI-compatible adapter with structured output and one repair`.

### Task 6: Gemini adapter

**Files:** Create `server/internal/ai/gemini.go`, `gemini_test.go`, `server/internal/ai/aitest/gemini.go`, `server/internal/ai/testdata/gemini/*.json`.

**Interfaces:** `type Gemini struct{ HTTP *http.Client; BaseURL string }` implements `Provider` (base from the spec, tests pass the httptest URL). Request: `POST {base}/models/{model}:generateContent`, header `x-goog-api-key`, body `{systemInstruction:{parts:[{text}]}, contents:[{role:"user", parts:[{inlineData:{mimeType:"image/jpeg", data}}?, {text}]}], generationConfig:{responseMimeType:"application/json", responseJsonSchema: <schema>, maxOutputTokens}}` (the model id is path-escaped; reject ids containing `/` other than a leading `models/`). Reply: `candidates[0].content.parts[*].text` joined, `finishReason`, `promptFeedback.blockReason`, `modelVersion`, `usageMetadata.{promptTokenCount,candidatesTokenCount,cachedContentTokenCount}`. Uses `decodeStrict` and the same one repair (Task 5). Validate: `GET {base}/models/{model}`.

- [ ] **Step 1: Tests** — `TestGeminiRequestShape` (path, header, no key in the URL query, `responseJsonSchema` equals our schema, image part present only for transcribe), `TestGeminiReplyMapping` (`finishReason` MAX_TOKENS → truncated; SAFETY, RECITATION, BLOCKLIST, PROHIBITED_CONTENT, SPII, IMAGE_SAFETY → refused; `promptFeedback.blockReason` → refused; no candidates → bad_reply), `TestGeminiErrorMapping` (400 with `details[].reason` `API_KEY_INVALID` → key_rejected; 403 PERMISSION_DENIED → key_rejected; 404 → model_unavailable; 429 RESOURCE_EXHAUSTED → busy; 500/503 → busy; plain 400 → bad_request), `TestGeminiModelPathEscape` (`../x` rejected before any request), `TestGeminiNoKeyInErrors`.
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5: Commit** `feat(ai): native Gemini adapter`.

### Task 7: Service dispatch, Anthropic fallback field, env wiring

**Files:** Modify `server/internal/ai/service.go`, `service_test.go`, `provider.go`, `claude.go`, `claude_test.go`, `fake.go`, `server/cmd/qinqin/ai_env.go`, `ai_env_test.go`.

**Interfaces:**
- `ReviewReply`, `SuggestReply`, `TranscribeReply` gain `Calls []CallUsage` (Task 5) and `ReviewReply.FallbackFrom string` (set by `Claude` when `resp.Model != cr.Model` on Opus/Sonnet; Fake's `[[fake:fallback]]` sets it too).
- `type Service struct{ Adapters map[Kind]Provider; Fake bool; Registry *Registry; Secret SecretState; Keys *KeyStore; Selection *Selection; Limiter *Limiter }`. `func (s *Service) For(ctx, userID) (Provider, ProviderSpec, Credentials, error)` resolves the selection → spec → adapter → credentials (`BaseURL` = spec base, `Provider` = id); `ErrNoKey` when no selection. `func (s *Service) Adapter(spec ProviderSpec) (Provider, error)` for validation of a not-yet-stored key. With `Fake`, every kind maps to `Fake{}`.
- `Status` gains `Active *ActiveInfo{Provider, Name, Model string; Vision bool; Structured Structured}`, `Keys []StoredKey`, `Fake bool`; keeps `Provider` (`"fake"` or the active id), `Key` (the active key), `Models` (the active provider's suggestions), `Reason` (adds `"no_selection"` mapped to the same UI as `no_key`).
- `ai_env.go`: real adapters are `NewClaude(option.WithHTTPClient(NewBuiltinClient(nil)))`, `OpenAICompat` with `NewBuiltinClient` for built-ins and `NewGuardedClient(GuardPolicy{AllowPrivate: env}, nil)` for custom, `Gemini` with `NewBuiltinClient`. `QINQIN_AI_PROVIDER`: unset → real adapters, all providers; `anthropic` (explicit) → real adapters with `Registry.Enabled = {"anthropic"}` and the log `"AI: QINQIN_AI_PROVIDER=anthropic limits AI to Anthropic; use QINQIN_AI_PROVIDERS to choose providers"`; `fake` → Fake; else disabled as today. `QINQIN_AI_PROVIDERS` (comma list, trimmed; unknown ids logged and ignored) overrides the legacy limit when set. `QINQIN_AI_ALLOW_PRIVATE` = `1`/`true` enables private targets for custom endpoints only, logged once as `"AI: custom endpoints may reach private addresses"`. `OpenAICompat` picks the client by `spec.Custom`.

- [ ] **Step 1: Tests** — `TestForUsesSelection` (anthropic and openai keys, selection openai → OpenAI adapter and its key), `TestForUnknownCustomGone` (selection to a deleted custom id → `ErrNoKey` and the selection cleared), `TestFakeReplacesAllKinds`, `TestStatusActive`, `TestClaudeFallbackFrom` (existing fallback fixture now asserts `FallbackFrom`), `TestAIEnvAllowPrivate` (env on/off → custom client policy), `TestAIEnvLegacyAnthropicLimits` (explicit `anthropic` → only anthropic enabled; unset → all; `QINQIN_AI_PROVIDERS=openai,custom` → those two), `TestForDisabledProvider` → `ErrProviderDisabled` mapped to code `provider_disabled`, `TestClaudeUsesBuiltinClient` (an httptest 302 to a second server: the second never receives `x-api-key`), `TestAIEnvLogsNoSecret` kept.
- [ ] **Step 2–4:** FAIL, implement, PASS (race, `./internal/ai/... ./cmd/qinqin/...`). **Step 5: Commit** `feat(ai): dispatch to the active provider`.

### Task 8: API — providers, status, keys, active, journal routes

**Files:** Modify `server/internal/api/handlers_ai.go`, `handlers_ai_test.go`, `handlers_ai_errors_test.go`, `handlers_journal.go`, `handlers_journal_photos.go`, `handlers_journal_test.go`, `handlers_journal_photos_test.go`, `api.go`, `server/internal/journal/docs.go`.

**Interfaces:**
- Routes: `GET /api/ai/providers` → `{providers: ProviderSpec[] (baseUrl only for admins and only for custom), canManageCustom: bool, privateAllowed: bool}`; `GET /api/ai/status`; `PUT /api/ai/keys/{provider}` `{key?, model?}`; `POST /api/ai/keys/{provider}/test`; `DELETE /api/ai/keys/{provider}`; `PUT /api/ai/active` `{provider}`. Remove `/api/ai/key`.
- Key format: `KeyRequired` → 20–400 chars, no whitespace (today's rule); keyless custom → empty allowed, non-empty uses the same rule. Validation runs through `Limiter.Acquire` + `Record{Provider: id, Kind: "validate"}` exactly as today.
- `runAI` takes the adapter, spec and credentials from `Service.For`, records each `Calls` entry (`Record` gains `Provider`), and logs `kind`, provider id and code only.
- `writeAIError` maps `ai.ErrNoSelection` → `no_selection` (409, "Choose which provider to use in Settings → AI."), `ai.ErrUnknownProvider` → `unknown_provider` (404), `ai.ErrProviderDisabled` → `provider_disabled` (409), `ai.ErrEndpointBlocked` → `endpoint_blocked` (422).
- `handleTranscribe`: `engine:"ai"` and `!spec.VisionFor(creds.Model)` → 409 `no_vision`, message "`<model>` on `<provider name>` can't read photos. Read it offline instead.", before Acquire.
- `journal.Review` and `journal.Suggestions` gain `Provider string json:"provider,omitempty"`; `FallbackFrom` comes from `reply.FallbackFrom`.

- [ ] **Step 1: Tests** — `TestProvidersListHidesBaseURLForUsers`, `TestPutKeyPerProvider` (two providers, first becomes active, second not), `TestPutKeyUnknownProvider` → 404 `unknown_provider`, `TestPutKeyInvalidModel` (`a b`, 201 chars) → 422, `TestTestKeyCountsCall`, `TestDeleteActiveClearsSelection` (status reason `no_selection`, no automatic switch), `TestActiveRequiresKey` → 409 `no_key`, `TestCrossUserKeysInvisible` (user B's status, test, delete and activate for user A's provider do not touch A's row), `TestReviewUsesActiveProvider` (fake: review doc has `provider`), `TestTranscribeNoVision` → 409 `no_vision` and zero `ai_calls` rows, `TestNeverHTTP401` extended to every new route with `[[fake:401]]` and a bad key, `TestResponsesNeverContainKey` (all new routes, grep body for `sk-fake-good-key-0001`).
- [ ] **Step 2–4:** FAIL, implement, PASS (race, `./internal/api/... ./internal/journal/...`). **Step 5: Commit** `feat(api): per-provider AI keys and active provider`.

### Task 9: API — admin custom endpoints

**Files:** Create `server/internal/api/handlers_ai_custom.go`, `handlers_ai_custom_test.go`; modify `api.go`.

**Interfaces:** `POST /api/ai/custom-providers` (`CustomInput` JSON: `name, baseUrl, defaultModel, vision, keyRequired, structured, maxOutputTokens?`; body ≤ 4 KiB) → 201 spec; `PATCH /api/ai/custom-providers/{id}` (a body containing `baseUrl`, `name` or `keyRequired` → 422 `invalid_endpoint`); all routes 409 `provider_disabled` when `custom` is not enabled; `DELETE /api/ai/custom-providers/{id}` → 204, calls `Keys.DeleteProvider` and `Selection.ClearProvider` in one transaction. All via `requireAdmin` (403 `forbidden` JSON for non-admins, never 401 beyond the existing auth rule). `CheckEndpointURL` failures → 422 `endpoint_blocked` with the reason word in the message ("Private network addresses are off. Set QINQIN_AI_ALLOW_PRIVATE=1 to allow them.").

- [ ] **Step 1: Tests** — `TestCustomNonAdmin403`, `TestCustomBlockedURLs` (metadata, private without the switch, http public), `TestCustomPrivateWithSwitch`, `TestCustomPatchImmutableFields` (baseUrl, name, keyRequired), `TestCustomLookalikeName` (`OpenAI` → 422), `TestCustomDeleteRemovesKeysAndSelection` (two users with keys and one active → both gone, status `no_selection`), `TestCustomEndToEndWithAitest` (server with `AllowPrivate` and the `aitest` OpenAI handler on httptest: create endpoint, user stores key, activates, reviews; the fake server saw `Authorization: Bearer <key>` and the nonce-tag prompt).
- [ ] **Step 2–4:** FAIL, implement, PASS (race). **Step 5: Commit** `feat(api): admin-registered OpenAI-compatible endpoints`.

### Task 10: Web API client and the settings view model

**Files:** Modify `apps/web/src/lib/api/ai.ts`, `apps/web/src/lib/settings/aiSettingsView.ts`, `aiSettingsView.test.ts`.

**Interfaces:** `ai.ts`: types `ProviderInfo`, `ProvidersResponse`, `AiStatus` (with `active`, `keys`, `fake`); `getAiProviders()`, `getAiStatus()`, `saveAiKey(provider, key, model)`, `setAiModel(provider, model)`, `testAiKey(provider)`, `deleteAiKey(provider)`, `setActiveProvider(provider)`, `createCustomProvider(input)`, `updateCustomProvider(id, patch)`, `deleteCustomProvider(id)`. `aiSettingsView(status, providers)` → `{banner, rows: ProviderRow[] ({id, name, hint, model, modelLabel, active, vision, structuredLabel, state}), addable: ProviderInfo[] (not yet configured, grouped builtin/custom), usageLine, testProvider, canManageCustom}`; `privacyNote(name)` → "Your journal text, guidance and the photos you choose to read with AI are sent to <name> when you press a button. <name>'s terms apply."; `modelSuggestions(provider)`.

- [ ] **Step 1: Tests** — rows ordered active first; undecryptable row shows "Enter the key again"; `addable` excludes configured ids; `privacyNote('DeepSeek')` exact text; vision badge false for `deepseek-v4-pro`; banner texts for `no_secret`/`invalid_secret`/`no_provider` unchanged; `no_selection` banner "Choose which provider to use."
- [ ] **Step 2–4:** `npm --prefix <wt>/apps/web test` FAIL, implement, PASS; `run check` 0. **Step 5: Commit** `feat(web): AI provider client and settings view model`.

### Task 11: Settings → AI UI

**Files:** Modify `apps/web/src/lib/settings/AiSettings.svelte`; create `AiProviderForm.svelte`, `AiCustomEndpoints.svelte`, `AiSettings.dom.test.ts`.

**Interfaces:** Consumes Task 10. Layout (single column, works at 360 px): configured list (`<ul>`; each row: name, Active badge, hint, model, capability badges, buttons Make active / Test key / Change model / Remove with inline confirm `role="group"`), then "Add a provider" (`<select>` with `<optgroup label="Built in">`/`<optgroup label="Added by your admin">`, privacy note in an `aria-live="polite"` region tied to the selection, a link "Get a key" to `keyUrl` with `rel="noopener noreferrer"`, for custom endpoints the line "Added by your admin · <host>" next to the key field, `<input type="password" autocomplete="off">`, model `<input list>` + `<datalist>`), then for admins `AiCustomEndpoints` (form + list with Edit/Remove; the endpoint error message shown under the URL field with `aria-describedby`). Status messages in one `role="status"` element; errors in `role="alert"`. The key input is cleared after every save attempt, success or failure. Test-provider badge kept.

- [ ] **Step 1: jsdom tests** (mock `$lib/api/ai`): `renders configured rows with Active first`, `adding a key calls saveAiKey with the selected provider and clears the field`, `key field is password and never prefilled`, `Make active calls setActiveProvider and moves the badge`, `Remove asks for confirmation; Escape cancels and returns focus`, `custom endpoint form hidden for non-admins`, `endpoint_blocked message is linked to the URL field`, `privacy note names the chosen provider`, `keyless custom endpoint allows an empty key`, `custom endpoint key form shows the admin and host line`, `disabled provider row offers Remove only`.
- [ ] **Step 2–4:** FAIL, implement, PASS; all three web gates 0. **Step 5: Commit** `feat(web): choose and manage AI providers in Settings`.

### Task 12: Journal UI — who answered, no-vision photos

**Files:** Modify `apps/web/src/lib/plugins/journal/OverallReview.svelte`, `IdeasPanel.svelte`, `PhotoImport.svelte`, `photoFlow.ts`, `photoFlow.test.ts`, `types.ts`, `aiErrors.ts`, `aiErrors.test.ts`; create `OverallReview.dom.test.ts`.

**Interfaces:** `Review.provider?: string`, `Suggestions.provider?: string`; `answeredBy(model, providerName?, fallbackFrom?)` → "Answered by gpt-6-luna · OpenAI", "(fallback)" suffix kept; provider names from `getAiProviders()` (cached in the journal store; unknown id shows the id). `photoFlow`: `aiReadable(status)` = `available && active.vision`; when false the "Read with AI" button is replaced by the text "<model> can't read photos." and "Read offline" is preselected. `aiErrors`: `no_vision` (offlineInstead true), `unknown_provider`, `endpoint_blocked`, `forbidden` fallbacks; `no_selection` → settings link.

- [ ] **Step 1: Tests** — `answeredBy` table; `aiReadable` false for no-vision; jsdom `OverallReview shows provider name`; `aiErrorView` for `no_vision` sets `offlineInstead`.
- [ ] **Step 2–4:** FAIL, implement, PASS; web gates 0. **Step 5: Commit** `feat(journal): show the answering provider; offline reading for models without vision`.

### Task 13: Docs, fake server tool, real-app check

**Files:** Modify `README.md` (section "Journal and AI": providers table with base URLs and what is sent; "Custom endpoints" with the threat model in three sentences, `QINQIN_AI_ALLOW_PRIVATE`, `QINQIN_AI_PROVIDERS` and the legacy `QINQIN_AI_PROVIDER=anthropic` meaning, proxies (built-ins yes, custom no), Lumo note; API table rows for the new routes; remove `/api/ai/key`), `docker-compose.yml` (commented `QINQIN_AI_ALLOW_PRIVATE: "1"` with the warning and `QINQIN_AI_PROVIDERS: anthropic,openai,gemini,custom` as an example). Create `server/tools/fakeai/main.go` (serves `aitest` OpenAI and Gemini handlers on `-addr`; like `ai.Fake`, a key containing `bad` gets 401 and `[[fake:…]]` markers pick canned errors; logs request paths and whether `Authorization` was present, never the value), and the handoff note `docs/superpowers/handoffs/2026-11-15-ai-providers-handoff.md` listing, per built-in provider, the owner's real-key test: store key, Test key, Review, Ideas, Read with AI (vision models), and which UNVERIFIED items each run confirms.

- [ ] **Step 1:** README and compose edits; `go vet ./tools/...` via the Go gate.
- [ ] **Step 2: Real-app check without a browser** (no real AI API, no Playwright). The image build compiles Go: run it alone, then start `fakeai` only after it finishes (one Go job at a time).
  ```sh
  docker build -t qinqin:providers <wt>
  docker network create qq-ai
  docker run -d --name fakeai --network qq-ai -u $(id -u):$(id -g) -e HOME=/tmp -e GOPATH=/gp -e GOCACHE=/gc -v <sp>/gp-m:/gp -v <sp>/gc-m:/gc -v <wt>:/src -w /src/server golang:1.26 go run ./tools/fakeai -addr :9000
  SECRET=$(head -c 32 /dev/urandom | base64)
  docker run -d --name qq-prov --network qq-ai -p 127.0.0.1:8087:8080 -e QINQIN_SECRET="$SECRET" -v <sp>/prov-data:/data qinqin:providers
  ```
  With curl (`-s -o /dev/stderr -w '%{http_code}\n'`): register the admin and a second user; `GET /api/ai/providers` lists the eight ids and `canManageCustom` true for the admin only; as admin `POST /api/ai/custom-providers {"name":"Local","baseUrl":"http://fakeai:9000/v1","defaultModel":"fake-model","vision":true,"keyRequired":true,"structured":"json_schema"}` → **422 `endpoint_blocked`** (private off); same with `baseUrl":"http://169.254.169.254/v1"` → 422. Restart `qq-prov` with `-e QINQIN_AI_ALLOW_PRIVATE=1`; the fakeai URL → 201; metadata URL → still 422. As the second user: `PUT /api/ai/keys/<custom id> {"key":"sk-fake-good-key-0001"}` → 200, status `active.provider` = the custom id; create a workspace and an entry with the plugin data route, `POST /api/journal/review` → 200 with `provider` and `model` `fake-model`; `PUT /api/ai/keys/<custom id> {"key":"sk-fake-bad-key-0001xxxxx"}` → 422 `key_rejected` (not 401); `PUT /api/ai/active {"provider":"openai"}` → 409 `no_key`; `DELETE /api/ai/keys/<custom id>` → 204 and status reason `no_selection`. Then `docker logs qq-prov` and `docker logs fakeai` and `grep -a -c 'sk-fake-good-key-0001' <sp>/prov-data/*.db*` → all 0 occurrences of the key.
- [ ] **Step 3:** Also start `qinqin:providers` with `QINQIN_AI_PROVIDER=fake` and check `GET /api/ai/status` → `fake: true` after storing an `openai` key, and a review answers with the fake.
- [ ] **Step 4:** Clean up (`docker rm -f qq-prov fakeai; docker network rm qq-ai`). Record results in the ledger.
- [ ] **Step 5: Commit** `docs: AI providers, custom endpoints and the owner's real-key checklist`.

## Risks and open points

- Several model ids and the Gemini REST schema field are UNVERIFIED (spec, Research); they live in one registry file and the owner's real-key run confirms them.
- Custom endpoints never use an HTTP proxy (the guard needs the dialled IP); built-ins honour `HTTPS_PROXY` as Anthropic does today.
- Gemini's `generateContent` is labelled "Legacy"; watch for a sunset date and port to Interactions then.
- In-app admins are trusted as operators: an admin can still register an endpoint they control; users see "Added by your admin · <host>" before typing a key.
- OpenAI's `data:` URL images and DeepSeek `/models` are UNVERIFIED in the docs we read.

## Appendix: Provider reference (official docs, checked 2026-11-15)

Model ids change fast; the registry only *suggests* them and the learner may type any id. Quotes came through a summarising fetch tool, so a few are close paraphrases.

- **OpenAI** (developers.openai.com/api/reference/resources/chat, /docs/guides/
  structured-outputs, /docs/models): `POST /v1/chat/completions`, `Authorization:
  Bearer`; Chat Completions is not deprecated (Responses is "recommended" for new
  projects). `response_format: json_schema` (strict: every field required,
  `additionalProperties: false`, no `allOf/not/if`); `max_tokens` is deprecated
  for `max_completion_tokens`; `message.refusal`; finish reasons `stop`,
  `length`, `content_filter`. Models: `gpt-6-astra` (flagship), `gpt-6-luna`
  (cheapest); "GPT-6.1 Sol" as `gpt-6.1-sol` UNVERIFIED. Base64 `data:` URLs in
  `image_url` UNVERIFIED for OpenAI itself (shown in Google's compat docs).
- **Google Gemini** (aistudio.google.com/api-reference, /docs/structured-output,
  /docs/openai, /docs/models): `generateContent` is now labelled "Legacy" next to
  a new Interactions API, but "Existing integrations remain supported" and no
  sunset is given. `x-goog-api-key`; `systemInstruction`; `inlineData`; the
  reference says `responseSchema` is "An internal detail. Use
  `responseJsonSchema`" (the REST shape — `generationConfig.responseMimeType` +
  `responseJsonSchema` vs the newer `responseFormat.text` — is UNVERIFIED);
  `finishReason` MAX_TOKENS/SAFETY/RECITATION/BLOCKLIST/PROHIBITED_CONTENT/SPII/
  IMAGE_SAFETY; `promptFeedback.blockReason`. The OpenAI-compatible endpoint
  (`/v1beta/openai/`) is "still in beta", and Google writes "If you aren't
  already using the OpenAI libraries, we recommend that you call the Gemini API
  directly"; raw `json_schema` requests are not documented there. Stable models
  `gemini-3.8-flash`, `gemini-3.5-flash-lite`; `gemini-2.5-*` reroute on 2026-12-01.
- **DeepSeek** (api-docs.deepseek.com, /guides/json_mode, /quick_start/pricing):
  base `https://api.deepseek.com`, OpenAI format; `json_object` only, the prompt
  must contain "json", and content "may contain only spaces" even with `stop`.
  Models `deepseek-flash` (vision) and `deepseek-v4-pro` (no vision); `/models`
  UNVERIFIED.
- **Mistral** (docs.mistral.ai/api, /capabilities/vision): `https://api.mistral.ai/v1`,
  OpenAI-like, `json_object` and `json_schema` (no `strict` mentioned), base64
  images. Current ids UNVERIFIED (registry suggests `mistral-large-latest`,
  `mistral-small-latest`).
- **xAI** (docs.x.ai/docs/guides/structured-outputs): `https://api.x.ai/v1`,
  `json_schema` guaranteed; model `grok-4.7`.
- **Groq** (console.groq.com/docs/structured-outputs): `https://api.groq.com/openai/v1`;
  strict `json_schema` only on some models (e.g. gpt-oss) → sent non-strict.
- **OpenRouter** (openrouter.ai/docs/features/structured-outputs):
  `https://openrouter.ai/api/v1`; `json_schema` support is "determined per
  endpoint", so requests send `provider.require_parameters: true`.
- **Ollama** (docs.ollama.com/api/openai-compatibility): `http://localhost:11434/v1`,
  JSON mode yes, `json_schema` on that endpoint UNVERIFIED, base64 images yes.
- **Anthropic** (platform.claude.com/docs): structured outputs GA in
  `output_config.format`; Opus/Sonnet/Haiku 5.5 current; a new
  `anthropic-version: 2026-10-21` exists, `2023-06-01` still listed. Adapter unchanged.
- **Lumo (Proton)**: **no public API today.** Proton's 2026 autumn/winter
  roadmap (proton.me/blog/2026-autumn-winter-roadmaps) says "We're releasing the
  Lumo API…" with no date, docs or OpenAI-compatibility statement.
- **Others**: Cohere has an OpenAI-compat API (`/compatibility/v1`, no images) →
  usable as a custom endpoint in `json_object` mode. Perplexity's API is
  agent/Responses-shaped (Chat Completions UNVERIFIED) → not built in. Le Chat is
  Mistral's app. Copilot and the ChatGPT app have no chat API of their own
  (UNVERIFIED; Azure OpenAI works as a custom endpoint).
- **Go SDKs** (go.mod on main): `openai-go/v3` Apache-2.0 but pulls Azure
  azcore/azidentity/MSAL and aws-sdk-go-v2; `google.golang.org/genai` Apache-2.0
  but pulls cloud.google.com/go/auth, grpc, protobuf; `anthropic-sdk-go/v2`
  Apache-2.0 (already used). Licences pass; the weight, and their own HTTP stacks
  that would bypass the SSRF guard, do not.
