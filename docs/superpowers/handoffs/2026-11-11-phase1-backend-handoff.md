# Phase 1 Backend — Handoff (tasks 13–16 remaining)

**Audience:** the controller agent (or human) taking over execution of the Phase 1 backend plan.
**Date:** 2026-11-11
**Status:** Tasks 1–12 of 18 complete, every one through its implementer + independent task review (plus fix rounds where needed). Tasks 13–16 remain. All code is green: `go test ./...`, `go vet ./...`, `gofmt` clean at handoff time.

**Repo:** `github.com/Elaktrato/qinqin` — branch `feat/phase1-backend` merged into `main` at handoff. Continue on a fresh worktree/branch per the process below.

## Read these first, in order

1. **Spec (authoritative):** `docs/superpowers/specs/2026-11-10-chinese-learning-platform-design.md`
2. **Plan (18 tasks):** `docs/superpowers/plans/2026-11-10-phase1-go-backend.md` — Tasks 4R and 7J were inserted by the multi-language amendment; Tasks 5, 11, 12, 13, 15 carry amendment edits.
3. This document (rulings + process + open decisions).

The execution ledger (`progress.md`, with per-task dispatch/completion lines and deferred minors) lives in `.superpowers/sdd/2026-11-10-phase1-go-backend/` inside the old worktree — it is session scratch and not in git. Everything essential from it is summarized here.

## Process to resume (subagent-driven development)

- Use the `using-git-worktrees` skill to create/verify an isolated workspace; never work on `main`.
- Load `superpowers:subagent-driven-development` and follow its task loop exactly: `task-brief` script → dispatch implementer → `review-package` script → task reviewer → fix loop (resume the same implementer, scoped re-review, max 5 rounds) → ledger line.
- **Provider constraint:** the `opencode` provider API key is expired. Use `opencode-go/*` models. Tiers used successfully: standard implementers and reviewers `opencode-go/glm-5.3`; small mechanical tasks `opencode-go/claude-haiku-5-5`; final whole-branch review: pick the most capable `opencode-go` model (kimi-k3.1-pro / gemini-4-argon / grok-4.7 — no opus-class model on this provider).
- Task briefs already exist for none of 13–16; generate with `bash <skill>/scripts/task-brief <plan> <N>`.
- Commits: conventional, at least one per task.

## Rulings in force (R1–R14, from the ledger — do not relitigate)

- **R1:** CEDICT pinyin stored tone-marked (`pinyin.ToMarked`); display form everywhere.
- **R2:** `dict.Import` accepts only `Type: dictionary`. Seed/admin dispatch by manifest `Type` to `levels.Import` / `sentences.ImportPack`. Task 15 wires this.
- **R3:** Go toolchain floor ≥ 1.26 (forced by `modernc.org/sqlite` v1.62.0). Task 16's builder image must be `golang:1.26`+.
- **R4:** SQLite DSN carries `_pragma=busy_timeout(5000)` (done in Task 3).
- **R5:** Greenfield migration rewrites were allowed pre-deployment (003/004 rewritten). This privilege is spent — from here, migrations are append-only.
- **R6:** Two-tier language packs; unknown language codes auto-register as data-only languages on pack import/workspace creation. `es-demo` proves the Spanish–English path.
- **R7:** Workspaces are real (user, language) containers; study events carry `workspace_id`; plugin_data is workspace-scoped (nullable = user-global); combined cross-language stats = aggregate over all the user's events.
- **R8:** `Kind` ∈ `character|word`; entry identity `(written, kind, language)`; readings/attrs are child rows.
- **R9:** `lang.Pack` includes `DeriveReadings`; `entries.Upsert` normalizes → derives → renormalizes.
- **R10:** CEDICT emits `Reading{Type:"pinyin", Value: <marked>}`; no pinyin columns.
- **R11:** ja plain-form canonical is kana; `SearchPlain` converts romaji→kana; romaji is a derived reading.
- **R12:** Overlay patch shape `{Written *string; Readings []model.Reading}`; nil = untouched; store/serve verbatim.
- **R13:** Overlay readings stored as one JSON document; per-entry application; no revert endpoint in scope.
- **R14:** `source_pack` stores the manifest id (stable key); display-name mapping is a client concern.

Migration numbering consumed: 001 init, 002 auth, 003 entries (rewritten), 004 lang, 005 dict, 006 overlay, 007 levels, 008 sentences, 009 events, 010 plugins. **Next free: 011** (only if a remaining task needs one — 13/14/15/16 likely do not).

## Remaining tasks — what to watch for

### Task 13 — Search (no migration needed)
- Required: `SearchQuery{Text, Lang, Kind, SchemeID, LevelName string; Limit int}`; language-scoped candidates; normalization via `lang.For(Lang).SearchPlain`; ranked tiers exact-written → pinyin/plain exact → prefix → bopomofo → gloss.
- Mandated tests include `TestSearchToneInsensitive`, `TestSearchExactWrittenRanksFirst`, `TestSearchByGloss`, `TestSearchKindAndLevelFilter` (kind `character`), `TestSearchLanguageScoped` (手/zh vs 手/ja must not leak).
- **Carry-over tuning notes from Task 7J:** (a) particle-は (こんにちは ↔ konnichiwa) — decide within Task 13 whether `SearchPlain` needs a ha/wa folding strategy; (b) ん+small-kana apostrophe mirror: しんや derives romaji "shinya" which currently maps to しにゃ — either emit apostrophes in kanaToRomaji or document; (c) Hepburn ん=m before b/p/m ("sampo") not handled. These are search-quality items, not blockers.

### Task 14 — Sync API (no migration needed)
- `sync.Pull(ctx, db, userID, cursor)` over entries/senses/level members/sentences/plugin data/states — `updated_at > cursor`, tombstones included, cursor = server now.
- `sync.Push` — events via `events.Append` (idempotent), plugin data LWW on `updated_at` (accept if server row is older).
- **Caveat:** `updated_at` is second-truncated; cursors are per-server-clock so acceptable, but tests should not assume strict monotonicity within a second.

### Task 15 — Seed CLI + real data (no migration needed)
- `qinqin seed --data <dir> --packs <dir>` dispatching by manifest `Type`; `qinqin adduser`; `scripts/fetch-seeds.sh` for CEDICT/Unihan/JMdict/KANJIDIC2; committed small packs `hsk-mini`, `jlpt-mini` (N5 sample), `es-demo` (Spanish–English, proves R6 auto-registration end-to-end).
- **Three rulings are REQUIRED before importing real data** (deferred from Task 6 review): (a) malformed-line policy for the real ~120k-line CEDICT (skip+warn vs abort — abort is current behavior); (b) homograph policy (readings last-line-wins, senses accumulate — currently implicit); (c) surface bopomofo derivation failures operationally (a `Result` counter or log line; the fixture shows 0 failures).
- **Seed order matters:** dictionaries + character data (cedict/unihan/kanjidic2/jmdict) BEFORE level packs — level derivation skips unknown characters.

### Task 16 — Docker/compose/CI
- Multi-stage Dockerfile with `golang:1.26`+ builder, `CGO_ENABLED=0`; final image **alpine** (needs `wget` for the compose healthcheck against `/healthz`); compose stack for Portainer with `./data:/data` volume and `QINQIN_DATA=/data`; GHCR workflow on main + tags.

## Deferred minors for the final whole-branch review

These were logged per task; triage which must be fixed before merge at the end.

- **T2 (pinyin):** interjections yo/n/hng rejected (pre-existing); apostrophe input errors in converters; tone-1 vs neutral indistinguishable in bopomofo (by design — ToMarked preserves it); missing test rows (Plain apostrophes, nv3, >2-syllable/uppercase); DRY — initials slice duplicates map keys; dead early return in parse; false accepts bou/chei/len/nun in syllable table; ê/欸 and syllabic nasals rejected (pre-existing).
- **T3 (auth):** duplicate-username 409 path untested (`isUniqueViolation` is library-coupled); register bootstrap TOCTOU (brief-mandated logic); login timing not equalized (~57ms username-existence leak); sessions.user_id FK declarative only; one unasserted setup status.
- **T4 (entries):** LinkVariant self-link accepted; CharsUnder couples to entrySelect join shape; now() second truncation; link writers don't validate referenced ids; test-helper duplication.
- **T4R (retrofit):** language code normalization asymmetry (Upsert verbatim, workspace handler lowercases); attrs merge-only with no removal path; stale local dev DBs must be deleted after 003/004 rewrites (R5 spent); RFC 7396 null-deletes-key semantics undocumented.
- **T5 (dict packs):** duplicate entries in a pack double senses; import not atomic across entries vs senses; post-import rename failure returns 500 for installed dict; ExtractZip no size cap.
- **T6 (cedict):** the three Task-15 rulings above; ParseCedict naming; cedictKind script-insensitivity; comment detection column-0 only.
- **T7 (unihan):** kangxi.go doc comment cites a false U+2F00+N-1 rule (table itself correct — one-comment rewrite); radical-range validation after writes; Result.Entries undercount; naming nits; minor redundancies.
- **T7J (japanese):** the three Task-13 tuning notes above; dispatch default-branch "format not implemented" untested; prolongedVowel micro-perf.
- **T8 (overlays):** 400-before-404 precedence; all-nil PUT leaves inert row; findReading duplicated in tests; fourth now() copy.
- **T9 (levels):** Skipped may repeat forms; stale unit error message; level-name whitespace; member forms not trimmed; EntryIDs insertion order.
- **T10 (sentences):** ORDER BY id puts re-imported pack rows after user rows; POST accepts any entry kind; POST read-back O(n); empty sentence groups accepted; test-helper duplication.
- **T11 (events):** no batch body size cap; missing workspaceId → 404 not 400; within-batch duplicate ids untested; ULID format unvalidated; sub-second since precision.
- **T12 (plugins):** PUT-state response timestamp precision mismatch; PUT data write-then-read version race in response; IFNULL sentinel assumes no workspace id 0; dataPlugin panic on marshal (unreachable).

## User context (keeps decisions aligned)

- Self-hosted, personal use; owner maintains feature plugins themselves (compile-time on mobile, runtime data packs); Portainer deployment; iOS constraints accepted (no downloaded native code).
- Language agnosticism is a core product goal: zh + ja ship as code packs; simple languages are runtime-addable data-only packs (es-demo is the acceptance case); no further languages planned for now.
- Owner pauses execution for token/time budgets — prefer checkpointed, reviewed work over long unbroken runs.

## Definition of done for Phase 1

All 18 tasks complete with clean task reviews; final whole-branch review triaged (deferred minors either fixed or explicitly parked); Docker image builds and `docker compose up` serves a seeded `/healthz`; branch merged and pushed.
