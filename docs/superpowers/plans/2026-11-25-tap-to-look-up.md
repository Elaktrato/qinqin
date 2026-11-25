# Plan — tap to look up on touch screens

Spec: [`2026-11-25-tap-to-look-up-design.md`](../specs/2026-11-25-tap-to-look-up-design.md) (approved by the owner
on 2026-11-25; its owner calls are decided). No GitHub issue. Branch `feature/tap-lookup` from `develop` at
6a73e7d2, worktree `.claude/worktrees/tap-lookup`. Records [0001](../../architecture/0001-error-handling.md) (lookup
errors stay `apiErrorMessage`), [0004](../../architecture/0004-web-folder-rules.md) (everything stays in
`lib/features/reader`, which the journal's conversation and the grammar lessons already import),
[0005](../../architecture/0005-test-conventions.md) (an injected clock, no wall-clock assertions; e2e waits for
conditions) and [0009](../../architecture/0009-web-state-model.md) (the controller takes its dependencies as
options; no module state). It must work inside the Android shell's WebView
(`docs/superpowers/specs/2026-11-23-android-shell-design.md`).

## Design as planned

- **`tapGesture.ts`** (pure): `TapTracker` follows one touch or pen pointer from down to up (`down`, `move`, `up`,
  `cancel`) and answers the tap point or null; a second pointer, a pointercancel, a scroll, a move over
  `TAP_MAX_MOVE_PX` or a hold over `TAP_MAX_MS` is no tap. `touchClick` tells a click that a touch or pen tap
  produced (its `pointerType`, else a touch release within `TOUCH_CLICK_MS`). `TAP_IGNORE` names the controls a
  tap never looks up on.
- **`keepAbove.ts`** (pure plus one DOM walk): `scrollDeltaAbove(word, bounds, margin)` is the scroll that puts a
  word's box above the sheet's top edge with a margin, never pushing its top past the visible top;
  `scrollParent(el)` finds the scroll container (the nearest scrolling ancestor, else the window).
- **`LookupController`**: `#wordAt(x, y, target)` is the word finding `#resolveHover` used (now shared by hover
  and tap). The window listeners feed the tracker; a tap waits `TAP_SETTLE_MS` (as a selection after pointerup
  does), steps aside if a selection exists, then looks up at the tapped offset and opens a sticky stack
  (`mode: 'selection'`, `tapped: true`) on the first result's span, counted in the history as a selection. A tap
  on no word only closes (pointerdown already closed the open lookup). `listen(el)` replaces the three copies of
  the container listener wiring and sets `touch-action: manipulation`. `fromTouch(click)` lets ChapterText skip
  the highlight editor for a click a tap produced. `keepWordAbove(sheetTop)` scrolls the sticky lookup's word
  above the sheet.
- **`LookupSheet.svelte`**: measures its dialog (on mount and on every size change) and calls
  `keepWordAbove(innerHeight - height)`.
- **`ChapterText.svelte`**: the click-on-highlight handler ignores clicks from touch; `lookup.listen(el)`.
- **`BookView.svelte`**: the highlight actions of a tapped stack act on the highlight under the word
  (`actionSpan` in `highlightUi.ts`), so a colour recolours that highlight and Note opens its editor.
- **`ConversationView.svelte`, `LessonView.svelte`**: `lookup.listen(el)`.
- **e2e**: `reader.spec.ts` "on a phone" gains a tap test (`hasTouch`, `isMobile`, `locator.tap`): the sheet named
  for the word opens, the word's box is above the sheet's top, and `getSelection()` is empty.
- **Wiki**: `Reader.md` (lookup, highlights, history), `Searching-and-entries.md` (history), `Journal-and-AI.md`
  and `Grammar-lessons.md` where they say hover/select.

## Tasks

1. Plan (this file). `docs(plan)`.
2. `tapGesture.ts` + `tapGesture.test.ts`: tracker and touch-click rules, test-first. `feat(reader)`.
3. `keepAbove.ts` + tests (unit for the delta, jsdom for `scrollParent`), test-first. `feat(reader)`.
4. Controller: `#wordAt`, tap path, `listen`, `fromTouch`, `keepWordAbove`; jsdom tests
   `useLookup.tap.dom.test.ts` (tap opens a sticky lookup for that word; drag, long press, scroll, pointercancel,
   control, selection do not; a tap on no word closes; history counts), test-first. The three hosts switch to
   `listen`. `feat(reader)`.
5. Highlights: ChapterText ignores a touch click on a mark (mouse click still edits), `actionSpan` in
   `highlightUi.ts`, BookView uses it; jsdom tests for ChapterText's click handling and unit tests for
   `actionSpan`, test-first. `feat(reader)`.
6. LookupSheet scrolls the word above the sheet; jsdom test that opening the sheet calls `keepWordAbove` with the
   sheet's top, test-first. `feat(reader)`.
7. e2e phone tap test, written before the code of tasks 4–6 and seen failing on the unchanged app; committed with
   them green. `test(e2e)`.
8. Wiki. `docs(wiki)`.
9. Gates; Execution record. `docs(plan)`.

## Rulings

- Ruling: a tap is a touch or pen pointer released within 500 ms (`TAP_MAX_MS`) and 10 CSS px (`TAP_MAX_MOVE_PX`,
  straight-line distance from where it went down, checked on every move) — the spec's usual values: Android's own
  touch slop is 8 dp and its long-press timeout 400–500 ms, so a press long enough to start the system's text
  selection is, in the overlap, also caught by the selection check below — cost if wrong: a slow tap is ignored (too
  short) or a short drag looks a word up (too long); both are one constant.
- Ruling: a tap is resolved 30 ms after the release (`TAP_SETTLE_MS`, the delay the selection path already uses
  after pointerup) and steps aside when the page then has a non-collapsed selection — the browser settles the
  selection after the release, and a long press that selected text belongs to the selection path; the two paths
  are thereby exclusive — cost if wrong: a tap right after a long-press selection elsewhere may be read as that
  selection (the selection path's own behaviour today).
- Ruling: a click counts as a tap's own click when its `pointerType` is touch or pen, or, for a click without one
  (older WebKit), when a touch or pen release came less than 1000 ms (`TOUCH_CLICK_MS`) before it; a `mouse`
  click never does — Chromium (and so the Android WebView) gives clicks a `pointerType`; the time window is only
  the fallback — cost if wrong: in that fallback a mouse click on a highlight within a second of a touch does not
  open the editor (the lookup opens instead).
- Ruling: the scroll container is the nearest ancestor of the word's paragraph whose computed `overflow-y` is auto,
  scroll or overlay and that has more content than room, else the window (`document.scrollingElement`) — today
  every host (the reader, the conversation, the lessons) scrolls with the window (`routes/+layout.svelte`: "The
  page scrolls with the window"), and the walk keeps a later inner scroller working without a change here — cost
  if wrong: a host with an unusual scroller (a transformed or `overflow: clip` one) does not move and the word
  stays under the sheet.
- Ruling: the word sits 12 px (`WORD_MARGIN_PX`) above the sheet's top; when the room above the sheet is smaller
  than the word, the word's top goes 12 px under the top of the scroll container instead (never above it) — a
  word pushed off the top is as hidden as one under the sheet — cost if wrong: on a very tall sheet the word's
  lower part stays covered.
- Ruling: the sheet's top is `innerHeight - dialog.offsetHeight`, measured on mount and on each size change
  (`ResizeObserver` where it exists), and the scroll only ever brings the word into view (it is computed from the
  word's position each time, so a repeat is a no-op) — the dialog is fixed to the bottom edge and slides in with a
  translate, so its bounding box is wrong during the animation while `offsetHeight` is not; a selection's sheet
  grows when its results arrive — cost if wrong: the margin is off by the sheet's border during odd layouts.
- Ruling: the scroll is instant under `prefers-reduced-motion: reduce` and smooth otherwise — the design system's
  motion rule — cost if wrong: none beyond taste.
- Ruling: the word is kept above the sheet for every sticky lookup (tap and long-press selection), never for a hover
  lookup on a phone with a mouse — a selection's word is covered just as much; a scroll closes a hover lookup —
  cost if wrong: none found.
- Ruling: a tap stack is a sticky `mode: 'selection'` stack (same bar with the looked-up text, same highlight
  actions, same re-anchoring on scroll, recorded as `'selection'` in the history) plus a `tapped` flag — the spec
  says it opens "the way a selection does"; a third mode would touch every reader of `info.mode` for no
  difference — cost if wrong: a later need to tell taps apart in the history needs the mode split (the flag is
  there).
- Ruling: the sheet opens when the tap's lookup answers (as a hover does), not at once with "Looking up…" — the span
  to mark and name the sheet after is the first result's word, known only then; the lookup is cached and small —
  cost if wrong: on a slow server the first tap waits without feedback.
- Ruling: a tap on a lookable character that has no dictionary entry opens the sheet with "No entries for …" (as a
  selection does), while a tap on whitespace, punctuation, Latin or digits counts as no word — a tap is a deliberate
  act that deserves an answer, while hover's silence exists for a pointer passing over text — cost if wrong: one
  sheet the learner closes.
- Ruling: the highlight actions of a tapped stack act on the highlight under the tapped word when the word lies
  inside one (`actionSpan`): picking a colour recolours it and Note opens its editor; otherwise on the word —
  the owner's call "the sheet already carries the highlight's actions": without this a tap inside a highlight
  would act on a sub-span and only reach the editor with an "overlaps" notice — cost if wrong: a learner who wanted
  a new highlight inside an existing one must long-press (overlaps are refused anyway).
- Ruling: `LookupController.listen(el)` wires the container listeners and sets `touch-action: manipulation` on the
  element (restored on cleanup), replacing the three copies in ChapterText, ConversationView and LessonView — the
  spec wants the no-delay rule everywhere the controller serves; one place keeps the hosts from drifting — cost if
  wrong: a host that needs its own `touch-action` must set it after `listen`.
- Ruling: a tap while the phone sheet is open lands on the modal sheet's backdrop and only closes it (a second tap
  looks the next word up) — the sheet is modal (record of the design system, `lib/ui/modal.ts`) and the page
  behind it is inert — cost if wrong: one more tap to look up the next word on a phone.
- Ruling: no new interface strings — the sheet's label, the not-found text and the actions exist — cost if wrong:
  none.

## Execution record

(filled in while building)
