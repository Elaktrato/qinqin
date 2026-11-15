# Data-Pack Management UI — Design

Date: 2026-11-15
Status: written autonomously (decision rule: licensing first, then best UX even at higher
development cost); not yet reviewed by the owner. Issue: #40.
Companion: `2026-11-15-language-management-design.md` (#41) builds on this one.

## Intent and why

An instance admin can only add or remove data packs (dictionaries, level lists,
frequency lists, sentence packs) with the seed CLI inside the container, or with
`curl` against `POST /api/admin/dictionaries` for dictionaries only. The admin
wants to do it from the web app: see what is installed under which licence, add a
pack from a zip, remove one. Because the repo is public and bundles third-party
data, the licence and attribution of every pack must be in front of the admin at
the moment of installing it, and nothing in the UI may suggest that a pack has
been checked or cleared.

## What exists today (develop @ 9667b2d)

- `POST /api/admin/dictionaries` (multipart field `pack`, zip): dictionary packs
  only; `ParseMultipartForm(32 MiB)` with **no body cap**, `dict.ExtractZip` does
  `io.ReadAll` of the whole upload and has **no limit on entry count or
  uncompressed size** (path traversal and non-regular files are rejected). Errors
  are a generic "invalid pack". No serialization of concurrent installs.
- `DELETE /api/admin/dictionaries/{id}`, `DELETE /api/admin/schemes/{id}`,
  `DELETE /api/admin/sentences/{pack}`; no uninstall for frequency packs.
- Levels, frequency and sentence packs install only via `qinqin seed`
  (`importPack` in `server/cmd/qinqin/seed.go` dispatches on the manifest type).
- Admin auth: `requireAdmin` answers 403 for anonymous and non-admin callers; the
  web knows `user.admin` (`apps/web/src/lib/auth.ts`).
- The data-plugin registry is synthesized in `internal/plugins` (`ListFor`) from
  the `dictionaries`, `schemes`, `frequency_packs` tables and the distinct
  `sentences.source_pack` values. **Sentence packs store no name, version,
  language, licence or attribution anywhere.** `dictionaries` has no `language`.
- Settings → Plugins lists those data packs with an Enabled toggle and an order
  that nothing reads (no server or web code consults a data plugin's state).
- The manifest validator already rejects packs without `license` or
  `attribution` (`dict.Manifest.Validate`); the stored strings are shown verbatim
  on the public Sources page.

## Goals

1. A **Data** tab in Settings, visible to admins only, with a **Packs** section:
   every installed pack with type, language, version, stated licence, attribution,
   grouped by type, then sorted by name.
2. **Install from a zip with real upload progress** (bytes sent / total, cancel),
   then a **review step** that shows the manifest exactly as the server parsed
   it — name, id, version, type, language, licence, attribution, notice — and,
   when it replaces an installed pack, what changes (version, licence,
   attribution). Installing requires ticking a licence confirmation.
3. **Uninstall** any installed pack of any type, with a confirmation that says what
   disappears and what survives.
4. Safe uploads: capped body, capped extraction, readable error reasons without
   server paths, one pack operation at a time.
5. The registry list replaces the no-op data-pack rows in Settings → Plugins.

## Non-goals

- Updating packs from a remote catalogue, downloading packs by URL, signatures.
- Editing a pack's licence or attribution in the UI (the manifest is the source).
- Per-user enabling of packs (per-workspace dictionary visibility is in #41).
- Deleting the pack files under `<data>/packs/` on uninstall (kept as today).
- A Languages view (in #41's spec, same tab).

## Anti-goals

- Any green tick, "verified", "OK", "cleared", "safe" or similar wording or icon
  next to a licence. The licence is "as stated by the pack", nothing more.
- An install that happens without the admin having seen the licence string.
- A pack whose licence is unknown (legacy sentence packs) shown like a known one.

## Approaches considered

- **A. Client-side manifest preview.** The browser opens the zip (hand-written
  central-directory reader plus `DecompressionStream('deflate-raw')`, or a new
  dependency such as fflate), shows the manifest, then uploads. Cheap on the
  server, but the preview is the browser's reading, not the server's: validation
  errors (bad notice, unsafe id, wrong format) only show after the full upload,
  and a new dependency needs a credits entry.
- **B. Upload, then server-side stage and confirm (chosen).** `POST` uploads the
  zip once; the server extracts and validates it into a staging directory and
  answers with the parsed manifest, a replace diff and a token. A second call with
  the token and the licence string imports it. The admin confirms exactly what
  the server will store; validation errors arrive right after the upload.
- **C. Dry-run flag.** Upload twice (once with `?dryRun=1`). Simple, but doubles
  the transfer and the wait for large packs.

Ruling: approach B — the server's own parse is the only licence string worth
confirming, and the admin gets every validation error before deciding — cost if
wrong: about a day more server work (staging, expiry) than A.

## Design

### Server

- **Unified admin routes** (new; the old per-type routes stay unchanged):
  - `GET /api/admin/packs` → `[{type, packId, name, version, language, license,
    attribution, notice, updatedAt}]`, live packs of all four types.
  - `POST /api/admin/packs` (multipart `pack`) → `201 {token, expiresAt, manifest,
    replaces, files, bytes}`; `manifest` is the normalized `dict.Manifest`,
    `replaces` is `null` or `{version, license, attribution}` of the installed
    pack with the same type and id.
  - `POST /api/admin/packs/staged/{token}` body `{"license": "<string>"}` →
    starts the import in the background and answers `202 {status: "importing"}`.
    The string must equal the staged manifest's licence byte for byte, else
    `409` "confirm the pack's licence". Unknown/expired token `404`; a second
    call while importing `409` "already importing".
  - `GET /api/admin/packs/staged/{token}` → `{status: "staged"|"importing"|
    "done"|"failed", pack?: <list row>, summary?: "<seed-style line>",
    error?: "<reason>"}`; the web polls it every 2 s while importing. Finished
    results stay readable for 30 minutes.
  - `DELETE /api/admin/packs/staged/{token}` → `204`, discards the stage.
  - `DELETE /api/admin/packs/{type}/{packId}` → `204`; unknown `404`.
  All admin-only via `requireAdmin` (403). Errors stay plain text like the other
  admin routes.
- **Shared pack service** `internal/packs`: `Import(ctx, db, dict.Pack)
  (summary string, err)` moved from `seed.go` (seed calls it), `Uninstall(ctx, db,
  type, packID)`, `List(ctx, db)`. New `freq.Uninstall(ctx, db, packID)`.
- **Sentence-pack registry:** migration `027_pack_registry.sql` adds table
  `sentence_packs (pack_id PK, name, version, language, license, attribution,
  notice, updated_at, deleted_at)`, written by `sentences.ImportPack` and soft-deleted by
  `sentences.Uninstall`. Sentence packs imported before 027 have no row; the list
  shows them with empty name/licence (UI: "Licence not recorded — reinstall the
  pack to record it"). The same migration adds `dictionaries.language TEXT NOT
  NULL DEFAULT ''`, backfilled from one live sense's entry language, and written
  by the dictionary importer from the manifest (needed by #41 and by the list).
- **Public sentence-pack credits:** `GET /api/sentence-packs` (public, like
  `GET /api/dictionaries`) lists live registry rows; the Sources page gets a
  Sentences section, so a sentence pack is credited like every other pack
  (`plugins/data/README.md`'s "notice not stored or shown" line is updated).
- **Uninstall semantics per type:** dictionaries, schemes and sentences
  soft-delete their rows as today; `freq.Uninstall` soft-deletes the pack row and
  hard-deletes its `frequency` rows (they have no `deleted_at`; a reinstall
  rewrites them). Entries always survive.
- **Zip limits** (`dict.ExtractZipAt(r io.ReaderAt, size int64, dir string)`;
  `ExtractZip` becomes a wrapper, so the seed's `.zip` packs get the same limits):
  at most 2,000 entries and 512 MiB uncompressed in total, enforced on bytes
  actually written (not only the declared sizes); traversal, absolute names,
  symlinks and other non-regular files rejected as today. A zip whose only
  top-level item is one folder holding `manifest.json` (what "Compress folder"
  produces) is unwrapped.
- **Upload cap:** `http.MaxBytesReader` at 128 MiB plus 1 MiB multipart overhead;
  over it is `413` "pack zip larger than 128 MiB — use qinqin seed for larger
  packs". The multipart file is read through `io.ReaderAt`, never fully into memory.
- **Staging:** `<data>/packs/.stage-<token>/` with a 128-bit random hex token,
  kept in an in-memory map with the admin's user id; another admin's token is
  `404`. Expiry 30 minutes; at most 3 live stages (a 4th upload is `429` "finish
  or discard a staged pack first"). Expired stages and `.stage-*` directories
  older than an hour (left by a restart) are swept on each stage call.
- **Background import:** the import runs in a goroutine with a context detached
  from the request (it survives a proxy timeout or a closed tab), under the pack
  mutex; on success the extracted root moves to `<data>/packs/<id>-<version>/`.
  A restart mid-import loses the job state; the import transaction rolls back
  and the admin uploads again.
- **One operation at a time:** a `sync.Mutex` on the server serializes stage
  import, uninstall and the legacy dictionary install; the stage upload itself
  runs outside it.
- **Error messages:** manifest validation and zip-limit reasons are returned
  (`400 invalid pack: manifest: license is required …`); messages never contain a
  filesystem path (pinned by a test that greps the body for the data dir).

### Web

- `lib/settings/tabs.ts`: `visibleSettingsTabs(admin)` adds `data` ("Data") for
  admins; `?tab=data` for a non-admin falls back to the first tab.
- `lib/api/upload.ts`: `uploadWithProgress<T>(path, form, {onProgress, signal})`
  over `XMLHttpRequest` with the bearer token, mapping errors to `ApiError` and a
  401 to the same unauthorized handler as `api()`.
- `lib/api/packs.ts`: typed calls for the five routes.
- `lib/settings/packsView.ts` (pure, tested): type labels and grouping, the licence
  line (verbatim, or "Licence not recorded"), a **caution check** that flags
  licence text matching unknown/unclear/unspecified/proprietary/all rights
  reserved/non-commercial/NC/research/no redistribution with "This licence may
  restrict use or redistribution — check it before installing" (advisory, never
  blocking, never a positive badge), the replace-diff lines, progress text.
- `lib/settings/PackManager.svelte` in the Data tab:
  - list grouped by type (Dictionaries, Level lists, Frequency lists, Sentences),
    each row: name, `packId`, language label, version, "Licence (as stated by
    the pack): …", attribution, Uninstall; footer link to the Sources page.
  - install: file input (`.zip`), Upload button, progress bar with bytes and
    Cancel (aborts the XHR); then "Uploaded, checking the pack…"; then the review
    card with every manifest field, the caution line if any, the replace diff
    (licence changes highlighted), a checkbox "I have read the licence and
    attribution above and this server may use the data under these terms", and
    Install (disabled until ticked) / Discard. Install shows "Importing… large
    dictionaries can take a minute" with an indeterminate bar while polling the
    status route; then the server's summary line (or the failure reason) and the
    refreshed list. A reload during the import loses the poll, not the import:
    the list shows the pack once it is done.
  - uninstall dialog per type, e.g. dictionary: "Its glosses disappear from
    lookups and entries. Entries, your flashcards and your edits stay. A later
    `qinqin seed` reinstalls bundled packs."
  - every async state is keyboard reachable, announced via `role="status"`/`alert`.
- Settings → Plugins lists feature plugins only (data packs are managed in Data).

```
Data
 Packs                                     [Choose zip…] [Upload]
 Dictionaries
  CC-CEDICT  cedict · Chinese · 2026-11-10
  Licence (as stated by the pack): CC BY-SA 4.0
  Attribution: MDBG …                                   [Uninstall]
 Sentences
  my-sentences · Licence not recorded — reinstall to record it [Uninstall]
```

## Constraints

- Migration number `027_pack_registry.sql`. Go 1.26, stdlib mux, no new Go deps.
- No new npm dependency. Svelte 5 runes, tabs + single quotes, 44 px targets.
- The web client logs out on any 401; these routes use 403 for "not admin".
- Never commit a third-party pack or extraction for tests; fixtures are built in
  the test from strings (memory: uncertain-licence data stays out of the repo).

## Rulings

- Ruling: server-staged review step (approach B) — the confirmed licence is the
  server's own parse and errors come before the decision — cost if wrong: extra
  staging code.
- Ruling: install requires the exact licence string in the body — the server can
  then insist the client showed it; a ceremonial boolean proves nothing — cost if
  wrong: a stale tab must re-upload after a pack's licence changed.
- Ruling: a licence-caution heuristic warns but never blocks and nothing ever
  shows as approved — the server cannot judge licences; a positive badge would
  imply clearance — cost if wrong: an odd licence string slips through unflagged,
  which is the status quo.
- Ruling: add a `sentence_packs` registry (migration 027) rather than list sentence
  packs without terms — licensing first: a pack we cannot credit should not look
  like one we can — cost if wrong: one table nobody reads if sentence packs never
  ship.
- Ruling: limits 128 MiB upload, 2,000 files, 512 MiB extracted — the largest
  bundled pack is 11 MB; ten times headroom, and bigger packs still go through
  `qinqin seed` as directories (the zip caps apply to seed's `.zip` packs too;
  none are bundled) — cost if wrong: a big Yomitan frequency pack needs the CLI.
- Ruling: the import runs in the background and the web polls — the deployment
  may sit behind a proxy with a 60 s read timeout, and a JMdict import can take
  longer — cost if wrong: a little job-state code that a direct setup never needs.
- Ruling: credit sentence packs on the public Sources page — licensing first:
  every installed pack is credited publicly — cost if wrong: one small route and
  section that stays empty while no sentence pack is installed.
- Ruling: unwrap a single top-level folder — the OS "compress folder" zip must
  just work — cost if wrong: none; a zip with stray top-level files still fails
  with "manifest.json not found at the top of the zip".
- Ruling: the proxy's own body limit is documented, not worked around (no
  chunked upload) — 128 MiB in one request is enough for every known pack —
  cost if wrong: admins behind nginx raise `client_max_body_size`.
- Ruling: keep the old per-type admin routes — scripts and tests use them —
  cost if wrong: two ways to install dictionaries.
- Ruling: hide data packs from Settings → Plugins — their toggles do nothing —
  cost if wrong: a user loses a no-op control.
- Ruling: files under `<data>/packs/` stay on uninstall — unchanged behaviour,
  nothing reads them — cost if wrong: disk use; a later cleanup.

## Left to the builder

Exact copy beyond the strings quoted here, CSS, the order of fields in the review
card, whether the summary line reuses `seed`'s wording verbatim, table-driven test
layout, and how the stage map is structured internally.
