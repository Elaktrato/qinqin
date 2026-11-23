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
    empty; 51 packages, 47 ok, 3 without test files, 1 FAIL = `internal/ai`
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

### Review fix wave (2026-11-23)

No MUST-FIX. Each group test-first; where the reviewer named a mutation it was applied to the source with a
scratch script (`mutate.sh`: apply, run the named test, restore), seen to survive before the fix and to die after.

- **Merge 1** (ac255915): `feature/hardening-batch` with hb-server-fixes merged without conflicts (the staged
  import's `context.AfterFunc` shutdown cancel and `writeError` sit together in `handleInstallStaged`); the
  static test and the route walk passed on the merge.
- **1 static statuses** (44b5681e): the three named mutations survived the old test (`ok`), then died
  (`w.WriteHeader(500)` in handleListWorkspaces; `writeError(w, 409, "bad_request", …)` in
  handlers_plugins.go:109; `writeJSON(w, 500, map{"err":…})` in handlers_dict.go:48). The stricter check also
  found a real gap: the mail test failure was written by `writeJSON` with a 502 map; now `writeError`.
- **2 walk statuses** (a537bee5): mutation `status = http.StatusBadGateway` for the 409 AI codes survived the
  old walk, dies now; the unmutated walk found no mismatch.
- **3 mappers** (11a4b6a9): `no_key`→`no_key_typo` in writeAIError survived the static test and the walk, dies in
  `TestAIErrorCodesAreCatalogued`; an SMTP table status 422→409 dies in `TestSMTPInputErrorCodesAreCatalogued`.
- **4 walk throttling** (f0b84edb, 0d94bf61): the new assertions failed first (six routes answered
  `rate_limited`, two sign-in routes never reached their refusal); then one address per request, an
  unthrottled policy for the walk and a credentials body. Ruling: the walk sends a `Range` header on every
  request but has no installed files; the 416/412 path stays the `serveContent` unit test's (spec corrected).
- **5 errmsg lint** (2ca23639): the new pattern cases failed, then passed; the walk then found the pack_invalid
  detail (allowlisted, the ruled exception) and `apiErrorBody`'s `{ message } = err.body`, whose `message`
  member is gone (tests updated first).
- **6 language_in_use** (39b08c3e): the Go usage test and the web `inUseLines` / LanguageManager tests failed
  first; the 409 carries `usage` counts (documented in errors.json), the screen lists workspaces and installed
  packs, the text is "Workspaces or installed packs still use this language.".
- **7 NITs**: recover wrapper and wrapper Unwrap/ReaderFrom (9da9c775; tests failed to compile first, then three
  mutations — no ReadFrom, no Unwrap, no coded answer — each die); API-Errors notes the pre-routing answers of
  net/http; licence mismatch gets `licence_mismatch` and the staged-pack refusals read as sentences, the
  `sync:`/`events:` prefixes are cut by `errDetail` (2f82ace8, tests failed first); spec table and changelog
  (4daa1cee); XHR uploads notify the workspace-gone and restriction handlers (ea4ef5f8, test failed first);
  a write failure while unpacking is no longer `ErrInvalidPack` and the dictionary route answers through
  `writePackError` (5a38fd1a, `copyEntry` test failed to compile first).
- **Merge 2** (610dd43a): `feature/hardening-batch` with hb-web-robust. Conflicts in loadGoal, cardActions test,
  frequencyRanks, store.ts, routes/study/+page.svelte, contracts README and handlers_sync.go, resolved keeping
  both sides. In the same commit: `writeStoredUnreadable` (409 `study_row_unreadable`) goes through
  `writeError` (the static test flagged it first); `UnreadableRowError` extends `ShownError` (a new errorText
  test failed first); AddToStudy throws `UserError('entry.study.noWorkspace')` (no dedicated dom test: the
  path needs no workspace while the button is live; covered by the generic UserError test). No `http.Error`,
  `message(err)` helper or `.message` read in their code survived the errmsg lint.
- `TestPluginDataRoute` and `TestSourcesImportWorkspace` still fail when run alone (pre-existing, language
  registry order); they pass in the full run.
