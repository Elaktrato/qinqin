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

(filled in while building)
