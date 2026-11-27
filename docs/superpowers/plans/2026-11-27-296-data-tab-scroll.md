# #296 — the Data tab scrolls sideways on phones (2026-11-27)

Milestone v0.9.0, phase 1 (foundations and bugs). Branch `feature/v090-296-data-tab-scroll`.

## What

On a phone, Settings → Data scrolls sideways: a pack in the pack list (`lib/settings/PackManager.svelte`) shows a
string with no break opportunity (a long id, a URL in the attribution, a package line) and widens the page. The
`.pack-head` flex row's children have no `min-width: 0` and nothing in the item has `overflow-wrap`.

Fix the pack list, give the rest of Settings the same guard (wide tables scroll inside their own box), and add the
general **"no horizontal scroll at 360 px" guard** the v0.9.0 plan (§3 "Phone first") refers to: an e2e helper
and a spec that visits every main page at 360 × 740 as a signed-in learner with fixture data, and fails on planted
overflow. Every later screen is checked with it.

## Tasks

1. This plan.
2. Guard first: `apps/web/e2e/support/layout.ts` (`PHONE`, `sidewaysOverflow`, `expectNoSidewaysScroll`) and
   `apps/web/e2e/tests/phone-width.spec.ts` (main pages, Settings tabs, Admin sections, sign-in pages, Settings →
   Data with a 120-character pack, planted overflow). Run it on the unfixed code and see Settings → Data fail.
3. Fix: `overflow-wrap: anywhere` and `min-width: 0` in the pack list; a shared `.ui-table-scroll` box in
   `app.css` (positioned, `overflow-x: auto`, focus ring) around every `.ui-table` (users, invites, sessions,
   access tokens, languages, the theme contrast tables, the Sources tables); a lint test
   (`src/lib/ui/lint/tableScroll.test.ts`) that every `.ui-table` sits in one.
4. Docs: wiki Development ("Phone width"), record 0007, `docs/releases/NEXT.md`.

## Rulings

- Ruling: the guard compares against the test's viewport width (360), not `window.innerWidth` — with
  `isMobile: true` Chromium widens the layout viewport to fit a page that is too wide (it zooms out), so
  `scrollWidth <= innerWidth` alone passes on a broken page; the guard also asserts `innerWidth` is still 360 —
  cost if wrong: none found; a test without `isMobile` gets the same numbers.
- Ruling: what is inside a box that scrolls or clips sideways (`overflow-x` other than `visible`, below the root)
  is bounded by that box, which is checked itself; an absolutely positioned element is only bounded by boxes from
  its containing block up, a fixed one by none — the issue wants wide tables in their own scroller, and the first
  real finding was a visually hidden column label (absolute) in the language table's unpositioned scroller,
  which widened Settings → Data to 1229 px — cost if wrong: a deliberate clipped overflow that also widens the
  page would be missed; the `scrollWidth` assertions still catch that.
- Ruling: the page root and body do not count as bounding boxes — a root with `overflow-x: hidden` would hide a
  page that is too wide (the planted test covers it) — cost if wrong: none.
- Ruling: only the outermost box that sticks out is reported, at most 20 — a too-wide page otherwise lists every
  child of the fixed bottom bar — cost if wrong: a second, unrelated offender shows only after the first is fixed.
- Ruling: the long pack of the Data tab is added to the server's real answers with `page.route` (route.fetch,
  then one more row) instead of installed — packs are server-wide and the worker's server is shared by tests
  running in parallel; the server's pack id rules also limit what can be installed — cost if wrong: a change to
  how the list renders a real pack that the fake row does not mirror; the row is a copy of a real row with
  long fields. Record 0007 allows this.
- Ruling: long URLs in attributions break (`overflow-wrap: anywhere`) rather than becoming a link with a short
  label — the issue allows either; an attribution is free text that can hold several URLs, and turning it into
  links needs URL parsing and a decision on which hosts to trust — cost if wrong: a long URL takes several lines.
- Ruling: one shared `.ui-table-scroll` class in `app.css` (with the Sources and theme-contrast `table-wrap`s
  moved onto it) instead of a local wrapper per component — five components needed the same box, and a shared
  class is what the lint test can check — cost if wrong: none; it is opt-in like `.ui-table`.
- Ruling: the scroller is a labelled region with `tabindex="0"`, as the Sources page already did — a scrolling
  region must be reachable by keyboard (WCAG 2.1.1) — cost if wrong: one more tab stop per table; the language
  table's region shares its section's name.
- Ruling: `/study/session` is not in the spec — the study session code is being split in parallel (#278) and the
  session screen needs a started session; the study start, scheduling and advanced pages are in — cost if wrong:
  the session screen is checked by hand or by #278's follow-up.
- Ruling: `networkidle` before measuring — a page measured before its lists load would pass vacuously; it is a
  condition, not a sleep — cost if wrong: a page that polls would time out the test (none does now).

## Execution record

- Test-first for the guard: the spec was written and run on the unfixed code. Settings → Data failed with the pack
  name and id sticking out (`strong "Long xxx…" [24, 1007]`, `code "e2e-xxx…" [24, 963]`). After the pack-list fix
  it still failed: the language table's visually hidden "Actions" label (absolute, in an unpositioned scroller)
  widened the page to 1229 px, which the first version of the guard missed (it treated every scroller as
  bounding); the guard learned containing blocks and the scroller became positioned. Then Admin → Users failed:
  the users table had no scroller at all. All three are fixed.
- The first run also showed why `innerWidth` cannot be the yardstick (the guard reported a 444 px viewport).
- The planted test shows the guard fails on: a long unbroken string (box fits, text does not), a wide box under a
  root with `overflow-x: hidden`, an absolute label escaping an unpositioned scroller; and passes on the same box
  in a (positioned) scroller.
- The lint test was run against the unfixed components and failed on all 17 tables, then passed.
- Commits: the fix with its lint test, then the guard and spec (green at each commit), then docs.
- Gates: see the report at the end of this record.

## Local follow-up

- #296: open Settings → Data (and Admin → Users, Settings → Account) on a phone and in the Android app on the
  owner's instance, where the problem was seen. Look for: no sideways scroll; long ids and attributions wrap;
  wide tables scroll inside their box. If it still scrolls: run the guard's measurement in the browser console
  (the body of `sidewaysOverflow` in `apps/web/e2e/support/layout.ts`) to name the element.
