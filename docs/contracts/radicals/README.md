# Radical and component lookup (#71)

Rules every client implements identically. Spec:
`docs/superpowers/specs/2026-11-16-v030s-radicals-design.md`. Fixtures:
`{"version":1,"rule":"radicals/<name>", ...}`. No row keys and no per-user data: the lookup reads the
character universe (`GET /api/characters`) and the installed components packs (`GET /api/components`).

## The Kangxi table (`kangxi.json`)

214 rows `{n, c, s, forms: {all, zh, ja}}`. `n` is the Kangxi radical number (1–214), `c` the unified
character a dictionary uses (水, not the Kangxi Radicals block look-alike U+2F54), and `s` the classical
radical stroke count, fixed by the numbering (1–6 → 1, 7–29 → 2, …, 214 → 17). `forms` are display labels
and search aliases only: `all` for every language (positional forms such as 氵 氺 for 85), `zh` the
simplified forms Unihan marks `N'.0` (讠 for 149), `ja` the Japanese forms Unihan marks `N''.0` plus
standard shapes (竜 for 212).

- **Number(char)**: the `n` whose `c` is `char`; otherwise the lowest `n` that lists `char` in any of its
  forms (`all`, `zh`, `ja`); otherwise 0. So 月 → 74 (its own row wins over the form of 130) and 阝 → 163
  (listed under 163 and 170). The side-specific shapes of the CJK Radicals Supplement are listed too: ⻏
  (U+2ECF, right) under 163 and ⻖ (U+2ED6, left) under 170, so each maps to its own radical; KanjiVG names
  the parts that way.
- **A typed character** (the page's text box): a form listed under several radicals (阝) offers each of
  those radicals and, when the language's components hold them, their Radicals Supplement shapes as parts
  (⻏, ⻖); the user picks one. Otherwise a radical form that is not a radical's own character (氵, 讠) picks
  the radical, a radical's own character (口) is a part when the components list it as a part, else the
  radical, and any other character is a part.
- A language's table shows `forms.all` plus `forms.<primary subtag>` (zh-TW uses `zh`).
- The Go package `server/internal/radicals` embeds a byte-identical copy of this file; the web module
  `apps/web/src/lib/radicals/kangxi.ts` imports it.

## `k` in `GET /api/characters`

Each character row gains `k`: the Kangxi number of the character's `radical` link, omitted when there is
none. The server resolves it as the first live form of the live target of the first live `radical` link
(by target id) and maps it with Number. A deleted link or a deleted radical entry gives no `k`. The body
format is 3 (the ETag carries `chars3-`). Example: `components-response.json` `charactersRow`.

## `GET /api/components?language=<code>` (`components-response.json`)

Public, no per-user data: every caller gets the same bytes. Body
`{language, packs: [{id, license, attribution}], parts: [{c, s, n}], chars: {glyph: [part, ...]}}`, the
union of the language's active components packs; `packs` names them by pack id with their stated licence and
attribution, so a client can credit the parts it shows. A pack's language is stored as its primary subtag at import (`zh-tw` → `zh`), and the route takes a
primary subtag, so a zh-TW workspace sees zh packs. `n` is the number of distinct characters containing the part; `s` the largest non-zero
stroke count a pack gives the part, 0 when none; `parts` sorted by `s` ascending with 0 last, then code
point. A character in several packs keeps the parts of the first pack by pack id. A language without packs
gives `{"language":"<code>","packs":[],"parts":[],"chars":{}}` (200); a malformed code 400. ETag, gzip and
`Cache-Control: private, max-age=0, must-revalidate` as `/api/characters`. The service worker does not
cache it (`bypass`). `GET /api/component-packs` lists the packs' credits like `/api/frequency-packs`.

## The lookup (`lookup.json`)

Inputs: the universe rows `{i, c, s?, k?, v?}`, the components map and a selection `{r?, p: [], s?}`.

- The **parts of a cell** are the union of the components of its glyph `c` and of each variant in `v`.
- A cell matches when `k === r` (if `r` is set), every chosen part is among its parts (AND), and its
  strokes equal `s` (if `s` is set). Radicals and parts are separate questions: a part 氵 is matched by
  containment only, never through `k`.
- The empty selection (no `r`, no parts, no `s`) gives no results.
- `results`: the matches ordered by strokes ascending with unknown strokes (`s` missing or 0) last, then by
  code point; at most `cap` (300) glyphs. `total` counts all matches. `groups`: `[{s, count}]` over all
  matches in result order (unknown strokes are group 0).
- `availableParts`: the parts of the matches (of the whole universe for the empty selection) minus the
  chosen ones, in code point order. Every other part is shown disabled.
- `availableStrokes`: the distinct non-zero strokes of the cells that match `r` and the parts, ignoring
  `s` (the whole universe when neither is set), ascending.
- **Picker** (`pickerCases`): the parts with `n >= minPartUse` (10), or all with "Show all parts",
  grouped by `s` ascending with 0 (shown as "?") last, each group in code point order, each part
  `disabled` when it is not available.

## Android notes

Fetch `/api/characters?language=` (format 3) and `/api/components?language=` once per session, build the
index in memory, and run the lookup locally; both bodies are ETag-cacheable. The URL form of a selection
is `/search/parts?r=<n>&p=<part>&p=<part>&s=<strokes>` (at most 8 parts; invalid `r`/`s` dropped).
