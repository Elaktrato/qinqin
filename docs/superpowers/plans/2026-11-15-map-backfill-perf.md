# Coalesce legacy backfill mastery recompute (#26)

Issue: every resolved legacy card publishes a new `cards` array, re-running the full mastery derivation on the map (now `routes/stats/characters/+page.svelte`; the map moved under Stats). Cached resolutions re-fire progress on each visit.

## Design
- `fillMissingWrittenProgressively` seeds `resolved` from the entry cache and publishes once for those (skipped when no cached value changes a card), then fetches only uncached ids.
- Fetch resolutions are throttled by time: the first publishes at once, later ones batch into one trailing publish per `intervalMs` (default 250). The final result is always published before the promise settles; the pending timer is cleared on finish, so no timer or publish outlives the run.
- The page callback is unchanged (it already guards stale loads by sequence).

## Rulings
- Ruling: throttle by time (250 ms), not by animation frame — a frame fires after almost every resolution at realistic fetch latency, so it would not reduce recomputes (an earlier draft did this and was wrong) — a 250 ms lag on the progressive paint, which is imperceptible next to the fetch time.
- Ruling: coalesce in the cache module, not the page — one fix serves every caller and the count is unit-testable with fake timers — none.
- Ruling: cached entries publish once up front, and not at all when nothing changes — removes the per-visit re-fire — none.
- Ruling: keep the `onProgress` API, add an optional options argument (`intervalMs`) — no caller changes.
- Ruling: no AbortSignal — the page already drops stale results by sequence number and the fetches are small — a navigated-away backfill finishes its fetches (they also fill the cache) — wasted requests only.

## Known limits
- The written cache is module-level and never cleared on sign-out or workspace switch (no hook exists). Entry ids are global dictionary ids, so it cannot leak across workspaces; it only holds public dictionary forms until reload.

## Tasks
1. Tests (fake timers, 4 concurrent fetches of 50 ms): 500-card backfill publishes <= duration/250ms + 2 times (was 500); cached ids publish once; final publish complete; no publish or timer after resolve.
2. Implement. 3. Gates; real-app check on the map page with a legacy deck.
