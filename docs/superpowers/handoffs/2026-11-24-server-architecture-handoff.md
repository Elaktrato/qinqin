# Server architecture handoff (architecture clean-up, phase 2) — 2026-11-24

Phase 2 of #190: #192 and #194. Each issue had its own branch from `develop` and went through a plan, a
test-guarded refactor, an independent review, one fix wave and orchestrator mutation checks, then merged
`--no-ff` with CI green, e2e included. Nothing went to `main`, and no tag or release was made.

## 1. What shipped

| Issue | Item | `develop` merge |
|---|---|---|
| #192 | `internal/pack` (manifest, zip limits, notices, types and formats, errors) and one pack-type table with a behaviour half in `packs` that every pack operation loops over. `pack.UpsertRegistry` means an unchanged re-import writes nothing. `pack.BeginWrite` makes pack transactions take the write lock first. Record `0008-pack-types.md` ("how to add a pack type") | `b1ccaae6` |
| #194 | `internal/api` holds no SQL (93 findings → 0, guarded by `TestNoSQLInAPI`). New `internal/workspaces`, whose delete is guarded against the migrated schema. The language registry moved to `internal/lang`, and lookups moved into `audio`, `dict`, `auth`, `ai`, `levels` and `sentences`. Record `0003` is now Accepted | `bf4f82ec` |

## 2. What changed for admins and clients

All of it is logged in `docs/contracts/CHANGELOG.md`.

- Re-importing an unchanged components, audio or font pack no longer changes its `updatedAt` in Settings →
  Data (#192). The other types already behaved this way.
- A pack manifest that breaks two format rules now reports the rule of its own type (#192).
- The legacy dictionary upload and delete routes now store and remove licence texts like every other pack (#192).
- The language-removal message reads "an audio pack" (#194).
- Nothing else: the seed order was pinned before #192 and compared with a real `qinqin seed`, and the answers
  of every route #194 moved were pinned before the move.

## 3. What you must check by hand

- Settings → Data: upload a pack, install it, install it again unchanged (its "updated" date stays), then
  uninstall it.
- Install a pack while another one's data package is still being built. It must succeed; before #192's fix
  wave it could fail with "database is locked".
- Delete a workspace that has books, highlights, journal photos and study data. The rest of the account is
  untouched and the workspace's data is gone.

## 4. Rulings worth knowing

They are in `docs/superpowers/plans/2026-11-24-{pack-system,domain-packages}.md`.

- **#192:**
  - `packtype` merged into `pack`. The table has a data half (`pack.All`) and a behaviour half (`packs.handlers`),
    checked row by row, because one literal would form an import cycle.
  - A later migration that changes data rows must clear the type's `content_hash`.
- **#194:**
  - The guard is an SQL scan, not an import rule, because `api` must still pass the `*sql.DB` on.
  - Domain types carry no JSON tags; `api` converts them.
  - `langMu`/`packMu` stay in the server, and each domain function documents that its caller serialises it.
- **Owner direction (2026-11-24):** backwards compatibility is not required, so refactors may change routes,
  payloads and contracts (logged in the CHANGELOG). Stored user data must still survive an upgrade, and the e2e
  suite stays green.

## 5. Follow-ups

- `cmd/qinqin` `TestServeRebuildsTheRefreshedBundledPackage` is flaky on `develop` from before #192, failing
  about 1 run in 7. It looks like a startup race between the lemma-rules sync and the reconcile.
- A book or photo file whose removal fails after a workspace delete stays on disk. This predates phase 2;
  there is no sweep yet.

## 6. What's next

Phase 3, in this order:
1. #193 study data layer (its acceptance items are on the issue).
2. #196 one state model.
3. #199 retire code plugins.
4. #185 AI conversation partner, #186 AI example sentences and #189 profile picture, as core features.
5. #195 folder layout, last.

Under the owner's direction, these may replace old paths outright instead of keeping shims.

## 7. Gates

On `develop` at `bf4f82ec`:

- Full Go run green, apart from the sandbox-only `internal/ai` IPv6 test.
- Web check 0 errors; build ok.
- Vitest under Node 26: 12,605 passed.
- e2e: 13 passed.
- Script tests and `gen-api-docs --check` ok.
- CI `test` and `e2e` green.
