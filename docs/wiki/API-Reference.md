# API reference

What each route takes and answers, area by area. [API routes](API-Routes) is the complete generated list with who may call each route and whether an access token may; [API errors](API-Errors) is the error-code catalogue; [API overview](API-Overview) explains sign-in, sessions and conventions. Where a contract under `docs/contracts/` exists, its fixtures are the exact rule and win over this page.

**Who may call what.** The dictionary, character and credit reads are public: `GET /api/lookup`, `/api/segment/at`, `/api/entries/{id}`, `/api/entries/{id}/chars`, `/api/search`, `/api/languages`, `/api/dictionaries`, `/api/schemes` (and its sub-routes), `/api/frequency-packs`, `/api/characters`, `/api/components`, `/api/component-packs`, `/api/stroke-packs`, `/api/sentence-packs`, `/api/grammar` (and lessons), `/api/themes`, `/api/audio-packs` (and credits), `/hanzi/U<HEX>.json` and `/fonts/<sha256>.woff2`. Everything else needs a signed-in user, among them all library and source routes, `POST /api/segment`, the audio clip routes (`/api/audio/...`) and `GET /api/fonts`. Offsets in text routes count Unicode code points, not bytes or UTF-16 units.

## Dictionary and lookup

| Route | Purpose |
|---|---|
| `GET /api/lookup?lang=&text=&offset=&kind=` | The ranked entries for the text at a code-point offset: `{"results": [...]}`, at most 30. `text` up to 64 code points (the web app sends 16, and the engine reads a 12 code-point window from the offset); `kind` is `word` or `character` and may repeat. Each result has the entry id, the `term` to show (a Japanese matched written form unless it is search-only, else the display form: こと for the usually-kana 事, の for 乃), forms with flags, readings with flags, the matched text with its `start`/`end`, inflection `reasons`, tags, `frequencies`, `senses` (each with part of speech) and `levels` (`[{scheme, level}]`: the entry's lowest level in each installed level scheme, `[]` when none). Missing or non-integer parameters are 400, an unsupported language 400, too long 413; an offset outside the text finds nothing |
| `GET /api/segment/at?lang=&text=&offset=` | Tokenizer: the longest dictionary match at a code-point offset, built on the lookup engine. `text` up to 64 code points. `lemma` is the dictionary form and `reason` the deinflection; only `entries[0]` corresponds to them, later candidates are other readings or entries with the same surface (at most 8 in all). A candidate has `reading: true` when it matched by a kana reading (Japanese) |
| `POST /api/segment` `{lang, text, readings?}` | Every match in order, same shape; signed-in. `text` up to 5,000 code points, body up to 256 KiB. With `"readings": true` every match also carries `reading: {type, value}` (the first candidate's reading, with the caller's own edited readings applied). `lang` must be a registered language (`zh` or `ja` for the reader) |
| `GET /api/search?q=&lang=&kind=&scheme=&level=&limit=` | Ranked hits by tier: exact form, exact reading, reading prefix, bopomofo prefix, then a gloss substring; within a tier usually-kana-with-priority, then priority, then id. At most 50 hits unless `limit` asks for more (up to 200). `lang` is required; a negative or non-numeric limit, or a `level` without a `scheme`, is 400. Hits carry `glosses` (the first gloss of each active dictionary, at most three) and `levels` (the lowest level of each installed scheme) |
| `GET /api/entries/{id}` | One entry with its forms, readings, senses, links, levels, the pack's sentences plus the caller's own, and `characters` (for a Chinese or Japanese word: its distinct Han characters, at most eight, each with reading, gloss, radical, strokes and levels; [API overview](API-Overview#search-hits-and-entries)) |
| `PUT /api/entries/{id}` | Store the caller's own patch of an entry (a `null` field reverts to the shared value); body up to 64 KiB. An unknown or malformed id is 404 (checked before the body) |
| `GET /api/entries/{id}/chars` | The characters classified under a radical entry, ordered by headword; `[]` for a radical without any, 404 for an unknown id |
| `POST /api/entries/bases` `{ids}` | Signed-in. The base rows (the shape of the scheme entry list) of 1 to 500 entries, in first-occurrence order, unknown ids omitted, the caller's own edits applied; for reading a whole deck's forms and readings in a few requests. Body up to 16 KiB |
| `POST /api/entries/{id}/sentences` | Add the caller's example sentence; only `hanzi` is required (up to 2,000 characters per field, body up to 16 KiB) |
| `POST /api/entries/frequency-ranks` `{language, ids}` | Signed-in. Each entry's rank in the language's first frequency pack: `{pack: {id, packId, name, license, attribution} \| null, ranks: [{id, rank}]}` in request order, entries without data left out; 1 to 500 ids, body up to 16 KiB |
| `GET /api/languages` | Every language the server knows, sorted by code: `[{code, name, kind, installed}]`. `kind` is `code` for the built-in languages with code support (Chinese, Japanese) and `data` for languages registered by an administrator or by a pack; `installed` is true only for a language with live dictionary data |
| `GET /api/dictionaries` | The installed dictionaries, each with `license`, `attribution` and `notice` (`""` when the manifest has none) |
| `GET /api/schemes` | Every installed level scheme with its ordered levels, `license`, `attribution` and `notice` |
| `GET /api/schemes/{id}/entries?level=` | The scheme's member entries (words and derived characters), optionally of one level; 404 for an unknown scheme or level |
| `GET /api/schemes/{id}/characters` | The compact per-level character sets the character map groups by: `{levels: [{id, name, chars}]}`, each Han character of the level's words once, in order of first appearance. Gzip when accepted, weak `ETag`, 304 on `If-None-Match` |
| `GET /api/frequency-packs` | The installed frequency packs in priority order, with `packId`, `license`, `attribution` and `notice` |
| `GET /api/frequency-packs/{id}/top?size=500\|1000\|2000` | Signed-in. A starter deck: `{packId, name, size, entries}` with each word's base fields (`written` = the display form), `rank` and `gloss`, in rank order; 404 for an unknown pack, 400 for another size |
| `GET /api/sentence-packs` | The registered sentence packs with their credits (the Sources page lists them) |
| `GET /api/grammar?language=` | The installed grammar packs of a language (all when omitted) with credits, levels and lesson summaries |
| `GET /api/grammar/{pack}/{lesson}` | One lesson with its pack's credits and the neighbouring lessons; 404 for an unknown or removed lesson |

## Characters, components, strokes, themes and fonts

| Route | Purpose |
|---|---|
| `GET /api/characters?language=` | The character universe of a language (`ja`, `zh`; another well-formed language gives an empty list, a malformed one 400): `{language, count, stale?, chars}` with compact keys per row: `i` entry id, `c` glyph, `s` strokes, `g` school grade, `f` frequency rank, `t` standard-list flag, `b` GB2312 level, `h` Hong Kong primary grade, `r` reading, `m` meaning, `v` variant forms, `k` the Kangxi radical number; absent values are left out. `stale: true` means the level fields are missing (re-seed). Gzip, weak `ETag`, 304 |
| `GET /api/components?language=` | The radical and part lookup's index: `{language, packs: [{id, license, attribution}], parts: [{c, s, n}], chars: {glyph: [part, ...]}}`, the union of the language's components packs (`s` part strokes, 0 when unknown; `n` characters containing the part). Gzip, weak `ETag`, 304; contract `docs/contracts/radicals/` |
| `GET /api/component-packs` | The installed components packs with `packId`, `name`, `version`, `language`, `license`, `attribution`, `notice` |
| `GET /api/stroke-packs` | The installed stroke-order packs with `packId`, `name`, `version`, `languages`, `license`, `attribution`, `notice` |
| `GET /hanzi/U<HEX>.json` | The stroke-order data of one character from the installed strokes packs, byte for byte (`public, max-age=86400`, `ETag`, `nosniff`); 404 when no pack has it |
| `GET /api/themes` | Every colour theme and every theme pack's credits: `{themes: [{id, name, family, scheme, colors, accents, defaultAccent, packId, builtin}], packs: [...]}`, the built-in packs (qinqin, qinqin extras, Catppuccin, Rosé Pine, Nord, Gruvbox, Dracula, Solarized, Tokyo Night, Everforest, Kanagawa) first; strong `ETag`, `no-cache`, 304. Contract `docs/contracts/themes/` |
| `GET /api/fonts` | Signed-in (read tokens of any workspace allowed); the same for every user. The installed font faces with their WOFF2 slices and the packs' credits: `{faces: [{packId, face, script, original, weight, style, license, attribution, slices: [{url, unicodeRange}]}], packs: [...]}`; strong `ETag`, `no-cache`, 304. Contract `docs/contracts/fonts/` |
| `GET /fonts/<sha256>.woff2` | Public, no token. One slice of an installed font pack (`font/woff2`, `public, max-age=31536000, immutable`, `nosniff`, Range); 404 for anything else |

## Audio

| Route | Purpose |
|---|---|
| `GET /api/audio/entries/{id}` | Signed-in. The clips of one entry: `{terms: [Clip], syllables: [[Clip] \| null] \| null}`. `terms` are recordings of the whole word (matched on written form and first reading); `syllables` (Chinese entries only, else `null`) has one slot per pinyin reading, each the clips to play in sequence or `null`. `Clip` is `{url, packId, license, attribution, source}`; 404 for an unknown entry |
| `POST /api/audio/resolve` `{entryIds}` | Signed-in. The same for up to 200 entries, keyed by id (unknown ids left out); more is 422, a body over 16 KiB 413 |
| `GET /api/audio/clips/{file}` | Signed-in. One stored clip, `<sha256>.<opus\|ogg\|mp3>` exactly as in a clip's `url`; Range and conditional requests work, `private, max-age=31536000, immutable`, `nosniff` |
| `GET /api/audio-packs` | The installed audio packs with `license`, `attribution`, `notice`, `language` and `clipCount` |
| `GET /api/audio-packs/{id}/credits?offset=&limit=` | Per-recording credits: `{total, offset, limit, clips: [{kind, form, reading, license, attribution, source}]}` (`reading` is the stored match key: hiragana for Japanese, numbered pinyin such as `ni3hao3` for Chinese); `limit` up to 500, default 100; unknown pack 404 |

## Data packages and sync

| Route | Purpose |
|---|---|
| `GET /api/packages?languages=` | Signed-in (tokens allowed). The data package catalogue: the packages of the caller's workspace languages, or `languages=zh,ja` or `all`, with revision, content hash, file SHA-256, size, state, licences and sources; `ETag` and `If-None-Match`. A build error shows only in an administrator's own session. Contract `docs/contracts/packages/`; see [Data packs on the server](Admin-data-packs#data-packages-what-clients-download) |
| `GET /api/packages/{id}/{revision}` | Signed-in (tokens allowed). One package file (a zip with `manifest.json`, `NOTICE.md`, `LICENSES/`, `data.sqlite`); `Range`/`If-Range` resume it; `private, no-cache` with the file's `ETag` (304 on revalidation) and `nosniff`. 404 `package_not_found`, 410 `package_revision_gone` (purged 7 days after it was replaced), 429 `download_busy` with `Retry-After` (at most 2 downloads per user at a time; may be retried automatically) |
| `GET /api/sync/pull?v=2&since=&collections=&workspace=&limit=&tombstones=&page=` | The paged pull: the caller's own rows, one page of at most `limit` rows (1 to 2,000, default 500) and 4 MiB, continued with the `next` token; the last page gives a `cursor` for the next round's `since`. A round from no `since` ships live rows only unless `tombstones=1`. Errors are JSON (`sync_page_invalid`, `sync_collection_moved`). Contract `docs/contracts/sync/` |
| `GET /api/sync/pull?cursor=&collections=` | The legacy form, deprecated until v0.5.0 (answers carry `Deprecation` and a `Link` to `v=2`); only cached v0.3 web shells still use it. Changes since the cursor, streamed. `collections` is an optional comma list that limits the pull (others come back empty, an unknown name is 400). The lexicon collections (`entries`, `links`, `senses`, `levelMembers`, `dictionaries`, `schemes`, `levels`) moved to data packages: they stay `[]`, and naming one is 400 `sync_collection_moved`; `sentences` holds the caller's own only. The returned cursor is valid only for the collections requested |
| `POST /api/sync/push` | Push offline events and plugin data and the typed study rows (events idempotent by id, rows last write wins); an unknown or foreign workspace or plugin is 404 and nothing is applied. Body up to 8 MiB. Rows of a plugin without `owns-data` are skipped and counted in `dataRefused` ([Plugin format](Plugin-format)) |

## Study events, stats and plugins

| Route | Purpose |
|---|---|
| `POST /api/events/batch`, `GET /api/events?since=&workspace=` | Append offline-recorded study events (idempotent by event id; each event needs a `workspaceId` of 1 or more, else 400, and the workspace must be the caller's, else 404; timestamps are stored as UTC whole seconds) and list the caller's events from an RFC 3339 instant, optionally of one workspace |
| `DELETE /api/events/lookups?workspace=` | Erases the caller's `lookup` events of one workspace (the lookup history's Clear): `{"deleted": n}`. The workspace is required. No other event type is ever deleted |
| `GET /api/stats/activity?from=&to=&workspace=` | The caller's activity by learner day, workspace and type for the plugins' activity rules: `{from, to, timeZone, sources, cells}`. `from`/`to` are learner dates (default: today and the 90 days before; at most 366 days) |
| `GET /api/me/time-zone`, `PUT /api/me/time-zone` | The caller's learner time zone: `{zone, history: [{zone, from}]}` (`zone` null while none is set). `PUT {"zone": "Asia/Tokyo"[, "ifUnset": true]}` records a change effective from the server's now (the very first zone has `from: null` and applies to the whole log); IANA names only, body up to 1 KiB; errors `unknown_time_zone` (400), `bad_request` (400), `too_large` (413), `too_many_changes` (409) |
| `PUT /api/me/interface-language` `{language}` | The caller's interface language: `""` (follow the browser) or a language tag; answers `200 {language}`, 422 `invalid_language`, 400 `bad_request`. `GET /api/auth/me` reads it back as `interfaceLanguage`. A full session only; tokens are refused. Contract `docs/contracts/i18n/` |
| `GET /api/plugins`, `PUT /api/plugins/{id}/state` `{enabled, order}` | The caller's plugins with their state (`hidden: true` marks the app's own surface-less built-ins such as `qinqin-core`; clients leave those out of plugin lists), and the caller's switch and (legacy) order for one plugin |
| `GET /api/plugins/{id}/data?workspace=&prefix=`, `GET`/`PUT`/`DELETE /api/plugins/{id}/data/{key}?workspace=` | Plugin data rows ([Plugin data API](Plugin-data-api)) |

## Workspaces

| Route | Purpose |
|---|---|
| `GET /api/workspaces`, `POST /api/workspaces` `{language, name?}` | List the caller's workspaces (creating the defaults on a first call) and create one (201); an over-long or invalid name is 422, a duplicate (language, name) 409. `language`: a code that exactly matches a stored one keeps its spelling; otherwise it must be well formed (422 "language must be a code like es or pt-br") and is normalised. A non-administrator may only use a known language (a code pack such as `zh` or `ja`, a registered language, installed dictionary data, or any live level, frequency, sentence, grammar or audio pack of it), else 422 "unknown language — ask the administrator to add it"; an administrator's request registers a new code. These errors are plain text |
| `PUT /api/workspaces/{id}` `{name?, settings?}` | Rename and/or merge settings; at least one field is required |
| `DELETE /api/workspaces/{id}` | Delete a workspace and everything scoped to it: 204, 404 for an unknown or foreign id, 409 for the caller's last workspace |

## Library (the Reader)

| Route | Purpose |
|---|---|
| `GET /api/library/books?workspace=`, `GET`/`DELETE /api/library/books/{id}` | List (without `workspace`: every workspace of the caller), read, delete a book (its bookmarks and highlights go with it) |
| `GET /api/library/books/{id}/chapters/{n}` | One chapter's paragraphs |
| `PUT /api/library/books/{id}/position` | Store the reading position |
| `POST /api/library/upload` | Multipart `file` (epub, up to 20 MiB) and `workspace` (required); `language` only matters for an epub without `dc:language`. 404 for a foreign workspace, 422 when the book's language differs from the workspace's |
| `GET /api/library/sources` | The available online sources |
| `GET /api/library/sources/{source}/search?q=&limit=` | Search a source's catalogue (limit up to 100) |
| `GET /api/library/sources/{source}/browse?language=&seed=&limit=` | A deterministic assortment for the seed (default: today's UTC date; limit 1 to 50, default 12). 404 for an unknown source, 501 for one without suggestions |
| `POST /api/library/sources/{source}/import` `{sourceId, workspaceId}` | Import one work into a workspace; a source with no books in the workspace language is refused with 422 before any download, a repeat in the same workspace is 409 |
| `GET`/`POST /api/library/books/{id}/bookmarks`, `PUT`/`DELETE …/bookmarks/{bid}` | List and add `{position, label?}` (201; 200 when one exists at the position; 409 beyond 200 per book), rename `{label}` or delete |
| `GET`/`POST /api/library/books/{id}/highlights`, `PUT`/`DELETE …/highlights/{hid}` | List and add `{chapter, paragraph, start, end, text, color?, note?}` (201), update `{color?, note?}`, delete. `text` must be exactly the paragraph's text in `[start, end)` and at most 500 code points, else 422; a note over 2,000 characters is 422. A range overlapping another highlight is 409 `{error, existingId}`, a book with 2,000 highlights 409 |

## Journal and AI

All `/api/ai` errors are JSON `{error, message}` and never HTTP 401: 404 `unknown_provider`; 409 `ai_disabled`, `no_key`, `no_selection`, `no_vision`, `provider_disabled`, `key_undecryptable`, `in_flight`; 422 `key_rejected`, `quota`, `invalid_key`, `invalid_model`, `model_unavailable`, `bad_request`; 429 `rate_limited` and 503 `busy` with `Retry-After`. Background: [AI providers and offline OCR](Admin-AI-and-OCR).

| Route | Purpose |
|---|---|
| `GET /api/ai/status` | The caller's AI state: `secret` (`ok`, `missing`, `invalid`), `provider`, `fake`, `active` (`{provider, name, model, vision, structured}`), the stored `keys` (hint, model, state, never the key), the active provider's suggested `models`, this hour's `usage`, `available` and, when not, a `reason` (`no_secret`, `invalid_secret`, `no_provider`, `no_key`, `no_selection`, `provider_disabled`, `key_undecryptable`), plus `disabledProviders` |
| `GET /api/ai/providers` | The providers the server allows: id, name, kind, key page, default model, suggested models, structured mode, photo reading; custom endpoints with their `host` (administrators also get `baseUrl`), `canManageCustom` and `privateAllowed` |
| `PUT /api/ai/keys/{provider}` `{key?, model?}` | Checks a new key with the provider (one counted call), stores it and answers the status; the first stored key becomes active. Without `key` only the model changes. A model id is 1 to 200 characters of `[A-Za-z0-9._:/@-]` |
| `POST /api/ai/keys/{provider}/test` | Re-checks the stored key (one counted call) |
| `DELETE /api/ai/keys/{provider}` | Removes the caller's key; if it was active the selection is cleared, never moved to another provider |
| `PUT /api/ai/active` `{provider}` | Makes a provider with a stored key the active one (409 `no_key` otherwise) |
| `POST /api/ai/custom-providers`, `PATCH`/`DELETE /api/ai/custom-providers/{id}` | Administrators only (403 `forbidden`): register, change (default model, photos, structured mode, token cap) and remove an OpenAI-compatible endpoint; removing deletes every user's key for it. 422 `endpoint_blocked` (with the rule), 422 `invalid_endpoint`, 409 `provider_disabled` when `custom` is not allowed |
| `POST /api/journal/review` `{workspaceId, entryId}` | Asks the AI to review one journal entry and stores `review:<entryId>` (annotations validated and anchored by the server, then the overall review); answers the stored review. Up to 5,000 characters (413 `too_long`, 422 `empty`), 404 for a foreign workspace or unknown entry. The call finishes and is stored even if the client disconnects |
| `POST /api/journal/suggestions` `{workspaceId}` | Topic ideas from the workspace's recently reviewed words (at most 60) and the titles and openings (200 characters) of the last 10 entries; stores and answers the `suggestions` document |
| `GET /api/journal/capabilities?workspace=` | `{ai: <status>, ocr: {available, languageReady, language}}` for one workspace |
| `POST /api/journal/photos` | Multipart `file` and `workspace`; JPEG, PNG or WebP (sniffed), up to 10 MiB and 25 megapixels. Re-encoded to JPEG (rotation applied, GPS and all metadata dropped, long edge at most 2,576 px, at most 3.75 MB so it stays under 5 MB after base64). 201 `{photoId}`; 413 `photo_too_large`, 415 `unsupported_image`, 422 `image_too_large`, 409 `too_many_photos` (10 pending), 429 `rate_limited` (30 uploads an hour) |
| `GET /api/journal/photos/{id}`, `PUT …/{id}/keepalive`, `DELETE …/{id}` | The stored JPEG (`no-store`); keep an open draft's photo alive (204); delete it (204). A foreign workspace or photo is 404 |
| `POST /api/journal/transcribe` `{workspaceId, photoId, engine: "ai" \| "offline"}` | `{text, engine, unreadable}`. `ai` sends the stored photo to the provider with the caller's key (one counted call); `offline` runs Tesseract on the server and sends nothing anywhere: 409 `ocr_unavailable` without Tesseract, 409 `ocr_language_missing` for a language without a model, 503 `busy`, 429 `rate_limited` (60 an hour). No automatic fallback; nothing is stored beyond the photo's last-seen time |

## Accounts and sign-in

The rules are `docs/contracts/auth/` (start with its README); [API overview](API-Overview#authentication) has the flow.

| Route | Purpose |
|---|---|
| `GET /api/auth/options` | Public, never cached: `{bootstrap, registration, emailPolicy, passwordReset, emailCodeLogin, passwordMinLength}` |
| `POST /api/auth/register` `{username, password, email?, invite?}` | The first user on an empty database becomes the administrator; afterwards the registration mode decides (`closed` 403 `registration_closed`, `invite` needs a valid invite, 403 `invite_invalid`; `open` takes anyone). Body up to 4 KiB |
| `POST /api/auth/login` `{username, password, deviceName?}` | `{status: "ok" \| "password_change_required", token, user}`, or `mfa_required` with a challenge; body up to 4 KiB |
| `POST /api/auth/login/mfa` `{challenge, method, code}`, `POST /api/auth/login/mfa/email` `{challenge}` | The second step (`totp`, `recovery` or `email`); ask for the emailed code first (202 `{resendAfter: 60}`) |
| `POST /api/auth/email-login/start` `{login, deviceName?}`, `POST /api/auth/email-login/verify` `{challenge, code}` | Sign-in by emailed code, when the administrator allows it. The start always answers 202, known account or not; the verify answers like a login |
| `POST /api/auth/reset-request` `{login}` | "Forgot password": always 202 `{}`; only an enabled user with a verified address gets mail. 409 `mail_unavailable` without mail |
| `POST /api/auth/invite/check` `{invite}`, `POST /api/auth/reset/check` `{token}`, `POST /api/auth/reset` `{token, password, deviceName?}` | Is this invite usable (403 `invite_invalid`); whose reset link is this (400 `token_invalid`); spend a reset link (login-shaped answer) |
| `GET /api/auth/me`, `POST /api/auth/logout` | The current user with the session's `restriction` and `interfaceLanguage`; end the session the request came in on (204). Both allowed for a restricted session |
| `POST /api/account/password` `{currentPassword, newPassword, signOutOthers?}` | Change the password; a wrong current password is 403 `wrong_password`, a policy failure 422; other sessions are signed out unless `signOutOthers` is false (always after a forced change); all access tokens are revoked |
| `PUT /api/account/email` `{email, currentPassword}`, `POST /api/account/email/verify` `{code}`, `POST /api/account/email/resend` | Set or clear your own address under the email policy; confirm it with the mailed code; ask for a new code |
| `POST /api/account/mfa/totp/setup`, `…/totp/confirm`, `DELETE /api/account/mfa/totp`, `POST /api/account/mfa/recovery-codes`, `POST /api/account/mfa/email` | Authenticator setup (the secret is shown once), its confirmation (the recovery codes are shown once), removal, a new set of recovery codes, and the emailed-code method; each re-asks the password. Contract `auth/mfa-setup.json` |
| `GET /api/account/sessions`, `DELETE /api/account/sessions/{id}`, `POST /api/account/sessions/revoke` `{scope: "others" \| "all"}` | The caller's signed-in devices (no tokens), end one (204; another user's id is 404), end the others or all |
| `GET`/`POST`/`DELETE /api/account/tokens`, `DELETE /api/account/tokens/{id}` | Personal access tokens: list, create (re-asks the password; the token is answered once, `no-store`), revoke all, revoke one ([API access tokens](API-Access-tokens)) |
| `POST /api/account/export`, `GET /api/account/export/{ticket}` | Your own data as a zip: the POST answers `{url, expiresInSeconds: 60}`, the unauthenticated GET of that single-use URL streams the file. 6 an hour, 409 `export_running` |
| `POST /api/account/restore` (the zip, `application/zip`, up to 128 MiB) → 202 `{token}`; `GET`, `DELETE /api/account/restore/{token}`; `POST /api/account/restore/{token}` `{confirm, password, code?, unresolved?: "drop"}` | Staged restore that replaces all of your data. GET answers `{status: validating \| ready \| invalid \| running \| done \| failed, report, error, result}`. The POST needs your username, password and, with an authenticator, a code (403 `wrong_password` / `code_invalid`); 409 `unresolved_entries` until missing words are acknowledged. 5 uploads an hour. Contract `docs/contracts/backup/` |
| `POST /api/account/restore/safety-export`, `GET /api/account/restore/safety-export/{ticket}` | A fresh ticket for the data you had before your last restore |
| `GET /api/account/deletion-preview`, `DELETE /api/account` `{password, confirm}` | What deleting your account removes; delete it (409 `last_admin` for the last active administrator) |
| `GET /healthz` | Liveness check: `ok` |

## Administration

Administrator sessions only, never an access token. Re-authentication rules: [Users, registration and invites](Admin-users-and-registration#re-authentication).

| Route | Purpose |
|---|---|
| `GET`/`PATCH /api/admin/settings/auth` | Registration mode, email policy, and (once mail exists) required two-step sign-in and sign-in by emailed code; 409 `mail_unavailable` before |
| `GET`/`PUT`/`DELETE /api/admin/settings/smtp`, `POST /api/admin/settings/smtp/test` `{to?, draft?}` | The mail settings (the password is never in the answer); save the whole object; remove them; send one test mail through the saved or draft settings |
| `GET`/`POST /api/admin/invites`, `DELETE /api/admin/invites/{id}` | List (never a token), create (`{maxUses, expiresInDays, note}`; the token and `path` only in the 201), revoke |
| `GET`/`POST /api/admin/users`, `GET`/`PATCH /api/admin/users/{id}`, `POST …/{id}/sessions/revoke`, `POST`/`DELETE …/{id}/reset-link`, `POST …/{id}/mfa/reset`, `GET …/{id}/deletion-preview`, `DELETE …/{id}` `{confirm}` | User management (409 `last_admin`, 409 `self_target`, 422 `confirm_mismatch`) |
| `GET /api/admin/audit?before=&limit=` | Audit events, newest first, with a `next` id for the following page |
| `POST /api/admin/backup` `{currentPassword, include?: ["db", "books", "packs", "audio"]}`, `GET /api/admin/backup/{ticket}` | A ticket, then the streamed `tar.gz` server backup. 507 `insufficient_storage`, 409 `backup_running`, one a minute |
| `GET /api/admin/packs` | Every installed pack of every type with the licence and attribution it was installed under |
| `POST /api/admin/packs` (multipart `pack`, up to 128 MiB) | Stage an upload: answers the manifest as parsed, what it would replace and, for a theme pack, the measured contrast. 413 over the limit, 429 while 3 stages exist ([Data packs on the server](Admin-data-packs#installing-a-pack-from-the-web)) |
| `GET`/`DELETE /api/admin/packs/staged/{token}`, `POST /api/admin/packs/staged/{token}` `{license}` | A stage's status; discard it; install it (the licence string must match exactly, else 409; 202 while the import runs). Audio packs cannot be staged |
| `DELETE /api/admin/packs/{type}/{packId}` | Uninstall one pack of any type (204, 404 for an unknown type or pack) |
| `POST /api/admin/languages` `{code}`, `DELETE /api/admin/languages/{code}`, `GET /api/admin/languages/usage` | Add a data-only language (201, 200 when it exists, 409 for a built-in); remove an unused one (409 "still used by: …" or for a built-in); the number of workspaces per language |
| `POST /api/admin/dictionaries`, `DELETE /api/admin/dictionaries/{id}`, `DELETE /api/admin/schemes/{id}`, `DELETE /api/admin/sentences/{pack}` | Older pack routes: install a dictionary pack (multipart zip in `pack`, no total cap; beyond 32 MiB it spills to a temporary file) and soft-delete a dictionary, a level scheme or a sentence pack (entries survive) |
| `POST /api/admin/plugins` | Register a plugin manifest (400 with every reason when it breaks the contract, 409 for a built-in or reserved id; [Plugin format](Plugin-format)) |

## Request body limits

A body over its limit is a 413, usually with a JSON `{"error": ...}` (older routes answer plain text).

| Route | Limit |
|---|---|
| `POST /api/auth/login`, `/register` | 4 KiB |
| `POST /api/workspaces`, `PUT /api/workspaces/{id}` | 16 KiB; the merged workspace settings may total 64 KiB (413 "workspace settings too large") |
| `POST /api/admin/plugins` (manifest), `PUT /api/plugins/{id}/state` | 64 KiB |
| `PUT /api/plugins/{id}/data/{key}` | 256 KiB per value; the same cap applies to each plugin-data value inside `POST /api/sync/push` |
| `PUT /api/ai/keys/{provider}`, `PUT /api/ai/active`, `POST /api/ai/custom-providers`, `POST /api/journal/review`, `POST /api/journal/suggestions`, `POST /api/journal/transcribe`, `POST /api/admin/packs/staged/{token}` | 4 KiB |
| `PUT /api/entries/{id}` | 64 KiB |
| `POST /api/entries/{id}/sentences`, `POST /api/library/books/{id}/highlights`, `POST /api/audio/resolve`, `POST /api/entries/bases`, `POST /api/entries/frequency-ranks` | 16 KiB |
| `POST /api/library/books/{id}/bookmarks`, `POST /api/library/sources/{source}/import`, `PUT /api/me/time-zone` | 1 KiB |
| `PUT /api/library/books/{id}/position` | 2 KiB |
| `POST /api/events/batch` | 4 MiB |
| `POST /api/sync/push` | 8 MiB in total |
| `POST /api/segment` | 256 KiB |
| `POST /api/library/upload` | the epub up to 20 MiB (plus 1 MiB multipart overhead) |
| `POST /api/journal/photos` | 10 MiB |
| `POST /api/admin/packs`, `POST /api/account/restore` | 128 MiB |
| `POST /api/admin/dictionaries` | no total cap |
