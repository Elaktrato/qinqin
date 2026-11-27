# Visual rework — design

Status: approved by the owner on 2026-11-16. Mockups (open in a browser, every mock repaints with the theme switcher):
[`assets/2026-11-16-visual-rework-mockups.html`](assets/2026-11-16-visual-rework-mockups.html). The mockups load
Google Fonts for convenience; the app must not (see Fonts).

## 1. Intent

qinqin works, but it looks like a plain website. The owner wants it to feel like an **app in the browser** — the
way Discord feels in a browser compared with a typical website — with its own identity, real **themes** people
can choose and adjust (Catppuccin and many more, not just light/dark), and a **light, calm** look. It must also
give the Android client (v0.4.0) a visual language to copy, so both apps look like one product.

Reference the owner likes: the Japanese app *Kanji Study* (slick, a side menu tucked away on the phone, a heatmap
that is not a generic grid but shows a growing flower per day for progress toward the daily goal). We take the
ideas, not its art.

## 2. Goals, non-goals, anti-goals

Goals
- One design layer (tokens + base components) that every page uses; no page picks its own colours or sizes.
- Themes as data: a theme is a set of colour tokens in a JSON file; themes arrive as a new **pack type**
  (`theme`), built-in ones ship with the app, admins can install more without an app update.
- Per-person adjustments on top of any theme: accent, corners, spacing, hanzi/kanji font.
- The frame, home, flashcards, reader, journal, search, dictionary entry and stats restyled as mocked.
- The same tokens and theme files usable by the Android app (`docs/contracts/`).

Non-goals
- No change to what features do; this is look, layout and navigation only (plus the small data additions in §9).
- No new CSS framework or UI kit.
- The flower, level and day-marker drawings: the owner draws them (issue, §11). Until then they are left out.
- The qinqin house theme and the extra house themes are designed in §7a (issue #108).

Anti-goals (would make this a failure even if it works)
- A heavy, blocky look: filled boxes everywhere, pills with borders, bold everything. The owner explicitly asked
  for less visual weight (round 4 of the mockups).
- A generic "web app template" look (stock Material icons, navbar with text links in pills).
- A theme that makes text unreadable, or colour carrying meaning without a text or shape cue.
- Any font, palette or icon whose licence is unclear (owner's licence-first rule).
- Fonts or other assets loaded from third-party hosts at runtime (self-hosted app; privacy).

## 3. Constraints

- SvelteKit SPA embedded in the Go binary; components use scoped `<style>` (127 of 144 `.svelte` files today).
  Global CSS is `apps/web/src/app.css` (163 lines). No CSS framework.
- Accessibility work already done must survive: skip link, focus handling, live regions, `prefers-reduced-motion`,
  forced colours (the reader's word states have a forced-colours path), screen-reader text.
- Per-user, cross-device settings are user-global plugin-data rows of `qinqin-core` (as `home-layout` is,
  `apps/web/src/lib/widgets/layout.ts`); they sync and back up.
- Packs: `server/internal/packs` (`typeOrder`, `Supported`, `Installable`), staged upload with licence review in
  Settings → Data. Contract fixtures live in `docs/contracts/` and are decoded by Go and web tests.
- Ordering: this work starts **after** the v0.4.0-prep run (`docs/superpowers/directions/…v0.4.0-prep.md`) is merged.
  That run moves flashcards and the reader into the core, adds the translatable interface (#73) and the
  package/sync rework; the restyle builds on its result and puts new strings into its message catalogues.
  **The implementation plan is written only after that run is merged**, against the code as it is then (file paths,
  pack types, catalogue layout). The weekly milestones shown in Stats → Week are built by that run (its item 7);
  this work only styles them.

## 4. Approaches considered

1. **Own tokens and components, themes as data — chosen.** CSS custom properties for every token, a small set of
   Svelte base components, theme files validated against a contract. Fits the current code (scoped styles, no
   framework), adds no dependency, and the theme files are directly usable by Android.
2. **UI kit + Tailwind (e.g. shadcn-svelte).** Faster for menus/dialogs, but rewrites every component's styles into
   utility classes, adds a framework, and its default look is the generic style the owner wants to leave.
3. **Option 1 plus a headless behaviour library (e.g. bits-ui).** Only worth it if the app's own accessible menus
   and dialogs prove shaky during the restyle; not adopted up front.

The owner picked option 1 **and** asked that themes become a pack type.

## 5. Design rules (the "lighter" look)

These come from mockup round 4 and apply to every page, including ones not mocked.

- **A box needs a reason.** Group with space and small labels. Fill, border, radius and shadow mark one element as a
  separate object (the content panel, a menu, the selected row) — not every block.
- **Hairlines, not blocks.** Separators and outlines use `--hair` (the line colour at about half strength), 1px.
- **Colour only where it means something:** the accent (current place, primary action, readings), grades,
  semantic states, data (heatmap, mastery, charts). Neutral everywhere else.
- **One primary action per view** in a soft accent tint (accent at ~14% behind accent-coloured text). Secondary
  actions are hairline-outlined or plain text.
- **Type tops out at 600.** Big numbers are regular weight (400–500), large and slightly tight. Labels are sentence
  case, muted, ~12.5px — no all-caps labels.
- **Icons:** line icons, 1.5 stroke on a 24 grid, `currentColor`. Icon-only buttons always have an accessible name
  and a tooltip on hover/focus.
- **Fields are an underline** (search, "type the word"), not a box.
- **Active state** in navigation is a small accent dot (top bar) or a short accent bar (rail); tabs use a 1.5–2px
  accent underline.
- **Motion:** small and purposeful (today's flower sways, menus fade). Everything respects `prefers-reduced-motion`.
- Never colour alone: every coloured meaning also has text, shape or line style (wavy vs dotted, written grade
  names, legends).

## 6. Tokens

All tokens are CSS custom properties on `:root`, set from the active theme and the person's adjustments.
Components use only tokens — no literal colours.

**From the theme (colour tokens)**

| Token | Use |
|---|---|
| `chrome` | window frame: top bar, phone drawer, rail |
| `panel` | the content surface (raised panel on desktop, page on phone), menus, sheets |
| `raised` | hover, selected row, inset surfaces |
| `line` | lines and outlines; `hair` is derived from it |
| `text`, `muted` | body text, secondary text |
| `accents` (named map) + `defaultAccent` | the person picks one; becomes `accent` |
| `good`, `warn`, `bad` | semantic states (also leaves/stems, highlights, errors) |
| `gradeAgain`, `gradeHard`, `gradeGood`, `gradeEasy` | the four grade buttons |

**Derived (never in a theme file)**: `hair` (line ~55%), `on-accent` (whichever of `chrome` or white has the higher
contrast with the accent), accent tints (primary-action wash, heatmap tint, mastery ramp: accent at ~14/32/58/100%),
reader word marks (new = accent underline, learning = dotted `warn`), highlight wash (`warn` ~24%), correction marks
(mistake = wavy `gradeAgain`, suggestion = dotted `gradeEasy`).

**From the person's adjustments (not in theme files)**: corner radius (Sharp 4px / Soft 10px / Round 16px; default
Soft), spacing scale (Compact 0.75 / Comfortable 1; default Comfortable), hanzi/kanji font (Sans / Serif / Kai).

**Fixed scale tokens** (builder sets exact values, documented in the contract): type scale, spacing steps, icon
sizes, shadow for floating layers (menus, popups, sheets only).

## 7. Themes and theme packs

**Pack type `theme`.** A new type in `server/internal/packs` (installable through the existing staged upload with
licence review). One pack can hold several themes (e.g. the four Catppuccin flavours). Manifest: the usual pack
fields (id, name, version, type, license, attribution, notice). Content: a `themes.json` with an array of themes:

```json
{ "id": "catppuccin-mocha", "name": "Mocha", "family": "Catppuccin", "scheme": "dark",
  "colors": { "chrome": "#11111b", "panel": "#1e1e2e", "raised": "#313244", "line": "#45475a",
              "text": "#cdd6f4", "muted": "#a6adc8", "good": "#a6e3a1", "warn": "#f9e2af", "bad": "#f38ba8",
              "gradeAgain": "#f38ba8", "gradeHard": "#fab387", "gradeGood": "#a6e3a1", "gradeEasy": "#89b4fa" },
  "accents": { "mauve": "#cba6f7", "blue": "#89b4fa" }, "defaultAccent": "mauve" }
```

(The mockup's `THEMES` object has the full values for all eight themes shown.)

- **Validation** (contract with fixtures, Go and web): required keys, `#rrggbb` only, `scheme` light|dark, ids
  unique, `defaultAccent` in `accents`. Contrast is **measured and reported** in the licence-review step (text and
  muted on panel and chrome against 4.5:1; accents and grades on panel against 3:1). Failing themes may still be
  installed; an accent below 3:1 on `panel` is not offered in the accent picker. Accent-coloured text that is
  small (readings) uses the accent only when it reaches 4.5:1 on `panel`, otherwise `text`.
- **Built-in themes** ship inside the binary as bundled packs, always present, like the built-in plugin manifests:
  Catppuccin Latte, Frappé, Macchiato, Mocha; Rosé Pine, Rosé Pine Dawn; Nord; Gruvbox. Candidates to add if their
  licences check out: Rosé Pine Moon, Dracula, Solarized light/dark, Tokyo Night, Everforest, Kanagawa. Every palette
  is credited on the Sources page; the builder confirms each licence before bundling (Catppuccin is MIT; verify the
  rest).
- **Delivery:** `GET /api/themes` lists installed themes with their colours (small; clients cache it). Android uses
  the same files and route.
- **Before anything loads** (first paint, offline, a removed theme): the web app keeps the last applied tokens in
  local storage and has the house theme (qinqin Day/Night) compiled in as the fallback.

**The person's appearance** — a user-global row `qinqin-core` / `appearance` (syncs, backs up, contract fixture):

```json
{ "version": 1,
  "mode": "system",
  "light": { "theme": "qinqin-day", "accent": "azure" },
  "dark":  { "theme": "qinqin-night", "accent": "cyan" },
  "corners": "soft", "spacing": "comfortable", "hanziFont": "sans" }
```

`mode` is `system`, `light` or `dark`; `system` follows the device's light/dark setting using the two chosen themes. Unknown keys are kept on write (as
other rows do). Missing row = the defaults above. Settings → Appearance (personal settings) edits it with a live
preview; the account menu has a quick theme switch.

## 7a. The house theme (owner decision 2026-11-18, issue #108)

Built from the owner's palette `#ffffff #0ce6f2 #0098db #1e579c #203562 #252446 #201533` (white, cyan, azure,
blue, navy, indigo, violet-black). Ready-to-ship theme files in the contract shape:
[`assets/house-themes/qinqin/themes.json`](assets/house-themes/qinqin/themes.json).

| Theme | Scheme | Frame (`chrome`) | Page (`panel`) | Text | Default accent |
|---|---|---|---|---|---|
| qinqin Day | light, **default light** | `#e3f4fa` | `#ffffff` | `#201533` | `azure` `#0077b3` |
| qinqin Night | dark, **default dark** | `#201533` | `#252446` | `#ffffff` | `cyan` `#0ce6f2` |
| qinqin Deep | dark | `#201533` | `#203562` | `#ffffff` | `cyan` `#0ce6f2` |

- Night uses the navy `#203562` for `raised` and `#1e579c` for `line`.
- Day's accent is a darker azure because `#0098db` on white is 3.2:1, below the 4.5:1 for small accent text.
- The palette has no red, orange or green, so the grade and state colours (soft coral, amber, mint on dark; deeper
  versions on Day) were added to sit beside the blues.
- Every theme passes the contract's checks, including `onAccent` (measured 2026-11-18).
- The new defaults replace Catppuccin Latte/Mocha in `appearance` (defaults, fallback, fixtures).

**Extra built-in themes** (also owner's choice, from the same session): three further directions, each light and dark,
in [`assets/house-themes/qinqin-extras/themes.json`](assets/house-themes/qinqin-extras/themes.json):
- qinqin Neon (Neon Day, Neon Night): ink-grey surfaces, neon accents.
- qinqin Pigments (Celadon, Indigo): the painter's pigments 胭脂 rouge, 朱 vermilion, 藤黄 gamboge, 石绿 malachite,
  群青 ultramarine, 紫 violet. Accent keys are ASCII as the contract requires; the hanzi go in the pack notice.
- qinqin Pop (Bubblegum, Grape): tinted surfaces, clashing complementaries.

The pack manifests (licence, attribution, notice) are for the builder to write; the palettes are the owner's own work.

## 8. Fonts

Owner rule: only font faces that are free for us to use, shipped with qinqin — never loaded from a third-party host.

- **Interface font:** one open-licensed Latin family bundled in the web app (the mockups use **Figtree**, SIL OFL 1.1;
  the builder may pick another OFL family if it renders better, and must check the licence file). Two or three
  weights (400, 500, 600), WOFF2, self-hosted.
- **Hanzi/kanji fonts** are large (several MB per face), so they come as **downloadable font packs** (a `font` pack
  type, or font files inside a pack type the v0.4.0-prep packaging work provides — builder's choice, but they must
  not bloat the web bundle). Candidates, all SIL OFL 1.1: Noto Sans SC/TC/JP and Noto Serif SC/TC/JP (Sans/Serif),
  LXGW WenKai (Kai, Chinese), Klee One (Kai-like textbook style, Japanese). Served subset/sliced by Unicode range so a
  page downloads only the characters it needs.
- Until a font pack is installed, each choice maps to system font stacks — the reader already does this
  (`apps/web/src/lib/plugins/reader/fonts.ts`); reuse it.
- The app-wide **hanzi font** becomes the default for the reader; the reader's own per-workspace font setting
  (`reader.font`, `default` = "use the app-wide choice") still overrides it.

## 9. Frame and pages (as mocked)

Section numbers refer to the mockup page.

**Frame — desktop (frame A).** Window frame in `chrome`; the page is a raised `panel` with rounded corners, inset
8px from the frame (Discord-like layering). Top bar: the 勤 logo on the left **is the Home link** (no Home icon;
tooltip "Home"); section icons centred (Study, Reader, Journal, Search, Stats, plus plugin sections), icon-only with
tooltips, active = accent icon + dot; on the right the **workspace flag** alone (no pill, no border) and the
avatar. The flag opens the workspace menu (flag, name, language; check on the current one; "Manage workspaces").
The avatar opens the account menu: name, Settings, Theme (quick switch), **Admin settings** (admins only), Sign out.
**Settings leaves the footer.** Plugin sections get icons from their manifest (fallback: a generic icon).

**Frame — phone.** Top bar: menu button, page title, flag. The menu is a drawer from the left: workspaces as a row
of flags at the top (tap to switch, + to add) with the current one named under it; sections with icon + label
(including Home, since there is no logo to tap); the account at the bottom (avatar, name, Settings/Admin). Same
frame for the installable web app now and Android later. In bottom-bar mode (#188) the top bar is the **logo**
(the desktop brand's mark and accent colour, a link to Home named "qinqin, home", `aria-current="page"` on Home, a
44 px target, the bar's first focusable item), the page's actions, the flag and the avatar: no section name and
no page title, on every page (#293, owner 2026-11-26); a page's own title is its h1. Side-menu mode keeps the menu
button and the title.

**Home.** Widgets keep the existing layout system (Settings → Home). Cards lose their boxes (§5). The activity
heatmap gets **three layouts the person chooses per widget** in Settings → Home: **Garden grid** (13 weeks, today's
grid), **Month calendar** (dates, bigger tiles, paged by month), **This week** (seven large days with amounts;
tapping opens Stats). Stored in a separate user-global row `qinqin-core` / `widget-options`:
`{"version": 1, "activity-heatmap": {"layout": "garden"|"month"|"week"}}` (default `garden`; unknown keys kept on
write). Not inside `home-layout`, because today's `home-layout` writer rewrites the row and would drop added fields.
- **Flower stages** (for later, when the owner's drawings exist): per day, from the goals contract
  (`docs/contracts/goals/`): no goal → no flower, tile tinted by amount only; vacation → resting; otherwise by
  amount/target: 0 → soil, < 1/3 → sprout, ≥ 1/3 → bud, ≥ 2/3 → opening, met → bloom. Today has an accent ring and
  a gentle sway. **Until the drawings exist, tiles show the tint only** and the stage is exposed as text (tooltip,
  accessible name). The drawings will be SVGs with a few flat areas the app recolours from tokens (petals = accent,
  leaves/stem = good, centre = warn).
- **The flower is a lotus** (owner decision 2026-11-17; 莲/蓮 is shared by both languages and 出淤泥而不染 fits the
  learner's growth). Stages: still water (soil), lily pad (sprout), bud, opening, in bloom with the seed pod,
  closed for the night with a small moon (rest). Colour areas: petals = `accent` (the person's accent, so the
  lotus is not always pink; owner decision), pad and stem = `good`, seed pod = `warn`, water = `line`; back petals
  by opacity, no outlines. Reference sketch and drawing notes: the "Lotus stages" section of the mockups.

**Flashcards — "open page".** No card box. Every kind (Recognise, Recall, Fill the gap, Build the sentence, Write,
Tones) has the same four parts in the same places: kind label (with deck and level on the right), prompt, the answer
area (nothing / underline field / choices / word tiles / writing pad / tone pads, all hairline), and the answer below
a hairline (reading + play, meaning + source, the learner's note). The writing pad is not a fixed 200 px any more
(#285): square, as wide as the content on a phone where the height allows, never pushing the feedback line under the
docked actions, at least 10rem, at most 22.5rem on touch screens and 17.5rem with a mouse (the rule is in the
writing-feel design, "Writing pad"). Session top: close, a thin progress line, count.
Actions docked at the bottom: before the answer one soft-accent button (Show answer / Check / Show strokes); after,
four grade buttons as coloured text with a thin underline in their grade colour, **each showing its next interval**
(<1m, 6m, 1d, 4d — computed by the same scheduler); the suggested grade gets a faint wash. Kinds are not
colour-coded.

**Reader.** The text column gets the width (~40em, CJK at ~20px, line height ~2.2 for ruby). The side rail becomes a
column of icons at the right edge (Contents, Bookmarks, Highlights, Words, Display) opening a ~220px panel beside the
text. Word marks: new = thin accent underline with pinyin/furigana above, learning = dotted `warn` underline, known =
none; highlight = soft `warn` wash; selected word = accent wash. The lookup popup appears **below the word**, as a
stack of entries (term, reading, level and frequency chips, glosses, source, "Add to deck" / "I know this"). Phone:
rail moves into one top-bar button; the lookup is a **bottom sheet** that takes at most 55 % of the screen
(`55dvh`, #282; the other sheets stop at 85 %), so the text being read stays in view: a long entry scrolls inside
the sheet, and the looked-up word is kept above its top edge.

**Journal.** Three columns: entries (date, title, a small `good` dot when reviewed, "New entry", "Ideas for today"),
the page (date, title, text), and the **margin** (topic ideas while writing; corrections after a review, like
document comments). Mistakes: wavy `gradeAgain` underline; suggestions: dotted `gradeEasy`. The open correction is
tinted in the text and expanded in the margin (category, what was written struck through, the fix in `good`, why);
others collapse to one line. Overall review below the text with provider and model. Phone: a correction opens in the
**same bottom sheet component** as the reader's lookup; swipe sideways for the next.
- Data addition: annotations get `kind: "mistake" | "suggestion"`, asked of the AI in the review schema; an
  annotation without `kind` (older reviews, providers that omit it) shows as a mistake.

**Search.** Desktop: results list on the left (underline search field with Draw and By-parts buttons; filters as
text options; one row per result: word large, reading, gloss, kind · level), the selected entry beside it
(master–detail). The URL reflects query and selected entry so it can be shared. Phone: list, then the entry as its
own page.

**Dictionary entry.** Header: word large, variant (e.g. traditional) small, readings (pinyin + zhuyin / kana), play,
chips (level, frequency rank, kind, "In N decks" in `good`), actions Add to deck (primary) and Edit. Main column:
meanings grouped by dictionary with source and licence, examples (target word in accent), related words. Side
column: characters (glyph, reading, gloss, radical, strokes, level), stroke-order player (Play, Loop, progress), the
learner's note. Character entries keep their radical section and "characters under this radical". Phone: one column;
Add to deck moves into the top bar.

**Stats.** Text tabs Overview / Characters / Week at the top of the page (desktop and phone).
- Overview **stays a grid of plugin widgets** (the `stats` surface of the plugin contract is unchanged). The mock shows
  the default arrangement: a new core "summary numbers" widget, then the existing widgets restyled. Contents:
  four large light numbers (streak, words known, recall over 30 days, time studied this month), cards by
  state as one stacked bar in the accent ramp, level and XP line, reviews per day (last 30 days, today emphasised).
- Characters: the mastery map uses a **single-hue ramp** (outline → accent 14/32/58/100%) instead of a colour per
  stage, with a legend; grouped by level/grade/frequency (one choice).
- Week: browse weeks with arrows; four numbers with the change from last week (`good` up, `gradeHard` down);
  paired bars per day (this week accent, last week muted); milestones.
- Phone: numbers two by two, charts full width.

**Pages not mocked** (Settings and Admin settings, library, decks view and study setup, scheduling, sign-in and
two-step sign-in, sources, grammar, lookups, packs/data): apply §5–§6 and the base components; no new layouts are
invented without showing the owner.

## 10. Calls made during the design (owner to check)

- The lighter look is the base shape for every theme, not a separate option.
- Theme choice is per account (syncs to every device and Android), with a light and a dark slot following the system.
- The account menu has a quick theme switch next to Settings.
- The phone drawer shows text labels and keeps a Home row; the desktop bar is icon-only.
- Grade buttons show the next interval; kinds are not colour-coded; the kind label uses the accent.
- The mastery map uses one hue, light to full, instead of a colour per stage.
- "Recall, last 30 days" replaces "retention" in Stats.
- Corrections are split into mistakes and suggestions (needs the review schema change in §9).
- The reader's lookup and the journal's corrections share one bottom-sheet component on the phone.
- Heatmap layout is stored in its own row (`widget-options`), not in `home-layout`.
- Stats → Overview stays a widget grid; the four numbers are a new core summary widget.
- Built-in themes are always present (embedded), admins can add more via theme packs.
- Interface font Figtree (OFL) unless the builder finds a better OFL face; CJK fonts as downloadable packs.
- The default theme pair is qinqin Day / qinqin Night (owner decision 2026-11-18, §7a).

## 11. Left to the builder, and follow-ups

Builder decides: exact type scale, spacing steps, shadows; component APIs and file layout; how the theme tokens are
applied (one `<style>` block on `:root` vs inline properties); the `font` pack mechanics (within §8's rules); the
search URL shape; animation timings; how pages are migrated in order (suggested: tokens + theme packs + appearance
settings → base components → frame → Home → Flashcards → Reader → Journal → Search + Entry → Stats → the rest).

GitHub issues (created 2026-11-16): epic #95; theme packs and appearance #96; fonts #97; base components #98;
frame #99; home and heatmap #100; flashcards #101; reader #102; journal (incl. the `kind` field) #103; search and
entry #104; stats #105; remaining pages #106; owner drawings #107; house theme #108. Original list:
- Visual rework (epic) linking this document and the mockups, with one sub-issue per migration step above.
- `theme` pack type and appearance settings (contract `docs/contracts/themes/`, built-in palettes with licence check).
- Font packs for hanzi/kanji (OFL faces, subsetting) and the bundled interface font.
- **Owner:** draw the lotus stages (still water, lily pad, bud, opening, bloom, closed for the night), level badges and day markers as
  SVGs (flat areas, recoloured from tokens; 24-unit grid; guidance to be written with the owner).
- A qinqin house theme (light and dark), designed with the owner.
- Journal: `kind` (mistake/suggestion) in the review schema.

## 12. Android

The Android client reads the same theme packs (`GET /api/themes`), the same `appearance` row and the same derivation
rules (§6) from `docs/contracts/themes/`, so a theme looks the same in Compose. The frame on Android is the phone
frame in §9 (drawer, bottom sheets).
