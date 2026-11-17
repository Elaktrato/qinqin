# Themes: theme files, contrast, derived tokens, the `appearance` row

Colour themes are data (#96). A theme is a set of colour tokens in a JSON file; themes arrive in packs of type
`theme` (format `themes-json`), built-in ones ship inside the server binary, and every client paints with the
same tokens derived by the same rule. Design: `docs/superpowers/specs/2026-11-16-visual-rework-design.md` §6, §7,
§12; plan: `docs/superpowers/plans/2026-11-17-vr-themes.md`.

## Theme file

A theme pack holds `manifest.json` (the usual pack fields; `type: "theme"`, `format: "themes-json"`, **no**
`language` or `languages`), `themes.json`, and its licence files. `themes.json` is a JSON **array** of 1–64
themes, at most 262,144 bytes:

```json
[{ "id": "catppuccin-mocha", "name": "Mocha", "family": "Catppuccin", "scheme": "dark",
   "colors": { "chrome": "#11111b", "panel": "#1e1e2e", "raised": "#313244", "line": "#45475a",
               "text": "#cdd6f4", "muted": "#a6adc8", "good": "#a6e3a1", "warn": "#f9e2af", "bad": "#f38ba8",
               "gradeAgain": "#f38ba8", "gradeHard": "#fab387", "gradeGood": "#a6e3a1", "gradeEasy": "#89b4fa" },
   "accents": { "mauve": "#cba6f7", "blue": "#89b4fa" }, "defaultAccent": "mauve" }]
```

| Member | Rule |
| --- | --- |
| `id` | `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 bytes; unique in the file, and on a server unique among the built-in themes and every installed pack |
| `name` | 1–64 code points, no control character, no leading or trailing white space |
| `family` | optional; the same rule as `name` (the picker groups by it, else by the pack name) |
| `scheme` | `light` or `dark` |
| `colors` | exactly the 13 keys below, each `#rrggbb` in **lower case** |
| `accents` | 1–16 members; key `^[a-z][a-z0-9-]{0,31}$`, value a colour; **the file's order is kept** (the picker shows them in that order) |
| `defaultAccent` | a key of `accents` |

Colour tokens (design §6): `chrome` (the window frame: top bar, drawer, rail), `panel` (the content surface,
menus, sheets), `raised` (hover, selected row, inset surfaces), `line` (lines and outlines), `text`, `muted`
(secondary text), `good`, `warn`, `bad` (semantic states), `gradeAgain`, `gradeHard`, `gradeGood`, `gradeEasy`
(the four grade buttons).

## Validation

Theme files are strict: a member the contract does not name, a member written twice in one object (anywhere),
an upper-case or short hex, a colour with alpha are refused. The **first** problem is reported as a stable
`code` and a JSON `path` (`$[1].colors.panel`), checked in this order:

1. the file: size (`too-large`), JSON (`bad-json`), an array (`not-an-array`), 1–64 themes (`no-themes`,
   `too-many-themes`);
2. theme by theme, in file order: an object (`not-an-object`), a repeated member (`duplicate-member`), an unknown
   member, first in file order (`unknown-member`), a missing member in the order `id`, `name`, `scheme`,
   `colors`, `accents`, `defaultAccent` (`missing-member`), `id` (`bad-id`, then `duplicate-id`), `name`
   (`bad-name`), `family` (`bad-family`), `scheme` (`bad-scheme`), `colors` (object, repeated, unknown, then the
   13 keys in token order: `missing-member` or `bad-colour`), `accents` (object, repeated, `no-accents`,
   `too-many-accents`, then each member in file order: `bad-accent-key`, `bad-colour`), `defaultAccent`
   (`bad-default-accent`).

A pack whose `themes.json` fails is refused at upload (`400 invalid pack: themes.json: <code> at <path>`) and by
`qinqin seed`; nothing is stored. Fixture: `theme-file.json`.

## Contrast

Contrast is **measured and reported**, never a reason to refuse a theme (design §7).

- Relative luminance (WCAG 2.2): each sRGB channel `c = v/255` becomes `c/12.92` when `c <= 0.04045`, else
  `((c + 0.055)/1.055)^2.4`; `L = 0.2126 R + 0.7152 G + 0.0722 B`.
- Ratio: `(L1 + 0.05)/(L2 + 0.05)` with `L1` the lighter, **rounded to two decimals half up**
  (`floor(r*100 + 0.5)/100`). Every comparison uses the rounded ratio, so implementations in IEEE doubles agree.
- The review checks of one theme, in this order: `text` on `panel`, `text` on `chrome`, `muted` on `panel`,
  `muted` on `chrome`, `muted` on `raised`, `bad` on `panel` (each at least **4.5**); `gradeAgain`, `gradeHard`,
  `gradeGood`, `gradeEasy` on `panel` (at least **3**); `onAccent` on `accent:<defaultAccent>` — the derived
  on-accent colour (Derived tokens) on the default accent, button text — (at least **4.5**); every accent
  `accent:<key>` on `panel` (at least **3**), in file order. Each check is `{fg, bg, min, ratio, pass}`;
  `failing` counts the checks that do not pass. Every built-in theme passes `text` on `panel` and `onAccent`
  (`server/internal/themes/builtin_test.go`).

Fixture: `contrast.json` (single ratios, including both sides of the rounding at 4.5 and 3, and the review of
Catppuccin Mocha and Latte, and of Solarized Light with the blue accent, whose on-accent check fails).

**The licence review** (`POST /api/admin/packs`, the staged upload): for a theme pack the answer carries
`themes: [{id, name, family, scheme, checks: [{fg, bg, min, ratio, pass}], failing}]` in file order (other pack
types have no `themes` member). `family` is `""` when the theme has none. The admin installs a pack with failing
checks like any other; the web shows the table with the result in words, not by colour alone. Pinned by
`server/internal/api/pack_stage_theme_test.go` against `contrast.json`.

## Derived tokens

Never in a theme file; computed by every client from the theme and the person's accent (design §6). Ratios are
the rounded ones of the Contrast section. `alpha(c, p)` appends to `#rrggbb` the two lower-case hex digits of
`floor((p*255 + 50)/100)` (14 → `24`, 24 → `3d`, 32 → `52`, 55 → `8c`, 58 → `94`, 100 → `ff`); the result is drawn
over whatever surface it sits on (CSS `#rrggbbaa`, Compose ARGB).

| Token | Rule |
| --- | --- |
| `accentChoices` | the accent keys whose ratio on `panel` is at least 3, in file order; empty → `[defaultAccent]` |
| `accentKey` | the requested key when it is in `accentChoices`, else `defaultAccent` (also for no key, an unknown key, an accent below 3:1) |
| `accent` | the colour of `accentKey` |
| `onAccent` | `chrome` when `ratio(chrome, accent) >= ratio(#ffffff, accent)`, else `#ffffff` (text on a filled accent) |
| `hair` | `alpha(line, 55)` — separators and outlines, 1px |
| `accentTints` | `{"14", "32", "58", "100"}` → `alpha(accent, p)` |
| `primaryWash`, `selectedWash` | `alpha(accent, 14)` — the one primary action's background; the selected reader word |
| `mastery` | `[hair, tint 14, tint 32, tint 58, tint 100]` — stage 0 is an **outline** in `hair` (no fill), stages 1–4 fills |
| `readingAccent` | `accent` when `ratio(accent, panel) >= 4.5`, else `text` — small accent-coloured text (readings) |
| `readableBad` | `bad` when `ratio(bad, panel) >= 4.5`, else `text` — error text; a non-colour cue (a bar in `bad`, a graphic at 3:1) marks it as an error either way |
| `readableMuted` | `muted` when `ratio(muted, panel) >= 4.5`, else `text` — secondary text (hints, group labels); `muted` itself stays for non-text uses |
| `highlightWash` | `alpha(warn, 24)` — reader highlights |
| `highlights` | `{yellow, green, blue, pink}` — the four reader highlight colours, named by what they show: `yellow` is `warn`; the others are `hue(warn, 135)`, `hue(warn, 225)`, `hue(warn, 330)`. `hue(c, H)` keeps the largest and the smallest channel of `c` (`max`, `min`, 0–255, so HSL saturation and lightness stay) and puts the spread `d = max − min` on hue `H`: with `h = H/60`, `x = min + floor(d·(1 − |h mod 2 − 1|) + 0.5)`, the channels (R, G, B) are, by sector `floor(h)`, 0: (max, x, min), 1: (x, max, min), 2: (min, max, x), 3: (min, x, max), 4: (x, min, max), 5: (max, min, x). The steps used are quarters and halves of `d`, exact in doubles. Named by hue, not by role (never `accent` or `good`), so they keep their name in every theme and with every accent; marks are `alpha(colour, 24)` washes (yellow = `highlightWash`) under `text`, swatches the full colour |
| `wordMarks` | `new`: `{color: accent, style: "solid"}`, `learning`: `{color: warn, style: "dotted"}`; known words have none |
| `correctionMarks` | `mistake`: `{color: gradeAgain, style: "wavy"}`, `suggestion`: `{color: gradeEasy, style: "dotted"}` |

Every mark keeps its line style in forced-colours mode (the colour becomes the system colour; the shape carries
the meaning). CSS custom properties the web sets on `:root` (Android names its Compose tokens the same way in
camelCase):

| Property | Value |
| --- | --- |
| `--chrome`, `--panel`, `--raised`, `--line`, `--text`, `--muted`, `--good`, `--warn`, `--bad` | the theme's colours |
| `--grade-again`, `--grade-hard`, `--grade-good`, `--grade-easy` | the grade colours |
| `--accent`, `--on-accent`, `--hair`, `--reading-accent`, `--readable-bad`, `--readable-muted` | derived |
| `--accent-14`, `--accent-32`, `--accent-58`, `--accent-100` | the accent tints |
| `--primary-wash`, `--selected-wash`, `--highlight-wash` | the washes |
| `--highlight-yellow`, `--highlight-green`, `--highlight-blue`, `--highlight-pink` | the highlight colours |
| `--mastery-0` … `--mastery-4` | the mastery ramp |

Fixture: `derive.json` (the alpha table; Mocha and Latte, an accent below 3:1, an unknown and a missing accent,
a theme whose every accent fails, both sides of the 4.5 and 3 roundings, `readableBad` and `readableMuted` on both sides of 4.5, the
highlight hues with a half step rounding up).

## Fixed scale tokens

Never themed and never stored; the web defines them in `apps/web/src/app.css` (`:root`), Android mirrors the
values. The person's adjustments scale two of them: `--radius` (corners: 4 / 10 / 16px) and `--space` (spacing:
0.75 / 1).

| Property | Value |
| --- | --- |
| `--radius-large` | `calc(var(--radius) + 4px)` — panels and sheets |
| `--font-size-xs`, `-s`, `-m`, `-l`, `-xl`, `-xxl` | 0.75, 0.875, 1, 1.25, 1.5, 2rem |
| `--space-1` … `--space-6` | 0.25, 0.5, 0.75, 1, 1.5, 2rem, each times `--space` |
| `--icon-s`, `--icon-m`, `--icon-l` | 16, 20, 24px |
| `--shadow-float` | `0 1px 3px rgb(0 0 0 / 0.12), 0 12px 32px -12px rgb(0 0 0 / 0.35)` — menus, popups and sheets only |
| `--font-size-label` | `0.78125rem` — 12.5px labels (sentence case, `--readable-muted`, never all caps) |
| `--weight-regular` | `400` — body text and big numbers |
| `--weight-medium` | `500` — emphasis inside text, big numbers that need a little weight |
| `--weight-strong` | `600` — headings, the selected tab, the primary action; type never goes above it |
| `--line-tight` | `1.15` — big numbers, headings |
| `--line-body` | `1.5` — running text (the reader sets its own ~2.2 for ruby) |
| `--tracking-tight` | `-0.01em` — big numbers |
| `--motion-fast` | `120ms` — fades (menus, tooltips); `0ms` under `prefers-reduced-motion: reduce` |
| `--motion-medium` | `200ms` — slides (sheets, drawers); `0ms` under `prefers-reduced-motion: reduce` |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` — every transition |
| `--focus-ring` | `2px solid var(--accent)` — every `:focus-visible` outline (forced colours: `Highlight`) |
| `--focus-ring-offset` | `2px` |
| `--hit` | `2.75rem` — the smallest touch target (44px) on coarse pointers |
| `--layer-float` | `50` — menus, popups, tooltips |
| `--layer-modal` | `100` — dialogs and sheets |

The web paints `color-scheme` and `data-scheme` on `<html>` from the theme's `scheme`, and the browser bar
colour (`<meta name="theme-color">`) from `chrome`. Before anything loads it paints this device's last tokens
(`localStorage` `qinqin.theme.last.v1`: both slots, so `system` still follows the device), else Catppuccin Latte or
Mocha compiled in (`apps/web/src/lib/theme/fallback.ts`, pinned to the built-in pack).

Ruling: the last tokens are kept per device, not per user — the frame paints before the user is known — cost: a
second account on the same browser sees the first account's theme for a moment at start.

## Design rules and base components

The rules every screen follows (design §5), in tokens. Android applies the same rules to its Compose
components.

- **A box needs a reason.** Group with space (`--space-*`) and small labels. A fill, border, radius or shadow marks
  one element as a separate object: the content surface (`panel`, `--radius-large`), a floating layer (menu,
  popup, sheet, dialog: `panel` + `--hair` outline + `--shadow-float`), the selected row (`--selected-wash`). Never
  a box per block.
- **Hairlines, not blocks.** Separators and outlines are 1px `--hair`.
- **Colour only where it means something:** the accent (current place, the primary action, readings), grades,
  semantic states, data. Neutral (`--text`, `--readable-muted`, `--hair`, `--raised`) everywhere else.
- **One primary action per view** in the soft accent tint (`--primary-wash` behind `--text`: the tint carries the
  accent; accent-coloured text on it falls below 4.5:1 in some themes). Hover changes no text colour or fill (an
  underline; secondary's outline turns `--line`).
  Secondary actions are a `--hair` outline or plain text. A filled accent (`--accent` behind `--on-accent`) is
  rare.
- **Type tops out at 600** (`--weight-strong`). Big numbers are `--weight-regular`, large, `--line-tight`,
  `--tracking-tight`. Labels are sentence case, `--font-size-label`, `--readable-muted` — no all-caps labels.
  Secondary text is `--readable-muted`, never faded with `opacity`.
- **Icons:** line icons, 1.5 stroke on a 24 grid, `currentColor` (`--icon-s/m/l`). Icon-only buttons always have
  an accessible name and a tooltip on hover and keyboard focus.
- **Fields are an underline** (`--line`, 2px `--accent` when focused), not a box.
- **Active state:** navigation shows a small accent dot (top bar) or a short accent bar (rail); tabs a 2px accent
  underline.
- **Focus:** every focusable element shows `outline: var(--focus-ring)` with `--focus-ring-offset` on
  `:focus-visible`; in forced colours the ring is `Highlight` and fills that carry state become borders.
- **Motion** uses `--motion-fast` / `--motion-medium` with `--ease-standard` only, so `prefers-reduced-motion`
  stops it everywhere.
- **Never colour alone:** every coloured meaning also has text, shape or line style.
- **Tokens only:** components hold no colour literal and no `prefers-color-scheme`; the painted theme (also when
  the person forces Light or Dark) is the only source of colour.

**Base components** (web: `apps/web/src/lib/ui/`, re-exported by `index.ts`; each file's header documents its API;
Android builds the same set in Compose). Every visible word is a prop the caller fills from the catalogue.

| Component | API | Rule it carries |
| --- | --- | --- |
| `Icon` | `name`, `size` (`s`/`m`/`l` or px), `label?` | Lucide shapes (`icons/lucide.ts`), stroke 1.5, `currentColor`; decorative unless labelled |
| `IconButton` | `label` (required), `icon`, `size?`, `pressed?`, `href?`, `disabled?`, `tooltip?`, `placement?` | named + tooltip on hover/focus; no box at rest; 44px target on touch |
| `Tooltip` | `text`, `placement?`, `describe?`, `open?`, `suppress?`, children(`tipId`) | hover and keyboard focus, hoverable, Escape hides (WCAG 1.4.13) |
| `Button` | `variant` (`secondary`/`primary`/`plain`/`filled`), `tone?` (`danger`), `type?`, `form?`, `href?`, `busy?`, `icon?` | one primary in the soft tint; secondary a hairline; filled rare; disabled not faded |
| `Field` | `label`, `bind:value`, `type?`, `hint?`, `error?`, `hideLabel?`, `multiline?` | an underline; 2px accent on focus; hint and error linked; error has a `bad` bar |
| `Tabs` | `label`, `tabs` (`{id, label, href?}`), `bind:selected`, `onselect?`, `panel?` | text tabs, 2px accent underline; APG tabs, or links with `aria-current` for routes |
| `Menu` / `MenuItem` | `label`, `icon?` / `text?`, `menuLabel?`, `align?`, `bind:open` / `onselect?`, `href?`, `checked?`, `icon?`, `separator?` | floating layer; roving focus, typeahead, Escape returns focus; a check mark for the chosen item |
| `Dialog` | `bind:open`, `title`, `description?`, `describedBy?`, `onclose?`, `initialFocus?`, `dismissible?`, `actions` | native modal `<dialog>`; focus in, trapped, returned; Escape closes once |
| `Sheet` | `bind:open`, `label`, `onclose?`, `onnext?`, `onprev?`, `initialFocus?` | the bottom sheet of the reader lookup and the journal corrections; drag down to close, swipe or arrows to page |
| `Chip` | `tone?` (`neutral`/`accent`/`good`) | small text on `raised`, no border; `good` adds a dot |
| `Stat` | `value`, `label`, `change?` (`{text, direction}`) | big light number, small muted label; the change in words plus an arrow |
| `Section` | `title?`, `level?`, `actions?` | unboxed group; a hairline between Sections |
| `Panel` | `raised?` | the one box: the content surface, an inset that must read as one object |

## The `appearance` row

The person's choice: a plugin data row of `qinqin-core`, key `appearance`, **user-global** (`workspaceId: null`;
written with `PUT /api/plugins/qinqin-core/data/appearance` without `workspace`, or pushed). One per user, shared
by every device and by Android, last write wins (`sync/`); it backs up and restores unchanged (`backup/`). The
server stores it like any plugin row and never validates it.

```json
{ "version": 1, "mode": "system",
  "light": { "theme": "catppuccin-latte", "accent": "mauve" },
  "dark":  { "theme": "catppuccin-mocha", "accent": "mauve" },
  "corners": "soft", "spacing": "comfortable", "hanziFont": "sans" }
```

- **Defaults** (no row, a deleted row, or anything that is not a row): the object above.
- **Parse**: a value that is not an object, or whose `version` is not an integer ≥ 1, is the defaults; a newer
  `version` is read leniently. Then member by member: `mode` `system` | `light` | `dark`, else `system`; a slot
  (`light`, `dark`) that is not an object is the slot's default; in a slot, `theme` must be a theme id (the id
  grammar of the theme file) else the slot's default theme, and `accent` an accent key else `null` (= the theme's
  `defaultAccent`); `corners` `sharp` | `soft` | `round` else `soft`; `spacing` `compact` | `comfortable` else
  `comfortable`; `hanziFont` `sans` | `serif` | `kai` else `sans`.
- **Resolve**: the slot is `mode`, or for `system` the device's dark preference (`prefers-color-scheme`, Android's
  night mode); the theme is the slot's theme when it is installed (`GET /api/themes`), else the slot's default
  theme (a removed pack: the row is not rewritten, so the choice comes back when the pack does); the accent is
  chosen by the derive rule (`accentKey`) on that theme. A slot may hold a theme of either scheme.
- **Write**: start from the stored object (the defaults when there is none or it is not an object), set the
  changed members — a slot change is merged into the stored slot — keep every unknown member (top level and in a
  slot), and write `version: 1`.
- **Adjustments** (never in a theme file): corner radius `sharp` 4px, `soft` 10px, `round` 16px; spacing scale
  `compact` 0.75, `comfortable` 1; hanzi/kanji font `sans`, `serif`, `kai` for all study text (how a client picks the
  face: docs/contracts/fonts/README.md, "Choosing a face"; the reader's own `reader.font` overrides it when not
  `default`).

Fixture: `appearance.json` (`defaults`, `adjustments`, the example `row`, `parse`, `resolve` — with stand-in
`themes` listing each theme's `accentChoices` — and `write` cases).

Ruling: the appearance is per account, not per device — the design's call (§10), and it is what lets Android
match the web — cost: a person who wants a different theme on one device switches `mode` there by hand.

Ruling: the slot default theme, not the other slot's theme, replaces a removed theme — the default pair is always
present and of the expected scheme — cost: none.

## `GET /api/themes`

Public (no session needed; a read token is allowed), the same answer for everyone, small:

```json
{ "themes": [ { "id": "catppuccin-latte", "name": "Latte", "family": "Catppuccin", "scheme": "light",
                "colors": { "chrome": "#dce0e8", "...": "..." }, "accents": { "mauve": "#8839ef", "...": "..." },
                "defaultAccent": "mauve", "packId": "catppuccin", "builtin": true } ],
  "packs":  [ { "packId": "catppuccin", "name": "Catppuccin", "version": "1.0", "license": "MIT",
                "attribution": "© 2021 Catppuccin (catppuccin/palette)", "notice": "...",
                "licenseText": "MIT License\n\nCopyright (c) 2021 Catppuccin\n...", "builtin": true,
                "themes": ["catppuccin-latte", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha"] } ] }
```

- Built-in packs first in their fixed order (`themes-api.json`), then the installed packs by name, then pack id;
  themes in pack order, each pack's in file order; `accents` keep the file's order; `family` is `""` when the
  theme has none.
- `licenseText` is a built-in pack's full licence text (its embedded `LICENSE`, verbatim); `""` for an installed
  pack, whose licence files the administrator reviewed at upload and which are not kept. The Sources page shows
  each text behind a disclosure under the Themes table.
- An installed theme whose id a newer binary made built-in is left out (the built-in one wins); a stored theme
  that no longer parses is skipped (logged), never a 500.
- `ETag` (strong) and `Cache-Control: no-cache`: clients revalidate with `If-None-Match` and get `304`. The web's
  service worker keeps it per credential like its other reads (`pwa/`); the web also keeps the last applied
  tokens on the device for the first paint and compiles Catppuccin Latte and Mocha in as the fallback.

Ruling: public, not signed-in only — the sign-in page paints with a theme, the Sources page credits the packs
without a session (like every other pack list), and the answer holds nothing personal — cost: anyone can see
which theme packs an administrator installed.

## Built-in themes

Embedded in the server binary (`server/internal/themes/builtin/<pack>/`), always present, never stored, never
uninstalled; an uploaded pack may not use a built-in pack id or theme id (`400 invalid pack`). Order (pinned by
`themes-api.json` `builtinPacks`): `catppuccin` (`catppuccin-latte`, `catppuccin-frappe`, `catppuccin-macchiato`,
`catppuccin-mocha`), `rose-pine` (`rose-pine`, `rose-pine-moon`, `rose-pine-dawn`), `nord`, `gruvbox`, `dracula`,
`solarized` (`solarized-light`, `solarized-dark`), `tokyo-night`, `everforest` (`everforest-dark`), `kanagawa`
(`kanagawa-wave`). Licences, sources and the two corrections of mockup values: `docs/sources.md`, "Themes". Every
built-in theme reaches 4.5:1 for `text` on `panel` and for `onAccent` on its default accent (Solarized's default
accent is `magenta`: white on `blue` is 3.68:1); their other measured pairs below the minimums (reported, by
design; error and secondary text use `readableBad` / `readableMuted`): Catppuccin Latte (muted, two grades, six
accents), Rosé Pine Moon (muted on panel 4.46, on raised 3.61), Rosé Pine Dawn (muted, `bad` 4.04, `gradeHard`, two
accents), Dracula (muted 3.03 / 3.36, on raised 1.94), Nord (`bad` 3.05, muted on raised 4.46), Gruvbox (`bad` 4.29,
muted on raised 4.17), Solarized Light (text on chrome 4.39, muted, `bad` 4.29, a grade, three accents), Solarized
Dark (muted on chrome and raised 4.11, `bad` 3.25), Catppuccin Frappé, Everforest and Kanagawa (muted on raised
4.26, 4.44, 4.34).

The default pair is `catppuccin-latte` (light) and `catppuccin-mocha` (dark) until a qinqin house theme exists
(design §10, #108).

## Android

Android reads the same theme files through `GET /api/themes`, the same `appearance` row and the same derivation;
it implements the validation only if it ever installs theme packs itself (it does not today).

## Rulings

- Ruling: colours are lower-case `#rrggbb` only — one spelling per colour keeps comparisons, hashes and the
  contrast arithmetic identical everywhere — cost: a pack author lower-cases their hex.
- Ruling: theme files are strict (unknown or repeated members refused) — a typo such as `gradeagain` would
  otherwise silently paint the wrong colour — cost: a new optional token needs a new pack format value.
- Ruling: an accent the person chose that is not offered (below 3:1, or unknown after a theme change or from another device) falls back to the theme's `defaultAccent`, even when that one is below 3:1 too — a theme always has a working accent and the row keeps the choice — cost: a theme whose every accent fails paints with a weak accent (its review shows it).
- Ruling: `onAccent` follows the design (whichever of `chrome` or white contrasts more), not the mockup's luminance threshold — the design is the source of truth and the rule needs no tuning per theme — cost: none known.
- Ruling: contrast ratios are compared after rounding to two decimals — Go and JavaScript `pow` may differ in the
  last bit; rounding makes the 4.5 / 3 decisions identical — cost: a ratio of 4.495 counts as 4.5.

## Fixtures

| File | Rule | Decoded by |
| --- | --- | --- |
| `theme-file.json` | validation codes and paths, limits, accent order | Go `server/internal/themes/file_test.go` |
| `contrast.json` | ratios, rounding, the review checks | Go `server/internal/themes/contrast_test.go`; web `apps/web/src/lib/theme/contrast.test.ts` |
| `themes-api.json` | the built-in packs and theme ids in order | Go `server/internal/themes/builtin_test.go`, `server/internal/api/handlers_themes_test.go` |
| `appearance.json` | the `appearance` row: defaults, parse, resolve, write, the example row | Go `server/cmd/qinqin/core_appearance_test.go`, `server/internal/backup/appearance_test.go` (the example row through every pull form, push, export and restore); web `apps/web/src/lib/theme/appearance.test.ts` |
| `derive.json` | derived tokens | Go `server/internal/themes/derive_test.go`; web `apps/web/src/lib/theme/derive.test.ts` (also the CSS property table) |
