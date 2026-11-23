# Plan — one error contract `{error, message}` (#168)

Spec: `docs/superpowers/specs/2026-11-23-error-contract-design.md`. Branch `feature/hb-errors`, worktree
`.claude/worktrees/hb-errors`. Every task is test-first (write or change the test, run it, see it fail, then
implement and see it pass), one commit per task, conventional message ending in the
`Co-Authored-By` trailer. Go gates under `flock /tmp/qinqin-go.lock`, targeted packages per task, one full
`./...` run at the end; web: targeted vitest per task, full check/test/build and Node 26 vitest at the end.

## Server

1. **`writeError` and `decodeBody`** (`internal/api/errors.go`, `errors_test.go`). Test: the body is
   `{error, message}` with `application/json`, extra members are added but never replace the two fixed ones;
   `decodeBody` answers `413 too_large` over the cap and `400 bad_request` on bad JSON, with `strict` also on
   an unknown field and trailing data; `badBody` and `readBody` answer coded JSON. Implement; `writeTooLarge`
   writes `too_large`.
2. **Catalogue codes** (`docs/contracts/auth/errors.json`, web `en.json`, `API_ERROR_KEYS`). Add the codes of
   spec section 3; the web catalogue test fails until every code has an `apiError.*` key with text.
3. **Static test and one writer** (`errors_static_test.go`). The AST test of spec section 4 with a pending list
   of the handler files not yet migrated; `writeAuthError`, `jsonError`, `writeJournalError` become
   `writeError` (mechanical rename) and the writeAuthError scan of `TestAuthErrorCatalogueIsCoherent` moves
   into the new test.
4. **Dynamic route walk** (`errors_walk_test.go`) with a pending pattern list that the migrations empty.
5. **Unmatched routes and ServeContent**: `handler()` answers 404 `not_found` / 405 `method_not_allowed` for
   unmatched API requests; a writer wrapper codes the 416/412 of `http.ServeContent`.
6. **Migrate sync and entries** (`handlers_sync.go`, `handlers_entries.go`, `handlers_entry_bases.go`,
   `handlers_freq_ranks.go`, `handlers_sentences.go`, `handlers_characters.go`) and the sync contract
   fixtures; tests that compared text compare codes first.
7. **Migrate events and stats** (`handlers_events.go`, `handlers_stats.go`) and `events/envelope.json`.
8. **Migrate workspaces and plugins** (`handlers_workspaces.go`, `handlers_plugins.go`,
   `handlers_plugins_legacy.go`) and `settings/workspace-settings.json`.
9. **Migrate packs, dictionaries, levels, languages** (`handlers_packs.go`, `handlers_packs_install.go`,
   `handlers_dict.go`, `handlers_levels.go`, `handlers_admin_languages.go`, `handlers_languages.go`,
   `handlers_freq.go`, `handlers_components.go`, `handlers_grammar.go`).
10. **Migrate library** (`handlers_library.go`, `handlers_sources.go`, `handlers_highlights.go`,
    `handlers_bookmarks.go`).
11. **Migrate audio, journal and AI** (`handlers_audio.go`, `handlers_journal.go`, `handlers_journal_photos.go`,
    `handlers_ai.go`, `handlers_ai_custom.go`).
12. **Migrate the rest** (`handlers_search.go`, `handlers_lookup.go`, `handlers_segment.go`,
    `handlers_time_zone.go`, `handlers_strokes.go`, `handlers_fonts.go`, `api.go`); both pending lists are empty
    and removed.

## Web

13. **`ApiError.code` / `body`, no sniffing** (`lib/api/client.ts`, `apiErrors.ts`, `workspaceGone`,
    `library.ts`): parse once in the constructor; workspace gone by `workspace_not_found`; `UserError` and its
    `errorText` branch.
14. **Lint rule `errmsg`** (`lib/i18n/lint.ts`, `lint.test.ts`, `hardcoded.test.ts`) with a pending file list.
15. **Migrate components and settings screens** to `errorText` (pending list shrinks).
16. **Migrate study, flashcards, stats, goals and routes** to `errorText`; the user-facing `new Error('…')`
    become `UserError`.
17. **Migrate reader, library, auth and the pack manager** (reader `errors.ts` by code, the
    language-mismatch fields, the pack manager's English detail); the pending list is empty and removed.

## Docs and checks

18. **Docs**: regenerate `docs/wiki/API-Errors.md` and `API-Routes.md` if needed, wiki API pages, contract
    READMEs (auth changelog, overview, sync, events, settings, overlays, i18n, README table).
19. **Real-app check** (scratch build on a free 127.0.0.1 port; curl bad JSON, 404s, 413, pack upload errors,
    workspace errors, sync errors, unmatched routes) and the final gates; fill in the Execution record.

## Execution record

Built 2026-11-23 on `feature/hb-errors` (from `develop` at the v0.5.0 merge, d696557e). One commit per task, in
plan order, except as noted.

- **1 writeError/decodeBody** (dcb8b106): `errors_test.go` written first, failed to compile (no `writeError`,
  `decodeBody`), then passed. A full `internal/api` run after it showed the two fixtures that pinned the old
  413/400 bodies (`sync/push-result.json`, `events/envelope.json`); they were updated in the same commit.
- **2 catalogue** (aed145df): the web catalogue test failed for the 25 new codes (25 failures), then passed with
  the `apiError.*` keys. `unknown_time_zone` and `too_many_changes` (written by the time-zone route but missing
  from the catalogue) were found by the static test in task 3 and added there.
- **3 static test** (0e0eeaca): failed with 556 findings, then the three writers were renamed to `writeError`, the
  computed-code writers listed (`dynamicCodeWriters`) and the documented alternate statuses (`code_invalid` and
  `challenge_expired` 401, `bad_request` 422) allowed; the 36 unmigrated files went into a pending list.
- **4 route walk** (2573b16b): failed on 72 routes; they went into a pending list. The unmatched-route test was
  split off into task 5.
- **5 unmatched routes / ServeContent** (ad0f4d91): `errors_mux_test.go` failed (404/405 text, no
  `serveContent`), then passed; `http.ServeContent` outside `serveContent` became a static-test finding.
- **6–12 migrations** (ee5c6361, 0c3a9299, 828db294, 6641ab56, 41d6f63d, 03432aea, e039e5a4): for each group the
  tests that compared text were changed to compare codes and the group's files and routes were taken off the
  pending lists first; each run failed, then the migration (a script for the literal `http.Error` calls, by hand
  for computed messages) made it pass. Deviations: the lowercase-field message wording of the task-6 files landed
  in the task-7 commit; task 8 was committed while `TestPluginDataRoute` failed in a targeted `-run Plugin`
  run — that test (and `TestSourcesImportWorkspace` in task 10) fails the same way on the untouched base commit
  when run alone (it depends on languages registered by other tests) and passes in the full package run.
  `writeError` gained `X-Content-Type-Options: nosniff` in task 12 when the stroke tests pinned it. Both pending
  lists were removed in task 12; a full `internal/api` + `internal/sync` run then passed.
- **13 ApiError** (147fba8d): `client.test.ts` / `userError.test.ts` failed first (no `code`, no `UserError`),
  then passed; the tests that mocked the text "workspace not found" now send the JSON code.
- **14 errmsg lint** (47fc5e88): the unit cases failed (no `errMessageFindings`), then passed; the walk listed 35
  files, which became the pending list.
- **15–17 web migrations** (e6fee817, 34f6cc39, 8024431c): the lint (already seen failing for these files in task
  14) was the failing test; behaviour tests that asserted a raw server or Error text were changed to the
  screen's own sentence or the catalogue text after the code change, so those were test-after. The pack
  manager's English detail test (`PackManager.errors.dom.test.ts`) and `packErrorDetail` test were written
  first for the helper (failed, then passed) but the component test passed at once (written after the
  component change). Commit 34f6cc39 kept the task-15/16 pending list while some of those files were already
  migrated, so its `hardcoded.test.ts` stale check is red at that commit; 8024431c makes it green.
  `packErrorDetail`, `ShownError` and the `UserError` message landed in 34f6cc39 rather than 8024431c.
- Extra fixes found on the way: the mail test failure parsed `err.message` as JSON (cb03aa48); the time-zone
  route had its own body error wording (ba19d27b, fixture updated).
- **18 docs** (7653aaea): API-Errors regenerated (`node scripts/gen-api-docs.mjs`; API-Routes unchanged, no
  route was added), wiki API pages, contract READMEs, auth changelog.
- **19 real-app check**: the server built from a scratch copy, run on 127.0.0.1:18468 with a fresh data dir;
  a Python script (urllib) drove 33 failing requests as an admin session: bad JSON (login, workspace create),
  unknown path 404, wrong method 405 (with nosniff), entry 404, 413 on push / workspace / plugin value, sync push
  bad item and foreign workspace, legacy and v2 pull errors, event list and batch errors, workspace 404 /
  exists / bad language / settings not an object, plugin data 404, library 404, pack upload without licence,
  not a zip and without a form, staged 404, unknown pack type, built-in language, stroke and font 404, no
  session 401, an access token on a session-only route, a package download 404. Every answer was
  `application/json` with a catalogue code and a message; two expectations of the script were wrong (no
  lexicon was seeded, so the entry route answered its 404 before reading the 70 KB body; the token gate
  answers `token_not_allowed` before looking the token up), both answers coded JSON. Server killed, scratch
  copy and data deleted.
- **Final gates** (after the last code commit):
  - Go, one full run `go vet ./... && go test -count=1 -p 2 ./...` with the proxy variables unset: `gofmt -l`
    empty; 53 packages, 47 ok, 5 without tests, 1 FAIL = `internal/ai`
    `TestHostnameResolvingToEmbeddedFormIsRefused` only (the known no-IPv6 sandbox failure); exit 1 for that.
  - Web `npm run check`: exit 0, 1675 files, 0 errors, 0 warnings.
  - Web `npm test` (Node 22): exit 1, 575 files, 12408 passed, 6 failed, 8 skipped: `BookView.dom.test.ts` (4)
    and `AccountSettings.dom.test.ts` (1) fail the same way on the untouched base commit under Node 22 here;
    `pwa/icons.test.ts` timed out under load and passes alone (7/7).
  - Web `npm run build`: exit 0.
  - Node 26 `npx vitest run`: exit 0, 575 files, 12420 passed, 2 skipped.
- Not verified: no browser (by rule); the old-shell behaviour of section 6 was reasoned, not run against a v0.5
  shell; the route walk cannot reach outage branches (a full disk, a source that is down) — the static test
  covers those writers; Android string conversion of the new keys was not run separately (the i18n contract
  tests passed).
