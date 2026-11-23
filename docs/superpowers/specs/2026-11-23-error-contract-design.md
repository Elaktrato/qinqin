# Pre-Android hardening — one error contract: `{error, message}` everywhere (#168, part of #166)

`docs/contracts/auth/errors.json` says every error body is `{"error": code, "message": English sentence}` and
`docs/contracts/overview.md` tells clients to branch on and translate the code. The server does not keep that
promise: about 350 `http.Error` calls answer `text/plain`, three writers (`writeAuthError`, `jsonError`,
`writeJournalError`) duplicate each other, `badBody` answers text while `readBody`/`writeTooLarge` answer an
uncoded JSON `{"error": "request body too large"}`, and some JSON bodies carry an English sentence in `error`
(highlights, audio, workspace settings). The web client keeps the raw body as `ApiError.message`, sniffs it
(`JSON.parse` for restrictions, a text compare for "workspace not found") and about 35 places show that raw
English text, or English developer errors, to the learner. Android is about to be written against this API,
so it must be one rule, written once.

## 1. Server: one writer, one decoder

- `writeError(w, status, code, message string, extra ...map[string]any)` in `server/internal/api/errors.go`
  is the only way to answer an error. It sets `Content-Type: application/json`, writes the status and
  `{"error": code, "message": message}` plus any extra members (`attemptsLeft`, `existingId`, `category`,
  `smtpCode`, `workspaceLanguage`, `bookLanguage`). An extra member never replaces `error` or `message`.
  Ruling: extra members ride beside the two fixed ones instead of a nested `details` object — the auth
  routes already send `attemptsLeft` and `category` that way and clients read them there; one more shape
  would break them — cost if wrong: a future detail named `error` or `message` would have to be renamed.
- `writeAuthError`, `jsonError` and `writeJournalError` are removed; their call sites call `writeError`
  (same arguments). `writeTooLarge` stays as a one-line helper for `413 too_large`.
- `decodeBody(w, r, v, limit, strict) bool` reads at most `limit` bytes and decodes JSON into `v`; a body over
  the cap is `413 too_large`, anything else that fails (bad JSON, wrong types, with `strict` an unknown
  field or trailing data) is `400 bad_request`. `readBody` keeps returning the raw bytes for routes that
  parse in two steps; both answer through `writeError`. `badBody(w, err)` stays for routes that read
  multipart forms, coded the same way. Each route keeps its current strictness (most are lenient, a few
  use `DisallowUnknownFields`); this item changes the body of the answer, not what is accepted.
- **Status codes stay the same.** Only the body and the Content-Type change.
  Ruling: one exception — a pack import that fails for a reason that is not the pack (a disk or database
  error) answered `400 "import failed — see the server log"`; it now answers `500 internal`, because the
  pack was fine and a 400 told the admin to fix it — cost if wrong: a script that expected 400 there sees
  500 (it still sees a failure).
- `message` is an English sentence for developers and logs. It never carries a path, SQL, a Go error string
  of a lower layer, a token or a stack. Where today's text is a fixed sentence it is kept (capitalised and
  ended with a full stop); where it was `err.Error()` of a validation error of our own package (search
  syntax, plugin manifest, sync push shape, pack validation with the data directory already stripped), it is
  kept because it names the field the client got wrong and no internal state.
  Ruling: validation messages of our own packages may pass through, wrapped errors of the standard library
  or the driver never — the validators are written for users of the API and the alternative (one message per
  rule) would duplicate them — cost if wrong: a validator that one day quotes internal state leaks it; the
  static test (section 4) cannot see that, review must.

## 2. Unmatched routes and file serving

- A request under `/api/` that no pattern matches answers `404 not_found`, a known path with a wrong method
  `405 method_not_allowed` (with the mux's `Allow` header kept). `handler()` wraps the mux: it asks
  `mux.Handler(r)` for a pattern and, when there is none, lets the mux answer into a recorder and rewrites
  the status into `writeError`. No route is added, so the route table stays the one registry.
- `http.ServeContent` (audio clips, backup downloads, font slices, stroke files, package downloads) writes
  its own `416`, `412` and `304`. The `4xx` of these go through a small writer wrapper that turns a text
  body into `writeError` (`416 range_not_satisfiable`, `412 precondition_failed`); a `304` has no body and is
  left alone.
  Ruling: wrap ServeContent instead of reimplementing Range handling — Range, If-Range and conditional
  requests are subtle and the standard library gets them right — cost if wrong: a future net/http that
  writes a body before WriteHeader would slip past the wrapper (the route walk sends a bad Range to catch it).
- The SPA handler (`internal/webdist`) is not the API and keeps its text answers (a 405 on a POST to a page).
  Ruling: out of scope — it is the static web app, browsers navigate to it and never parse its body — cost if
  wrong: none for API clients.

## 3. The catalogue

`docs/contracts/auth/errors.json` stays the one catalogue. Existing codes and statuses are unchanged
(`not_found` on a foreign sync workspace, `study_row_invalid`, `token_*` and the admin re-authentication codes
keep exactly their bodies). New codes, each with one status:

| Code | Status | Used for |
|---|---|---|
| `conflict` | 409 | a generic state conflict without a more specific code (a built-in plugin id) |
| `method_not_allowed` | 405 | a known API path with another method |
| `range_not_satisfiable` | 416 | a download Range outside the file |
| `precondition_failed` | 412 | an If-Match / If-Unmodified-Since that fails on a download |
| `not_implemented` | 501 | a library source that has no browse list |
| `workspace_not_found` | 404 | the workspace named by the request does not exist or is someone else's |
| `workspace_exists` | 409 | a workspace with that name already exists |
| `last_workspace` | 409 | deleting the only workspace |
| `language_unknown` | 422 | a workspace for a language the server has not registered |
| `language_built_in` | 409 | removing a built-in language |
| `language_in_use` | 409 | removing a language a workspace still uses |
| `pack_invalid` | 400 | a pack upload that is not a valid pack (the message names the rule) |
| `pack_type_unsupported` | 422 | a pack type this route does not install (audio packs, an unknown type) |
| `pack_staged` | 429 | a staged pack waits: finish or discard it first |
| `pack_import_running` | 409 | a pack import is already running |
| `import_busy` | 429 | a library source import is already running for this user |
| `book_exists` | 409 | the book is already in the library |
| `bookmark_limit` | 409 | the book has 200 bookmarks |
| `highlight_limit` | 409 | the book has the maximum number of highlights |
| `highlight_overlap` | 409 | the text is already highlighted (`existingId` names it) |
| `epub_unreadable` | 422 | the upload or the source's file is not a readable EPUB |
| `language_mismatch` | 422 | the book's language is not the workspace's (`workspaceLanguage`, `bookLanguage`) |
| `source_unavailable` | 502 | a library source did not answer |
| `source_language_unavailable` | 422 | the source has no books in the workspace language |
| `plugin_no_data` | 403 | the plugin does not declare owns-data |

Everything else maps by status: 400 `bad_request`, 404 `not_found`, 409 `conflict`, 413 `too_large`,
422 `invalid_request`, 500 `internal`.
Ruling: domain codes only where a learner or an administrator can cause the failure and the screen should say
something specific; a parameter a correct client never sends wrong stays `bad_request` with a message that
names the parameter — cost if wrong: Android shows the generic "request was not valid" text where a specific
one would help, and a code is added later (adding codes is backwards compatible).
Ruling: one status per code; a code written with another status fails the static test (the catalogue's
`status` field is what the client may rely on). The few existing exceptions the catalogue already describes
(`code_invalid` 401 on anonymous steps, `bad_request` 422 from the AI provider) are written through a status
variable and keep their documented meaning — cost if wrong: none new.
Ruling: the workspace 404 of the routes that answered the text "workspace not found" gets the new code
`workspace_not_found`; sync pull/push and token creation keep their existing `not_found` "No such workspace."
because the contract already fixes those — cost if wrong: two codes mean "no such workspace"; the web treats
`workspace_not_found` as "workspace gone" and sync's `not_found` as before (sync never triggered the
workspace-gone switch).

## 4. Tests

- **Static (AST) test** `errors_static_test.go`: over every non-test file of `internal/api`, no call of
  `http.Error`, `http.NotFound`, `http.Redirect` with an error status, or `writeJSON` with a map literal that
  has an `"error"` key; every `writeError` call with a literal code names a catalogue code and, with a status
  constant, the catalogue's status; a non-literal code is allowed only in the functions listed in the test
  (the AI and pack error mappers), each listed with the codes it can produce, checked against the catalogue.
  The test replaces the writeAuthError scan of `TestAuthErrorCatalogueIsCoherent`.
- **Dynamic route walk** `errors_walk_test.go`: every pattern of `routes()` is called as anonymous, a user and
  an admin with: no body, `{}`, a malformed body `{`, path wildcards `999999` and `x`, a query
  `?workspace=999999`, and a bad `Range` on the file routes; plus unmatched paths and wrong methods. Every
  answer with status ≥ 400 must be `application/json` decoding to a non-empty `error` that is in the
  catalogue and a non-empty `message`.
  Ruling: both a static and a dynamic test — the walk cannot reach every branch (a full disk, a source
  outage), the static test cannot see a writer that slips past it; together they cover a new route and a new
  branch — cost if wrong: test time (the walk runs ~1 s).
- Existing tests that compared plain-text bodies change to compare the code; the contract fixtures that
  encoded text (`sync/legacy-pull.json`, `sync/push-result.json`, `events/envelope.json`,
  `settings/workspace-settings.json`) change from `text` to `error` + `messageContains`.

## 5. Web

- `ApiError` parses its body once, in the constructor: `code` (the `error` string of a JSON object body, else
  undefined) and `body` (the parsed object). `message` stays the raw text for logs and the console only.
  `apiErrorBody`, the restriction check, the highlight overlap and the workspace-gone check read `code` /
  `body` instead of parsing the text again; `isWorkspaceGoneResponse` is `status 404 && code ===
  'workspace_not_found'`.
  Ruling: parse in the constructor rather than in `request()` — the hundreds of tests that build
  `new ApiError(status, body)` keep working and there is one parser — cost if wrong: none.
- Every screen shows errors through `errorText(err, fallback)` (`lib/api/apiErrors.ts`): the catalogue text of
  a known code, the text of a `UserError`, else the screen's fallback. The local `message(err)` helpers,
  `errorMessage` copies and `err instanceof Error ? err.message : …` expressions are replaced.
- `UserError` (`lib/api/userError.ts`) is an `Error` that carries a catalogue key and arguments. The
  user-facing `throw new Error('…')` sites (optimizer client, study session, reader, scheduling, sign-in,
  frequency ranks) throw it, so `errorText` shows translated text.
- `apiError.<code>` keys for every new code in `en.json` and `API_ERROR_KEYS` (the catalogue test already
  fails on a missing one).
- **Lint**: a fourth rule `errmsg` in `lib/i18n/lint.ts` / `hardcoded.test.ts` flags `<name>.message` of a
  caught value (`err`, `e`, `error`, `ex`, `reason`, `cause`) and `String(err)` in non-test code under `lib/`
  and `routes/`. A legitimate use (a worker posting to its client, a console line) is allowlisted with a reason
  in `allowlist.json`.
  Ruling: a regex rule, not a type-aware one — the existing lint is heuristic by ruling and the names of caught
  values are conventional in this codebase; a renamed variable slips through but review sees it — cost if
  wrong: an occasional allowlist entry or a missed case.
- Admin pack upload: the pack validator's English reason is the only way an administrator learns what is wrong
  with a pack. The pack manager shows the catalogue text of `pack_invalid` and, under it, the server's
  sentence in a `details` element labelled "Server detail (English)".
  Ruling: one allowlisted place shows a server message, to an administrator, marked as English detail —
  translating every validator rule is not worth it for a rare admin task, and hiding the reason makes a pack
  impossible to fix — cost if wrong: an English sentence on an otherwise translated admin page.

## 6. Old clients

- No route keeps `text/plain`. Ruling: the web shell is served by the same server, so a new web never meets an
  old server; an old shell (an installed PWA before its update) already parses JSON for restrictions and the
  journal and AI routes, and on the screens that printed the raw body it now prints the JSON text instead of
  the English sentence until it reloads to the new shell; its workspace-gone switch does not fire until then —
  cost if wrong: a cosmetic glitch during one update window. A content-negotiated text fallback would need a
  header every client sends, which Android would then have to send forever.
- Personal access tokens and the admin re-authentication answers are unchanged (codes, statuses, bodies); the
  token gate tests and `admin-reauth.json` stay green untouched.

## 7. Rulings made while building

- Ruling: `writeError` sets `X-Content-Type-Options: nosniff` on every error answer, as `http.Error` did — the
  stroke route tests pinned it and a JSON error body should never be sniffed — cost if wrong: none.
- Ruling: a request whose client is already gone keeps its 499 without a body (`writeClientGone`) — nobody reads
  it and the route walk never cancels a request — cost if wrong: none for clients.
- Ruling: `writeJSON`'s own marshal failure writes a constant coded body instead of calling `writeError` (which
  goes through `writeJSON`) — no recursion — cost if wrong: none.
- Ruling: validation messages that start with a field or parameter name keep it lowercase (`since must be RFC
  3339.`), other sentences are capitalised; the message is for developers — cost if wrong: cosmetic.
- Ruling: `decodeBody` is introduced and used where the body is decoded in one step; routes with their own
  two-step or strict decoders (`readAccountBody`, `decodeStrictJSON`, the multipart forms) keep them and answer
  through `badBody`/`writeError`, so each route keeps its exact strictness — cost if wrong: two decoder shapes
  stay in the code (both coded).
- Ruling: the web `UserError`'s `message` is the catalogue text at throw time (for the console and for
  `toThrow` assertions); `errorText` re-translates from the key. Errors that already carry interface text (the
  study store's partial-write errors) are `ShownError` and `errorText` shows their `text` — cost if wrong: none.
- Ruling: library validation refusals (a label or note too long, a bad colour) now show the screen's own
  sentence instead of the server's English one; the client checks these limits before sending, so this is the
  rare path — cost if wrong: a less specific sentence on a path a correct client does not reach.
- Ruling: the staged pack job status (a 200 body with an English `error` for a failed import) is not an HTTP
  error answer and keeps its text; the pack manager shows it as before — cost if wrong: one more English
  admin sentence, matching the pack_invalid detail ruling.

## 8. Docs

`docs/wiki/API-Errors.md` is regenerated (`node scripts/gen-api-docs.mjs`) and its intro no longer says some
routes answer plain text; `docs/wiki/API-Reference.md` and `API-Overview.md` lose the "older routes answer
plain text" notes; `docs/contracts/overview.md`, `docs/contracts/README.md` (events row), the auth contract
README (a new "Changelog" section) and the sync, events, settings, overlays and i18n READMEs say JSON.
