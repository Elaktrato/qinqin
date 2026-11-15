# Journal AI: Choose Any Provider — Design

Date: 2026-11-15. Status: written autonomously (decision rule: licensing first, then the best
experience for the learner even at higher development cost); awaits the
owner's review. Issue: #87. Builds on `2026-11-14-journal-design.md` (#46),
whose rulings stay unless this document replaces them by name.

## Intent and why

Owner, verbatim: "Currently it only has Anthropic. I'd like to have the option
to pick any AI Agent I like, so Gemini, Lumo, ChatGPT, Deepseek or whatever
should be possible to add. Can we get that done?"

The learner pays with their own key and wants the account they already have,
or a cheaper or local model. "Whatever" means a fixed list is not enough: an
admin-added OpenAI-compatible endpoint must work too.

## Goals

- The learner picks a provider and a model in Settings → AI, stores a key per
  provider, and makes one of them active. Review, Ideas and Read with AI use it.
- Built in: Anthropic (kept), OpenAI (ChatGPT's API), Google Gemini, DeepSeek,
  Mistral, xAI, Groq, OpenRouter. Plus custom OpenAI-compatible endpoints
  (Ollama, LM Studio, vLLM, Together, a company gateway…) registered by the admin.
- Existing Anthropic keys keep working after the upgrade without re-entry.
- The page says which provider and model answered, and what is sent where.
- Missing capabilities degrade clearly: no vision → offline reading is offered.

## Non-goals

- Lumo (Proton): no public API (see Research); only the custom endpoint, should
  Proton ever offer an OpenAI-compatible one. Same for apps without an API.
- Failover between providers, per-workspace providers, streaming, tool use,
  chat, live model catalogues (any model id may be typed).

## Anti-goals

- A key reaching the browser, logs, error strings, plugin data, backups, or a
  host other than the one it was stored for (redirects included).
- The server used as a proxy into its own network (SSRF) by any user.
- An existing stored key becoming unreadable because of this change.
- A provider's reply in a different shape slipping past validation into the page.

## Research (checked 2026-11-15, official docs only)

Full findings with quotes and URLs are in the plan's appendix "Provider
reference"; UNVERIFIED items must be confirmed by the owner's real-key run.

- OpenAI, DeepSeek, Mistral, xAI, Groq, OpenRouter, Ollama, Cohere all speak
  Chat Completions; `json_schema` everywhere except DeepSeek (`json_object`
  only, "may contain only spaces") and Cohere/Ollama (JSON mode; schema
  UNVERIFIED). Groq strict only on some models; OpenRouter needs
  `provider.require_parameters: true`.
- Gemini: native `generateContent` (labelled "Legacy" beside the new
  Interactions API, "Existing integrations remain supported") with
  `responseJsonSchema`; its OpenAI endpoint is "still in beta" and Google
  recommends the native API.
- Anthropic: unchanged models (Opus/Sonnet/Haiku 5.5), structured outputs GA.
- **Lumo (Proton): no public API today.** The 2026 autumn/winter roadmap
  (proton.me/blog/2026-autumn-winter-roadmaps) only announces "the Lumo API"
  with no date, docs or compatibility statement. Copilot and the ChatGPT app have
  no chat API of their own; Perplexity is Responses-shaped (not built in).
- Go SDKs are Apache-2.0 but heavy (openai-go: Azure + AWS trees; genai: Cloud
  auth + gRPC) and bring their own HTTP stacks → plain `net/http`.

## Approaches

- **A. Three hand-written adapters: Anthropic (SDK, unchanged), OpenAI-compatible
  and Gemini native, both plain `net/http` (CHOSEN).** Exact error and refusal
  mapping per family, one guarded HTTP client for everything new, no new
  dependencies. Costs about 600 lines of adapter code plus tests.
- **B. Gemini through its OpenAI-compatible endpoint.** Less code, but beta,
  raw `json_schema` undocumented, Google recommends the native API, and
  block/finish reasons are lost (vague refusals). Rejected; still usable as a
  custom endpoint.
- **C. Multi-provider library or official SDKs.** Heavy trees, own HTTP stacks
  outside the SSRF guard. Rejected.

## Design

### Registry (`server/internal/ai/registry.go`, Go data)

`ProviderSpec{ID, Name, Kind ("anthropic"|"openai"|"gemini"), BaseURL,
KeyRequired, KeyURL (where to get a key), DefaultModel, Models []ModelSpec,
Structured ("json_schema"|"json_object"|"prompt"), Strict bool, Vision bool,
TokenField ("max_completion_tokens"|"max_tokens"), MaxOutputTokens,
ValidateBy ("models"|"model"|"chat"), Extra (fixed request fields, e.g.
OpenRouter's `provider.require_parameters`)}` and
`ModelSpec{ID, Label, Vision *bool}` (nil inherits the provider's flag).
Custom endpoints are rows (below) turned into the same struct (`Custom: true`).
`GET /api/ai/providers` returns the merged list (custom base URLs as host only
for non-admins) plus `{canManageCustom, privateAllowed}`. Any model id is
accepted (1–200 chars, `[A-Za-z0-9._:/@-]`); a free-text id gets the
provider's default capabilities.

### Data (migration `030_ai_providers.sql`)

- `ai_keys` is rebuilt with `PRIMARY KEY (user_id, provider)` (SQLite: new
  table, copy, drop, rename); columns unchanged, so every existing row keeps
  `provider = 'anthropic'` and its ciphertext. Built-in AAD stays
  `qinqin/ai_keys/v1|user=<id>|provider=<id>`: old rows decrypt, a key never
  opens as another provider's, rotation works per row (`AND provider = ?`).
  **Custom keys also bind the base URL**: `qinqin/ai_keys/v2|user=<id>|
  provider=<custom id>|base=<normalised URL>`, so a database writer without
  `QINQIN_SECRET` cannot repoint an endpoint to harvest keys (none exist yet,
  so no re-encryption). Keyless custom endpoints store a sealed empty key.
- `ai_selection(user_id PRIMARY KEY, provider, updated_at)`: the active
  provider **per user** (keys and costs are personal; explanation language and
  guidance stay per workspace). The model stays per key row. The migration
  inserts `(user_id, 'anthropic')` for every existing key.
- `ai_custom_providers(id TEXT PRIMARY KEY /* "custom-" + 10 random base32 */,
  name, base_url, default_model, vision INTEGER, structured TEXT,
  max_output_tokens INTEGER NULL, key_required INTEGER, created_by, created_at)`.
  Ids are never reused. Deleting one deletes its `ai_keys` rows and the
  selections pointing at it.
- `ai_calls` gains `provider TEXT NOT NULL DEFAULT 'anthropic'`.

### API (all need a bearer token; never HTTP 401 for provider errors)

| Route | Meaning |
|---|---|
| `GET /api/ai/providers` | registry, see above |
| `GET /api/ai/status` | as today plus `active {provider, model, vision, structured}`, `keys: StoredKey[]`; `key` stays the active key so the journal page keeps working; `provider` stays `fake` under the fake switch |
| `PUT /api/ai/keys/{provider}` | `{key?, model?}`; a key is validated (one call, counts toward 30/h) then stored; model only → changes model; the first configured provider becomes active |
| `POST /api/ai/keys/{provider}/test` | re-validates the stored key (counts) |
| `DELETE /api/ai/keys/{provider}` | removes it; if it was active, the selection is cleared (no silent switch to another provider) |
| `PUT /api/ai/active` | `{provider}`; must have a stored key → else 409 `no_key` |
| `POST/PATCH/DELETE /api/ai/custom-providers[/{id}]` | admin only (403 otherwise); base URL, name and key-required are immutable after creation (PATCH: default model, vision, structured mode, max tokens); names may not equal a built-in id or name (case-insensitive) |

The old `/api/ai/key` routes are removed (only this web client uses them).
New codes: `unknown_provider` 404, `no_vision` 409, `provider_disabled` 409,
`endpoint_blocked` 422, `forbidden` 403; `invalid_model` follows the free-text rule.

### Adapters

All implement the existing `Provider` interface, picked by the active
provider's `Kind`; `Credentials` gains `Provider` and `BaseURL` (still
redacting). Prompts, schemas, nonce tags and validation stay provider-neutral;
schema-less modes append the schema to the system prompt as a constant.

- **Anthropic** — unchanged apart from the built-in client (SDK, structured
  outputs, refusal fallback on Opus/Sonnet; `ReviewReply.FallbackFrom` is now set by this adapter alone,
  because other providers report dated snapshot ids that are not fallbacks).
- **OpenAI-compatible** — `POST {base}/chat/completions`, `Authorization:
  Bearer`, `response_format` `json_schema` (our schemas already satisfy strict
  mode), `json_object` (DeepSeek) or none (`prompt`). Replies are decoded
  strictly; on failure **one repair request** returns the bad output and the
  decode error, recorded as its own `ai_calls` row. Images as `image_url` data
  URLs; token field per registry. `message.refusal` or `content_filter` →
  `refused`; `length` → `truncated`.
- **Gemini** — `POST {base}/models/{model}:generateContent`, `x-goog-api-key`,
  `systemInstruction`, `responseMimeType` + `responseJsonSchema`, `inlineData`;
  `blockReason` or a safety `finishReason` → `refused`; MAX_TOKENS → `truncated`.

Error mapping (one table per family, all into today's codes): 401/403 →
`key_rejected`; Gemini 400 with `API_KEY_INVALID` → `key_rejected`; 402 or
OpenAI's `insufficient_quota` 429 → `quota`; 404 → `model_unavailable`; 429
otherwise, 5xx, 529, timeouts, transport errors → `busy` with `Retry-After`;
3xx → `bad_request` ("the endpoint redirected"); other 4xx → `bad_request`.
Provider error bodies are read (capped) for the code field only and never
logged or returned; logs carry kind, provider id, status and code.

Validation: `models` = `GET {base}/models` with the key (free; the model must
be listed where the list is authoritative — OpenAI, DeepSeek, Mistral, xAI,
Groq); `model` = Gemini `GET /models/{model}`; `chat` = a 1-token chat call
(OpenRouter, whose `/models` needs no key and so proves nothing); custom
endpoints try `/models`, then `chat` on 404. Caching: the byte-stable system
prompt suits OpenAI's, DeepSeek's and Gemini's automatic caching; cached-token
counts map into `Usage.CacheReadTokens`.

### Outbound HTTP guard (`server/internal/ai/netguard.go`)

Threat model: any user can trigger calls; only admins name URLs; a bad URL or
DNS record could aim at cloud metadata, a router, or another container.

- Custom endpoints: admin only; absolute URL, no userinfo/query/fragment;
  `https`, or `http` to loopback/private only with `QINQIN_AI_ALLOW_PRIVATE=1`.
- **Custom client**: `Proxy: nil`, a `net.Dialer.Control` hook that checks the
  **actually dialled IP** (defeats DNS rebinding — no resolve-then-trust),
  always blocking unspecified, link-local (169.254/16, fe80::/10, incl.
  169.254.169.254), multicast, broadcast, 100.100.100.200, fd00:ec2::254 and
  IPv4-mapped forms of these; loopback, RFC 1918, CGNAT 100.64/10 and fc00::/7
  only with `QINQIN_AI_ALLOW_PRIVATE=1`. Custom endpoints never use a proxy
  (through a proxy the dialled IP is the proxy's, so the check would be blind).
- **Built-in client** (all three adapters, Anthropic included via
  `option.WithHTTPClient`): hosts are fixed in code, so it keeps
  `http.ProxyFromEnvironment` (today's Anthropic behaviour, egress proxies keep
  working) and blocks only the always-blocked set on direct dials.
- Both: no redirects are followed (`CheckRedirect` → `ErrUseLastResponse`), so
  a key never travels to another host — today the SDK's default client follows
  redirects with `x-api-key`, which this closes. Responses capped at 8 MiB, dial
  and TLS 10 s, whole call 150 s (existing timeout).
- Operator control: `QINQIN_AI_PROVIDERS` (comma list of built-in ids plus
  `custom`; default all). An explicit legacy `QINQIN_AI_PROVIDER=anthropic`
  means `QINQIN_AI_PROVIDERS=anthropic` (no silent widening of where data may
  go) and logs a hint; `fake` keeps its meaning. A disabled provider's keys stay
  stored, are listed as "turned off by the server" with Remove only, and a
  selection pointing at it reads as reason `provider_disabled`.
- Admin trust: in-app admins are treated as operators, but the UI shows
  "Added by your admin · <host>" wherever a key for a custom endpoint is typed,
  and the immutable name/URL rules above stop bait-and-switch.
- README and compose document both switches; `QINQIN_AI_ALLOW_PRIVATE=1`
  warns that the admin's endpoints can then reach the LAN.

### Limits and cost

Unchanged: 30 calls per user per rolling hour over all providers (validation
and repairs count), one in flight per user, 5,000 characters per review; the
usage line stays aggregate.

### Web (Settings → AI and the journal)

- **Configured providers**: name, hint, model, badges ("Reads photos",
  "Structured replies", Active), Make active, Test key, Change model, Remove.
- **Add a provider**: a select (keyboard friendly, works on phones) grouped
  "Built in" / "Added by your admin"; then the privacy note "Your journal text,
  guidance and photos you choose to read with AI are sent to <Name> when you
  press a button; <Name>'s terms apply" with a link to `KeyURL`; a password key
  field (cleared after save, never shown again; optional for keyless custom
  endpoints); a model field with a `datalist` of suggestions plus free text.
- **Admin only**: "Custom endpoint" form (name, base URL, default model, reads
  photos?, structured mode, key required?) and a list with Edit/Remove; the
  `endpoint_blocked` message says which rule refused it.
- "Test provider — no real AI" badge stays under `QINQIN_AI_PROVIDER=fake`,
  which now replaces **every** adapter with the fake.
- Journal: "Answered by <model> · <provider>" ("(fallback)" as now); without
  vision, Read with AI becomes "<model> can't read photos" with Read offline;
  reviews and suggestions store `provider` next to `model`.

## Testing (no real AI API is ever called)

httptest servers with canned replies shaped like the docs' examples, per
family: request-shape, reply, refusal, truncation and error tables; SSRF tests
with a custom resolver (metadata, private with/without the switch, rebinding,
cross-host redirect never sees the key); key-leak greps of logs, errors, JSON
and the DB file; a migration test from 029 with an old Anthropic key; jsdom
tests for Settings; a curl run against the built server with a fake
OpenAI-compatible server as a custom endpoint. The owner tests real keys.

## My calls (made without asking; reject any)

Every call is a "Ruling" line in the plan with its why and cost. Builder check
done by a fresh reviewer; its four questions are settled above (AAD v2 for
custom keys, immutable custom name/URL/key-required and no built-in look-alike
names, Anthropic on the no-redirect built-in client with proxy support kept,
`QINQIN_AI_PROVIDERS` plus the legacy `QINQIN_AI_PROVIDER=anthropic` meaning).

## Left to the builder

Canned fixtures, UI copy beyond the strings above, layout details.
