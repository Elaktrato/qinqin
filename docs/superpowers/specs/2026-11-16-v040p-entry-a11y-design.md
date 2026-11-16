# Entry view robustness, page titles and accessibility — design (issues #17, #12)

Status: Draft (2026-11-16), v0.4.0 prep item 3. Written unattended; every non-obvious call is a
**Ruling** (`what — why — cost if wrong`). Direction: "All remaining bullets; titles on every route (incl.
routes added in v0.3.0), announced search results, heatmap day counts for screen readers. #12's
English-only bullet closes as moved to #73."

Both issues carry an owner comment (2026-11-15) saying most bullets were done on `develop`. Every bullet
was re-checked against the code on `feature/v040p-entry-a11y` (base `11a1f62`) instead of trusting the
comments. Web only: no server change, no new route, no contract change.

## #17 — entry view robustness (`apps/web/src/routes/entry/[id]/+page.svelte`)

| Bullet | State found | Decision |
|---|---|---|
| A failed `/chars` blanks the page (`Promise.all`) | Fixed in substance: the entry renders first, `loadExtras` wraps each optional request in its own `.catch`, then `Promise.all`. A dom test covers a failing `/chars`. No test covers a failing radical fetch. The logic sits in the component. | Move the optional loads into a pure module `$lib/entry/extras.ts` that uses `Promise.allSettled` (literally what the issue asks, and each section falls back on its own), unit-test it (chars failure, radical failure, both), add a dom test for a failing radical fetch. |
| `/chars` fetched for words | Done: `kind === 'word'` skips the request; dom test exists. | Kept in the new module and unit-tested there as well (the module is the code path the page uses). |
| Licence text plain; consider linking | Not done; the earlier comment ruled "stays plain". | Link only licences recognised by an exact name map (below); everything else stays plain text. |
| Radical shows `Radical entry #{id}` | Done: a second `getEntry(radicalId)` fetches the written form; dom test exists. The id text remains as the fallback when that fetch fails. | Keep; the fallback is covered by the new failing-radical test. |
| Variants/chars use raw `readings[0].value` | Done: both lists call `formatReading`; the chars list has a dom test, variants have none. | Add a dom test for the variants list (verification only: expected to pass on first run, recorded as such). |

Added during the build (real-app check): a radical that is its own radical (人, `radicalId` equal to its
own id) takes its own written form instead of fetching itself again.

### Licence links

`$lib/licenses.ts` exports `licenseUrl(name): string | null`. The name is trimmed, inner whitespace
collapsed and lower-cased, then looked up in a fixed map of SPDX ids and the common written names:

| Names (case-insensitive, exact) | URL |
|---|---|
| `CC BY 4.0`, `CC-BY-4.0` | `https://creativecommons.org/licenses/by/4.0/` |
| `CC BY 3.0`, `CC-BY-3.0` | `https://creativecommons.org/licenses/by/3.0/` |
| `CC BY-SA 4.0`, `CC-BY-SA-4.0` | `https://creativecommons.org/licenses/by-sa/4.0/` |
| `CC BY-SA 3.0`, `CC-BY-SA-3.0` | `https://creativecommons.org/licenses/by-sa/3.0/` |
| `CC0`, `CC0 1.0`, `CC0-1.0` | `https://creativecommons.org/publicdomain/zero/1.0/` |
| `Unicode License v3`, `Unicode-3.0` | `https://www.unicode.org/license.txt` |

- Ruling: only an exact map lookup links a licence; no regex, no substring, no "contains CC" heuristics;
  `Unicode License v3 (fixture)`, `EDRDG Licence`, `per file`, free text and unknown versions stay plain
  — the owner's earlier worry was a wrong link on free-text names, and an exact map can only link a name
  that unambiguously is that licence — cost if wrong: a correct licence written in an unusual way is not
  linked (still readable as text); adding a name is a one-line change.
- Ruling: the Sources page audio table's `licenseHref` (three CC regexes today) delegates to the same
  map — one rule for every licence link in the app; the regexes already only matched whole names, so the
  map links the same names plus SPDX ids — cost if wrong: none visible; the existing audio tests pin it.
- Ruling: the other Sources tables (dictionaries, levels, frequency, components, grammar) stay as they
  are — #17 is about the entry view; changing six tables is outside the bullet — cost if wrong: an
  inconsistency the owner can ask for later (the helper is ready).
- The entry's licence link opens in a new tab like the attribution links next to it
  (`target="_blank" rel="noopener noreferrer"`).

## #12 — page titles and accessibility

| Bullet | State found | Decision |
|---|---|---|
| Document titles | `app.html` has `<title>qinqin</title>`; every `+page.svelte` sets `pageTitle(…)` (`"<Page> · <Section> · qinqin"`) or inherits it from `stats/+layout.svelte`; the four plugin pages set their own. Gaps: Settings → Admin sections all read "Admin · Settings · qinqin"; every flashcards view (deck, deck settings, level, starter deck) reads "Decks · Flashcards · qinqin"; nothing stops a future route from forgetting a title. | Route-walk test (below); per-section Admin titles; per-view flashcards titles; a dom test that the plugin dispatcher ends with the plugin's title. |
| Search results announced | Done on `/search` (visually hidden live count), `/search/parts` (live `statusLine`), reader source search, deck word filter, character map search. Gaps: the lookup history's "No card yet" filter changes the list silently; the time-zone search in Settings → Study filters the zone list silently. | Live counts for both, text from pure functions. |
| Heatmap day counts | Done: `ActivityHeatmap` grid is `aria-hidden` with a visually hidden summary and a "Daily activity" list (one item per active or vacation day, dom tests). The weekly strip (`WeekStrip`) gives every day its full name with reviews ("Monday 16 November: active, 42 reviews") as screen-reader text (dom test). No other heatmap exists (`level-{n}` cells only in `ActivityHeatmap`). | Verified, no change. |
| English-only copy, `<html lang="en">` | Out of scope here. | Not implemented; moved to #73 (item 8). The orchestrator comments on the issue. |

### Route-walk title test

`src/lib/routeTitles.test.ts` (node environment) walks `src/routes/**/+page.svelte` with `fs`, and fails
when a page neither sets a title itself nor sits under a `+layout.svelte` that does. "Sets a title" means
the source has a `<svelte:head>` block containing `<title>{pageTitle(`; using `pageTitle` keeps the format
consistent. For `/p/[plugin]/[...rest]` it also resolves every component registered as a plugin page in
`src/lib/plugins/index.ts` and applies the same check, because those pages render inside the dispatcher.
The checker is a pure module `src/lib/testing/routeTitles.ts`, unit-tested on small fixtures.

- Ruling: a static source check, not rendering each page — rendering 19 pages plus plugin views needs
  per-page API mocks and would be the test nobody keeps green; the static rule is what "forgot the title"
  looks like — cost if wrong: a page that has the markup but computes an empty title passes (the
  existing per-route dom titles test catches the main ones).
- Ruling: titles are counted from an ancestor layout — `/stats`, `/stats/week` and `/stats/characters`
  are tabs of one view whose title the layout owns ("Week · Stats · qinqin") — cost if wrong: none; a
  page may still override.
- Ruling: Admin titles read "Users · Admin · Settings · qinqin"; flashcards views read "Deck ·
  Flashcards", "Deck settings · Flashcards", "Level deck · Flashcards", "Starter deck · Flashcards" — the
  deck's own name would need the deck loaded in the router component; a stable view name is announced at
  once and never flips — cost if wrong: a tab bar with several decks shows the same title.
- Ruling: the plugin dispatcher keeps its title for the loading and "not available" states only; when a
  plugin view renders, that view's title wins (verified by a dom test rather than restructured) — cost if
  wrong: a re-run of the dispatcher's title effect could briefly show "qinqin"; the test pins the end state.

### Live counts

- Lookup history: `historyCountText(shown, total, filter)` in `$lib/lookups/historyView.ts` → `''` with
  no history, "12 words" for All, "3 of 12 words with no card yet" for No card yet. It is shown in a
  plain paragraph (`.history-count`) above the list that always follows the list (also after Add and
  Remove); a separate visually hidden `aria-live="polite"` paragraph is filled with the same text only when
  the filter changes — Add and Remove already announce through the page's `role="status"` message.
- Time zones: `zoneMatchText(supported, query)` in `$lib/settings/zoneSettings.ts` (pure) → `''` for an
  empty query, "No time zones match “x”.", "1 time zone matches." or "5 time zones match." in a visually
  hidden `aria-live="polite"` paragraph. The component feeds it the query only after typing pauses for
  500 ms, so a screen reader hears one count, not one per keystroke.
- Ruling: the lookup count is visible, the zone count hidden — the lookup list is long and a count helps
  everyone; the zone picker is a `<select>` whose length sighted users see — cost if wrong: cosmetic.

## Out of scope

Localisation (#73), the Sources page's non-audio licence cells, deck names in titles, server changes.

## Tests

Unit: `licenses.test.ts`, `entry/extras.test.ts`, `testing/routeTitles.test.ts`, `routeTitles.test.ts`
(the walk), `settings/tabs.test.ts`, `flashcards/route.test.ts`, `lookups/historyView.test.ts`,
`settings/zoneSettings.test.ts`. Dom: entry page (radical failure, variants), `Senses.dom.test.ts`
(licence link and plain fallback), settings page (admin section title), plugin dispatcher title, lookups
page count, `StudyDaySettings.dom.test.ts`.
