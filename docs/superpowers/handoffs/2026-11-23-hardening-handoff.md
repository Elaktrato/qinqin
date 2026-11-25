# Pre-Android hardening handoff — 2026-11-23

Tracker #166, sub-issues #167–#175, and #176 (lemma-rules packs), built from `develop` on the collection
branch `feature/hardening-batch`.

Each item went through the same steps: spec, plan, test-first build, independent review, then a fix wave. #176
needed a second fix wave because of a security finding. Mutation checks were run at the review and again
before each merge. Nothing went to `main`; no tag or release was made.

The owner moved #157 (browser end-to-end tests) to the architecture clean-up #190. #185, #186 and #189 were
postponed until after #199 (see `docs/ROADMAP.md`).

## 1. What shipped

| Issue | Item | Collection merge | Contract |
|---|---|---|---|
| #169–#172 | Frozen migration code (`step032`); ordered shutdown (HTTP drain, background jobs, janitors, DB last) and HTTP timeouts; data-pack plugin rows hidden; the pack-type table `internal/packtype` | `c1797346` | `docs/contracts/packages/pack-types.json` |
| #167, #173, #174 | Unreadable rows: skipped and counted, never overwritten (web), and skipped in the pull with writes refused as 409 `study_row_unreadable` (server). Sign-out, a 401 or a user switch ends the session and clears every per-user cache. Every study write takes its workspace | `d8fb0415` | `docs/contracts/sync/unreadable-rows.json` |
| #168 | Every API error is `{error, message}` with a catalogue code; the web shows errors by code; a recover wrapper turns a panic into a coded 500 | `e0339bf7` | `docs/contracts/auth/errors.json` |
| #175 | One queue builder for deck and level sessions and the setup counts; Study all ignores every daily limit | `e952f609` | `docs/contracts/cards/session-queue.json` |
| #176 | `lemma-rules` pack type with the seeded `ja-lemma` pack; hot reload; a bounded work budget per call and per request; rate limits on segment and lookup | `d7d81c25` | `docs/contracts/lemma/` (`budget.json`, `parse.json`) |

`develop` merges: `72705c92` (#167–#174) and the merge that adds this handoff (#175, #176).

## 2. What you must check by hand

Nothing was seen in a browser or on a device.

1. **Shutdown (#170):** run `docker compose down` during a pack upload and during the first-start seed. The
   upload rolls back. The seed is finished at the next start.
2. **Errors (#168):** trigger a few failures: a wrong password, a pack without a licence, a deleted workspace
   in another tab. Each screen shows an English sentence, never JSON. An old tab may show raw JSON until it
   reloads.
3. **Sign-out (#173):** sign in as A, study, then sign out and sign in as B on the same browser. None of A's
   decks, workspaces, notes or lookups appear.
4. **Study all (#175):** in a deck with more than 20 new cards and no limits of its own, Study all now
   includes every new card. Before, it stopped at 20.
5. **Lemma packs (#176):**
   - Settings → Data lists "Lemmatizer rules" with `ja-lemma`.
   - The reader still resolves している / 食べちゃった.
   - Uninstalling `ja-lemma` falls back to the built-in table, and a restart does not reinstall it.
   - Tapping quickly through a long text in the reader never hits the new rate limit (300 burst, then 20 per
     second per address on the public lookup routes; 6 segmentations in flight per user).

## 3. Rulings worth knowing

All of them are in the specs and plans `docs/superpowers/{specs,plans}/2026-11-23-*.md`.

- An unreadable stored row makes the server's backup export fail rather than silently drop the row.
- Error statuses are unchanged apart from one: a pack import that fails for a reason other than the pack is
  now 500 `internal`.
- An installed lemma-rules pack replaces the built-in table for its language. Only one pack per language is
  allowed, and Chinese tables are refused. A language that has only a table gets segment and lookup through
  the API, but no reader.
- The lemma work budget is counted in units, so every engine (Android included) stops at the same place:
  4,096 per call, 8,192 and 128 probes per window, 16M per request. The Japanese table uses about a fifth
  of each.
- Offline Study all prepares at most 200 extra entries.

## 4. What's next

The architecture clean-up #190, in the owner's order:
- **Phase 1:** #198, #191, #197, #157. #133's packs stay owner-side.
- **Phase 2:** #192, #194.
- **Phase 3:** #193, #196, #199, then #185, #186, #189 and last #195.

The next release notes must say: "open the app online on every device before upgrading" (#198), and that
v0.3.x clients are no longer supported.

## 5. Gates

On the final collection branch:
- web check: 0 errors; build ok;
- full vitest under Node 26: 12,567 passed;
- `gen-api-docs --check`, `check-sources` and the script tests: ok;
- full Go run: green apart from the sandbox-only `internal/ai` IPv6 test.

CI was green on `72705c92`.
