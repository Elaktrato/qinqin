# Visual rework — the prep run's additions

Date: 2026-11-17. Epic #95. The design (`docs/superpowers/specs/2026-11-16-visual-rework-design.md`) and the mockups
were written **before** the v0.4.0-prep run (handoffs `2026-11-17-v0.4.0-prep-handoff.md`,
`2026-11-17-v0.4.0-prep-takeover.md`), which added interface the mockups do not show. This document lists every such
piece of interface, says which visual-rework issue restyles it, whether that issue's plan
(`docs/superpowers/plans/2026-11-17-vr-*.md`) already covers it (checked by grep and by reading the task text), and
decides what was uncovered. It also lists where the mockups no longer match the app.

Sources read: the two handoffs (§2 and §6 hand-check lists), `docs/contracts/overview.md`, `README.md`,
`docs/wiki/Settings-tour.md`, and the code on `feature/visual-rework` at `f7ef932` (`apps/web/src/routes`,
`lib/settings`, `lib/milestones`, `lib/features`, `lib/account`, `lib/admin`, `lib/api/packages.ts`,
`routes/sources`, `lib/sources`, `lib/weekly`, `lib/goals`, `lib/pwa`, `lib/entry/displayForm.ts`,
`lib/study/cardView.ts`).

Follow-through: the plans not yet being built — reader (#102), journal (#103), search and entry (#104), stats (#105),
remaining pages (#106) — gained a section **"Adaptations to the prep run"** with the tasks and acceptance checks
below. The home (#100) and flashcards (#101) plans are being built and are **not edited**: their extra requirements
are in "For #100 (home)" and "For #101 (flashcards)" at the end, to be forwarded to their builders. The frame (#99),
themes (#96), fonts (#97) and base components (#98) are merged; what they did is recorded, not reopened.

Rule for every decision below: design §5–§6 and #106's layout rule ("a restyle may change how a region looks, not
move, merge, split or add regions"); a question that needs a new layout is an **Owner check**, not built.

## 1. Audit

"Covered" means the plan names the component or behaviour in a task with an acceptance check. "Partly" means the
component is in a task's file list but the prep-run behaviour is not checked or is described wrongly.

| # | Prep-run interface | Where (code) | Owner | Covered? (evidence) | Decision |
|---|---|---|---|---|---|
| 1 | Admin re-authentication dialogs: own password + authenticator/recovery code | `lib/admin/ReauthFields.svelte`, `ResetMfaDialog`, `DeleteUserDialog` | #106 P14 (P5 lists `ReauthFields`) | Partly — P14 "re-auth fields are `Field`s" only | Amended P14: `focusField()` kept, code field only when `needsCode`, autocomplete kept, coded errors, one danger confirm (R1) |
| 2 | Inline re-auth in Users (grant admin, create admin, address, demote/disable), Email save/remove, Security lowering + "sign everyone else out", Server backup | `UsersAdmin`, `EmailAdmin`, `SecurityAdmin`, `ServerBackup` | #106 P14 | Partly — not mentioned | Amended P14 (same fields, inside each section's one form) |
| 3 | MFA-reset button | `UsersAdmin` row action → `ResetMfaDialog` | #106 P14 | Partly — "actions in a `Menu` or `IconButton`s" | R2: a worded row action, never icon-only |
| 4 | Kana display forms (の) on study card faces | `lib/study/cardView.ts` `withShownWritten`, `routes/study/session` | #101 | **No** (grep `cardView`, `display form`: 0) | For #101 item 1 |
| 5 | Kana forms on deck rows, starter/system deck details; reading beside duplicate headwords; gloss for equal display forms | `decks/deckRows.ts`, `DeckDetail`, `StarterDeckDetail`, `SystemDeckDetail`, `starterDecks.ts` (`readingBeside`, `duplicateGlosses`) | #106 P15/P16 | **No** | Amended P15/P16 |
| 6 | Entry page "Also written: 事、縡" line | `routes/entry/[id]/+page.svelte`, `otherForms` | #104 | Yes (plan lines 92, 253) | — |
| 7 | Search hit shows the searched written form (display form, never re-derived) | server `Headword()`, `handlers_search.go` | #104 | **No** | Amended #104 (ResultRow shows `hit.written` as given) |
| 8 | Reader popup: "Add to deck" snapshot is the display form | `features/reader/AddToStudyButtons.svelte`, `docs/contracts/reader/popup-written.json` | #102 | **No** | Amended #102 |
| 9 | Lookup history: display form + reading beside duplicates | `lib/lookups/historyView.ts`, `routes/lookups` | #106 P22 | **No** | Amended P22 |
| 10 | Page titles (`pageTitle()`, route-title walk) | `lib/pageTitle.ts`, `routeTitles.test.ts`, `pageTitles.dom.test.ts` | every page item | Partly (stats S8 only; frame sets the phone title) | General acceptance in every amended plan; R9 for search with a selected entry |
| 11 | Announcements: lookup count, time-zone counts | `routes/lookups`, `StudyDaySettings` | #106 P22, P9 | Partly ("live regions unchanged" globally) | Amended P9/P22 with named cases |
| 12 | Licence links on entry senses | `lib/licenses.ts`, entry senses | #104 | Yes (plan line 102) | — |
| 13 | Settings → Features switches (+ known flicker: nav blanks while a switch saves) | `lib/settings/FeatureSettings.svelte`, `featureSwitches.ts` | #106 P10 | Yes for the switches; flicker not | Amended P10 (check the flicker, fix in P10 if it is still there) |
| 14 | Per-feature "switched off" notice | `lib/features/FeaturePage.svelte` | #106 P21 | Yes | Amended P21 (legacy `/p/…` redirect renders no notice first) |
| 15 | Switched-off features on Home (widgets, editor list) | `lib/widgets/layout.ts`, `routes/+page.svelte` | #100 | **No** (grep `feature`: 0) | For #100 item 4 |
| 16 | Flashcards / reader at `/flashcards`, `/reader`; `/p/…` redirects (with fragments) | `routes/flashcards`, `routes/reader`, `lib/legacyRoutes.ts` | #99 (sections), #102, #106 P2/P21 | Partly (frame `currentSection` tests; P2 manifest) | Amended #102 (deep links) and P21 |
| 17 | Settings → Data: package line per pack (revision, size, state), build error (admins), "Packages are being built", catalogue unavailable | `PackManager.svelte`, `packsView.ts` `packageLine`, `lib/api/packages.ts` | #106 P13 | **No** — P13 describes a `.ui-table` of type/version/licence | R3; amended P13 |
| 18 | Stroke, font and theme pack groups in the pack list | `packsView.ts` `TYPE_ORDER` | #106 P13 | Partly (theme packs only) | Amended P13 (one `Section` per type, today's order) |
| 19 | Staged upload licence review incl. the per-theme contrast table | `PackManager.svelte` review, `contrastView` | #106 P13 | Partly — P13 says "as a list" | R4: the tables stay tables (`.ui-table`) |
| 20 | Pack uninstall confirmation (a raw `<dialog>`, not one of #98's six) | `PackManager.svelte` | #106 P13 | **No** | Amended P13: onto `Dialog` |
| 21 | Sources page: dictionaries, frequency, sentences, components, themes, stroke data, fonts, audio (the last five only while installed), levels, grammar, plugins, built into qinqin (hanzi-writer, ts-fsrs, Figtree, Lucide, Catppuccin, uqr, opencc-js, Aozora/Gutenberg), shared licence notes, "more" | `routes/sources/+page.svelte`, `lib/sources/*` | #106 P23 | Partly ("every table on `.ui-table`", credits keep rows) | Amended P23 (conditional sections, anchors, credit lists as hairline rows, signed-out view) |
| 22 | Milestones card on Home (shown once, Dismiss, "See all", status region) | `lib/milestones/MilestoneCard.svelte`, `HomeMilestones.svelte` | #100 | Partly — goal names it, H10 only "milestone cases unchanged"; the card keeps a pill-bordered Dismiss and a ★ glyph | R5; For #100 item 1 |
| 23 | Milestone history in Stats → Week, live-region announcement, seen state | `MilestoneHistory.svelte`, `routes/stats/week` | #105 S11 | Yes ("restyle only", existing cases unchanged); pills not named | Amended #105 (pills off, anchor, status region) |
| 24 | Settings → Account → Interface language | `AccountSettings.svelte` (`account-language` section), `lib/api/interfaceLanguage.ts` | #106 P12 | **No** — P12's section list omits it and has the wrong order | Amended P12 |
| 25 | en-GB date formatting (English without region) | `lib/i18n/format.ts` (`formatDate`, `formatNumber`), i18n lints | every item | Implicit (lint "no fixed-locale formatting") | General acceptance; the mock dates already read en-GB |
| 26 | API errors shown by code (`apiError.<code>`) | `lib/api/apiErrors.ts`, `errorText()` | every item | **No** (grep `apiError`: 0) | General acceptance in every amended plan; For #101 item 4 |
| 27 | Provisional logo as the header Home link | `lib/components/Logo.svelte`, `frame/TopBar.svelte` | #99 (merged) | Built (TopBar renders `Logo`) | Drift only (§3) |
| 28 | Theme-aware favicon | `static/favicon.svg` (`prefers-color-scheme` inside) | #99 | **No** (grep `favicon`: 0) | R6; Owner check 2 |
| 29 | Weekly summary — Home widget (compact) and Stats → Week | `lib/weekly/WeekSummary.svelte`, `WeekStrip` | #105 (page), #100 (widget box) | Partly — #105 S11 keeps compact "unchanged"; its pills/badges stay | R7; amended #105 |
| 30 | Daily goal widget | `lib/goals/GoalRing.svelte` (weight 700) | #100 | **No** | For #100 item 3 |
| 31 | Email-confirmation banner on Home and in Account | `lib/account/EmailBanner.svelte` (rounded bordered box) | #100, #106 P12 | **No** | R8; For #100 item 2; amended P12 |
| 32 | Vacation, limits, goals, notes settings | `StudySettings`, `vacationForm`, `GoalSettings`, `DeckLimitsEditor`, `NoteSettings`, `DeckSettingsView` | #106 P9/P16 | Yes | — |
| 33 | Lookups page | `routes/lookups` | #106 P22 | Yes (+ row 9/11) | — |
| 34 | Settings → Appearance, quick theme switch | `AppearanceSettings`, account menu | #96/#99 (merged), #106 P8 | Yes (P8 check only) | — |
| 35 | Access tokens (list, create dialog, one-time token) | `AccessTokens`, `CreateTokenDialog` | #106 P12 | Partly (list only) | Amended P12: the one-time token in a `Panel raised` (a value to copy) |
| 36 | Offline and update banners | `lib/pwa/OfflineBanner`, `UpdateBanner` | #99 (merged) | Built (top of the panel, on tokens) | For #101 item 3 (docked bar must not cover them) |
| 37 | Offline study from the cached typed pull | `routes/study/session` `offlineSession` | #101 | **No** | For #101 item 3 |
| 38 | Stroke data from the installed strokes pack (`/hanzi/U<HEX>.json`) | `lib/study/strokeData.ts`, `WritingCard`, entry stroke player | #101, #104 | Partly (#104 Task 9 player; #101 stubs data) | For #101 item 2; amended #104 (loading / failed states) |
| 39 | Journal: AI review errors by code; dates | `lib/plugins/journal/*` | #103 | Partly (`formatDate` named; codes not) | Amended #103 |
| 40 | Settings → Plugins without flashcards/reader rows | settings page plugin list | #106 P10 | Yes | — |
| 41 | App and offline section in Account | `lib/pwa/AppSection.svelte` | #106 P12 | Yes | — |
| 42 | Characters tab absent for non-Han workspaces; summary numbers with flashcards off | `statsTabs.ts`, summary widget | #105 | Yes (S6, S8) | — |
| 43 | PWA / home-screen PNG icons still the old blue mark | `static/icons` | none | No (out of scope: needs a rasteriser) | Owner check 3 |

## 2. Rulings

- **R1** Ruling: `ReauthFields` becomes two `Field`s (password with `autocomplete="current-password"`; the code with
  `autocomplete="one-time-code"`, shown only when `needsCode`), and keeps its exported `focusField('password' |
  'code')` through the inputs `Field` exposes — the dialogs' error paths focus the field that failed — cost: `Field`
  must forward its input element (a prop binding), recorded in the base component header if added.
- **R2** Ruling: the MFA reset is a **worded** row action ("Reset two-step sign-in" with the user's name for screen
  readers), in the row's `Menu` when the row has more than two actions, never an icon-only button — an icon cannot
  carry "reset two-step sign-in" and the action escalates — cost: a wider actions column on desktop.
- **R3** Ruling: Settings → Data keeps **one `Section` per pack type** (today's `TYPE_ORDER`: dictionary,
  frequency, levels, sentences, grammar, audio, components, strokes, font, theme) with each pack as a **hairline row**
  (not a `.ui-table`): name 600 + id in the monospace stack + languages/version/date muted on the first line, licence
  and attribution lines, then one package line per data package (`packageLine`: revision, size, state) in
  `--font-size-label`, `tabular-nums`, and the build error under it in the readable `--bad` with its words
  ("Last build failed: …"). "Uninstall" a secondary `tone="danger"` button per row — a row holds up to six lines, a
  table cell would wrap them worse; this is the structure today — cost: none (P13's ".ui-table" sentence is
  replaced).
- **R4** Ruling: the staged review's contrast stays **one table per theme** (caption = theme name, scheme and
  result) on `.ui-table`, the result column in words ("Passes" / "Below") with a `--bad` text cue on failing rows —
  today's structure; turning it into a list would be a layout change — cost: none (P13's "as a list" is
  replaced).
- **R5** Ruling: the milestones card keeps **one 1px `--hair` outline**, no fill, no shadow — §5's reason: a
  once-shown, dismissable notice is a separate object — its ★ glyph becomes a line icon (`milestone` → Lucide
  `award`, added to `vendor-icons.mjs` `WANTED` at the pinned version), Dismiss a secondary `Button`, "See all" a
  plain link — cost: one more icon in the bundle.
- **R6** Ruling: the favicon stays a static SVG that follows the **browser's** light/dark (`prefers-color-scheme`),
  not the person's app theme — a favicon cannot read the app's tokens without a script swapping it, and the tab
  icon is outside the page — cost: a Latte-themed app in a dark browser shows the light-on-dark mark. Owner check 2.
- **R7** Ruling: #105 owns **all** of `WeekSummary.svelte` (it splits it into `page` and `compact`): the compact
  layout (the Home widget's insides) loses its bordered pills too (badges "In progress" / "On vacation all week" on `Chip`,
  "Retry" a secondary `Button`, weights ≤ 600); #100 only removes the widget's box — one owner per file avoids
  two branches editing it — cost: Home shows the old pills between the #100 and #105 merges.
- **R8** Ruling: `EmailBanner` becomes a **notice line** (text + the confirm link, a `--hair` rule below, no
  rounded box), the same shape as the frame's banners; on Home it stays between the heading block and the search,
  in Account at the top of the profile section (`link={false}`) — cost: none.
- **R9** Ruling: `/search` with a selected entry sets the document title to `pageTitle(written, t('search.title'))`
  ("学习 · Search · qinqin"); without a selection the title is unchanged — the master–detail page now shows an
  entry, and the entry page's own title names it — cost: one extra title case in `pageTitles.dom.test.ts`.
- **R10** Ruling: where the mockups use words that the prep run's catalogue words differently (mastery stages,
  milestone names, nav labels), the **catalogue wins** — the i18n run fixed the wording deliberately and the mocks
  were placeholders — cost: screenshots differ from the mock in words. The mastery stage names go to the owner
  (Owner check 4).

## 3. Mockup vs reality (drift)

| Mockup | App after the prep run | Handling |
|---|---|---|
| 勤 glyph as the logo in the top bar | Provisional SVG logo (`Logo.svelte`, `src/lib/assets/qinqin-logo.svg`), built into the frame | #99 built it; gallery shows the SVG |
| Phone bar title "Today" | "Home" (frame Ruling) | done (#99) |
| Nav section "Study" | Label "Decks" (`features.flashcards.title`), route `/flashcards`; Journal stays a plugin at `/p/journal` | done (#99 Rulings) |
| Account menu: name, Settings, Theme, Admin settings, Sign out | also **Sources** (frame Ruling); restricted / signed-out bars | done (#99) |
| Settings not mocked | Tabs Workspaces, Home, Appearance, Study, **Features**, Plugins, AI, Account (with **Interface language**), **Data** (packages), Admin | #106 P6–P14 |
| Home: heading, search, widgets | also the **email banner** and the **milestones card** (not a widget, never hidden by the layout); default widgets heatmap, flashcards summary, daily goal, **weekly summary** | For #100 |
| Stats Overview "words known" | "Words known" (known predicate) **and** the decks page's "Mastered" (cards only) — two numbers | #105 Ruling (kept both, wiki says why) |
| "recall, last 30 days" (desktop) vs "recall, 30 days" (phone mock) | One label `stats.summary.recall` "Recall, last 30 days"; decks page "Retention (30 days)" renamed | #105 S12 |
| Card kind "Recall" (reverse) | Same word as the 30-day **Recall** stat | Owner check 1 |
| Cards by state: New, Learning, Mature | Words widget states include **Young** (`widgets.words.note`) | #105 S8 keeps the catalogue's states (R10) |
| Mastery legend "Not started / Fresh / Learning / Mature / Learned" (and a three-stage phone legend) | Catalogue: "Not studied / Started / Growing / Solid / Learned" (`stats.map.stage.*`) | R10; Owner check 4 |
| Week: "Milestone this week: 1,000 words known" | No "words known" family; families are reviews, words studied, mature words, characters learned, streak, days active, reading hours, journal entries, level complete (`lib/milestones/catalogue.ts`) | #105 shows the real titles; Owner check 5 |
| Week "16–22 November", "Week of 16 November"; journal "Mon 16 Nov", "Monday, 16 November 2026" | en-GB formatting via the helpers (`weekly.heading.of` "Week of {range}") — matches | no change |
| Session "Show strokes" | Today's "Reveal character" | #101 Ruling (label changes) |
| Entry stroke player always there | Only when a strokes pack is installed; loading / failed states (`entry.strokes.*`) | Amended #104 |
| Settings → Data, Sources, Features, Language, milestones card, offline/update banners, switched-off notice | Not mocked at all | §1 rows; §5 layout rule |

## 4. Owner check (forward to the epic handoff)

1. **"Recall" names two things**: the card kind (reverse cards, design §9) and the 30-day stat ("Recall, last 30
   days", design §10). Keep both, or rename one (e.g. the kind "Produce" / the stat "Remembered")?
2. **Favicon**: follows the browser's light/dark, not the app theme (R6). Acceptable, or should it take the theme
   accent (needs a script that swaps it)?
3. **PWA / home-screen icons** are still the old blue mark (needs a rasteriser; not in any visual-rework item).
4. **Mastery stage words**: the catalogue's "Not studied / Started / Growing / Solid / Learned" or the mock's "Not
   started / Fresh / Learning / Mature / Learned"?
5. **A "words known" milestone** (the mock's example) does not exist; add a family (a feature, not a restyle)?
6. **Settings → Data on the phone**: each pack row has up to six lines (R3); a collapsed row ("details")
   would be a new layout — keep all lines open?

## 5. General acceptance for every remaining page item (#102–#106)

Added to each amended plan:

- Page titles: `routeTitles.test.ts` and `pageTitles.dom.test.ts` pass unchanged (or gain only the cases a Ruling
  names).
- Errors keep coming from `errorText()` / `apiError.<code>` — no restyle rewords or hard-codes an error; a coded
  error rendered in the new error slot is asserted once per item.
- Dates and numbers only through the locale helpers (`lib/i18n/format.ts`); English shows en-GB ("16 Nov 2026").
- Study text keeps `lang` (study language); interface text carries none.
- Display forms: any word shown from a card, deck row, lookup or search hit is the text the data already carries
  (snapshot / `written` / `shownWritten`), never `forms[0]`.

## For #100 (home)

1. Milestones card (`lib/milestones/MilestoneCard.svelte`, also used in Stats → Week): one 1px `--hair` outline, no fill or shadow; ★ → line icon `milestone` (Lucide `award`, add to `vendor-icons.mjs` `WANTED`); Dismiss a secondary `Button`, "See all" a plain link to `/stats/week#milestones`; status region stays outside the card, focus moves to the h1 on dismiss, heading h2 on Home / h3 in Week — existing milestone tests unchanged.
2. Keep the order h1 + date line → `EmailBanner` → search → milestones → widgets; `EmailBanner` becomes a notice line (text + confirm link, `--hair` rule below, no rounded box).
3. Daily-goal widget (`lib/goals/GoalRing.svelte`): no weight above 600 (its 700 → big number at 400–500); vacation and no-goal texts unchanged.
4. Switched-off features: their widgets stay absent on Home and in the Settings → Home list (test with flashcards off); the empty-home text (`none-chosen` / `none-available`) is plain muted text with its link; the date line goes through the locale helpers (English → en-GB).
5. The weekly-summary widget's insides are #105's (R7); #100 only removes its `WidgetCard` box. `pageTitle()` on `/` and the route-title tests unchanged.

## For #101 (flashcards)

1. Every face draws the word from `withShownWritten(entry, card.snapshot)` (`lib/study/cardView.ts`), as the session does today — test: a Japanese kana-row card shows の (not 乃) in the Recognise and Recall prompt and answer.
2. Write: stroke data comes from the installed strokes pack (`/hanzi/U<HEX>.json`); a character without data keeps today's fail path with its words, and "Show strokes" is not offered while no data is loaded.
3. Offline session (`offlineSession`, cached typed pull): the companion note stays, and the docked action bar never covers the frame's offline/update banners or the progress line (checked at 360px offline).
4. Unchanged: the session's document title, its live regions, errors through `errorText()` (shown by code), interval numbers through the locale helpers; links go to `/flashcards`, never `/p/flashcards`; "Recall" stays the kind name until Owner check 1 is answered.
