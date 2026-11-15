# Coalesce legacy backfill mastery recompute (#26)

Issue: every resolved legacy card publishes a new `cards` array, re-running the full mastery derivation on the map (now `routes/stats/characters/+page.svelte`; the map moved under Stats). Cached resolutions re-fire progress on each visit.

## Design
- `fillMissingWrittenProgressively` seeds `resolved` from the entry cache and publishes once for those, then fetches only uncached ids.
- Fetch resolutions mark the batch dirty; one flush is scheduled per animation frame (injectable `schedule`, default `requestAnimationFrame`, falling back to `setTimeout(16)`). A final flush publishes the complete result before the promise resolves and cancels any pending frame.
- The page callback is unchanged (it already guards stale loads by sequence).

## Rulings
- Ruling: coalesce in the cache module, not the page — one fix serves every caller and the recompute count is unit-testable without a DOM — page-level rAF would have been simpler to read but untestable here — none.
- Ruling: rAF with a setTimeout fallback, injectable for tests — rAF pauses in background tabs, which is fine because the final flush is synchronous with completion — a hidden tab shows the final state only at the end.
- Ruling: cached entries publish once up front, not per entry — removes the per-visit re-fire the issue names — none.
- Ruling: keep the public API (`onProgress(cards)`), add an optional third options argument — no caller changes.

## Tasks
1. Tests: 500-card backfill publishes few times (was 500); cached ids publish once; final publish complete; no publish after resolve.
2. Implement. 3. Gates; real-app check on the map page with a legacy deck.
