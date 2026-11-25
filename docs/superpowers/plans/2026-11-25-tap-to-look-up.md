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
- Ruling (fix wave, replaces "a tap on the backdrop only closes"): a press on the open phone sheet's backdrop
  keeps the modal sheet until the finger lifts; the release closes it, and a tap then hit-tests its point with
  `document.elementFromPoint` 30 ms later and looks up the word there through the shared `#wordAt`; a tap on a gap,
  on punctuation or on anything outside the lookup text only closes. The click the browser sends after a touch
  press on the backdrop is swallowed (capture listener, `preventDefault` + `stopPropagation`, once) — the owner's
  intent is that a tap on a word looks it up; the sheet stays modal (focus trap, Escape, back button, return
  focus); closing on the release instead of the press keeps the release on a mounted element, so it reaches the
  window listener, and Chromium hit-tests the click afresh after the sheet is gone, which without the swallow
  would follow a link that was under the backdrop — cost if wrong: a mouse press on the backdrop closes on release
  instead of on press (no visible difference), and a click the swallow eats is lost (it only arms for a touch or pen
  press on the backdrop and disarms on the next press).
- Ruling (fix wave): a press within 150 ms (`FLING_STOP_MS`) of a scroll event, after a touch the browser took over
  to pan (pointercancel), is no tap — momentum scrolling stops when the finger lands, and that stopping touch must
  not look a word up; a fling always starts with a pan, so a scroll no finger started (a script, the wheel, the
  sheet keeping its word in view, the e2e test's own scrolling) blocks no tap — cost if wrong: a deliberate tap
  within 150 ms of a fling's last frame needs a second tap; a fling the browser runs without a pointercancel first
  would still let its stopping touch tap.
- Ruling (fix wave): a primary touch or pen press always starts a fresh tap, and only a non-primary press (a second
  finger) cancels one — a release can be lost (its target unmounted, an up stopped before the window), and it must
  not eat the next tap — cost if wrong: none found; a pinch's second finger is never primary.
- Ruling (fix wave): a tap tries its point, then 4 and 8 px above and below it (`tapProbes`, `TAP_SLACK_PX = 8`),
  and takes the first character box it meets; its target need only be inside a paragraph (`[data-p]`), not a run;
  hover stays exact — with line height 2.2 the leading of CJK text is about 12 px per line, so a finger landing
  there was dead; 8 px reaches the nearer line from most of the gap without reaching across a whole one — cost if
  wrong: a tap in the exact middle of a very tall gap still finds nothing, and the nearer line wins over the one
  the learner meant when the finger was nearer the other.
- Ruling (fix wave): a click with `detail === 0` (the keyboard, a script) is never a tap's click — Enter on a
  focused highlight right after a touch must still edit it — cost if wrong: none found.
- Ruling (fix wave): a tap that finds no word inside the text tells the host what it landed on
  (`onTapNoWord`); the reader opens the highlight editor when that is a `mark[data-h]` — a highlight on
  punctuation, Latin or digits had no way to be opened by touch — cost if wrong: none found.
- Ruling (fix wave): while the lookup sheet is open it sets `--lookup-sheet-space` (its `offsetHeight`) on the root
  element, measured with the sheet's top, and the phone page panel's bottom padding is
  `max(var(--bottom-bar-space), var(--lookup-sheet-space, 0px))`; the property is removed when the sheet goes —
  the last line of a chapter, the latest conversation reply and a lesson's end could not scroll above the sheet;
  the bottom bar is under the sheet's backdrop then, so the larger of the two is enough (the conversation's
  composer is in the page flow, not fixed) — cost if wrong: when the sheet closes the page may jump back by that
  padding.
- Ruling (fix wave): the sheet measures itself again on window and `visualViewport` resizes (the keyboard closing
  in the WebView), as well as on its own size changes — cost if wrong: none found.
- Ruling: no new interface strings — the sheet's label, the not-found text and the actions exist — cost if wrong:
  none.

## Execution record

- Task 2 (`tapGesture`): 12 tests written first, failed on the missing module, then passed.
- Task 3 (`keepAbove`): 9 tests (6 unit, 3 jsdom) written first, failed on the missing module. One unit case
  then failed against the first implementation (a word 5 px under the top but inside the margin was scrolled
  down 7 px); the rule was sharpened to "only a word cut off at the top comes down", as the Ruling says.
- Task 7 (e2e) was written before the controller code and run on the unchanged app: it failed ("element(s) not
  found": no sheet after `locator.tap`). After tasks 4–6 it passed. To check that it really tests the scroll, the
  `keepWordAbove` call in `LookupSheet.svelte` was disabled for one run: the test failed with the word's box
  197.6 px below the sheet's top, then the call was restored.
- Task 4 (controller): 18 jsdom tests in `useLookup.tap.dom.test.ts` written first; all failed (`listen` is not
  a function), then passed. The one fix on the way was the test's own index (み, not ま, at code point 5).
- Task 5 (highlights): `tapHighlight.dom.test.ts` (real ChapterText, controller and phone sheet) failed on the two
  tap cases (the editor opened) and passed on the mouse case before the change; `actionSpan`'s 3 unit tests failed
  on the missing export. All pass after it. `ChapterText.dom.test.ts`'s stand-in controller gained `listen`.
- Task 6 (sheet): the LookupSheet test (the sheet measures itself on open and on growth) failed (nothing observed),
  then passed.
- Deviation: the full suite found the conversation and lesson tests' mocked `LookupController` without `listen`
  (9 unhandled errors, every test still green). Fixed in a separate commit (`test(journal,grammar)`), not folded
  into task 4's.
- Environment: under Node 22, 4 tests of `BookView.dom.test.ts` fail on 1 s `findBy` timeouts with and without
  this branch's changes (checked with the changes stashed); under Node 26 (CI's) all 34 pass. All gates below ran
  under Node 26 for vitest.

### Gates (2026-11-25)

- `npm run check`: 0 errors, 0 warnings (1779 files; includes `tsc -p e2e`).
- `npm run build`: ok.
- Full vitest under Node 26.13.1: 626 files, 13015 passed, 2 skipped, exit 0, no unhandled errors.
- e2e (`npm run e2e -- --trace off`, pre-installed Chromium): 3 runs, 19 passed each (the 18 of develop plus the
  new tap test), no failures, no flakes.
- `node --test scripts/*.test.mjs`: 144 tests, 143 passed, 1 skipped (the font pack build without
  `scripts/fonts` installed), 0 failed.
- `node scripts/gen-api-docs.mjs --check`: ok (no routes changed).
- No Go change, so no Go gate.

### Not verified

- A real Android WebView, a real phone, Safari/WebKit and Firefox: the e2e taps are Chromium's emulated touch
  (`hasTouch`, `isMobile`). The long-press interplay with the system selection menu, the real double-tap delay
  with `touch-action: manipulation`, the `pointerType` of real compat clicks and the 30 ms settle against a real
  selection clearing were not observed on a device.
- A pen. Only the rules are tested.
- A tap in the conversation partner's replies and in grammar lessons: they go through the same `listen` and
  controller, but no test taps there (their DOM tests mock the controller).
- (Fixed in the fix wave: the last line now gets room under it, `--lookup-sheet-space`.)
- Screen readers: the tap adds no new interface, and the sheet is the one a selection opens.

### Fix wave (independent review, 2026-11-25)

The review found 5 should-fix items and 6 nits; all were fixed test-first (each new test seen failing first):

1. A lost pointerup ate the next tap: `TapTracker.down` now starts a fresh tap on every primary press; test "a lost
   release does not eat the next tap" failed, then passed.
2. A touch that stops a fling looked a word up: the tracker records scrolls (`scrolled`) and ignores a press within
   150 ms of one after a pan. The first version (any scroll) broke the e2e tap test, whose own `scrollBy` came
   right before the tap; narrowed to scrolls after a pointercancel (Ruling above), with tests for a fling, for
   repeated presses during one, and for a scroll no finger started.
3. A tap behind the open phone sheet now looks that word up (Ruling above). `tapSheet.dom.test.ts` (real
   ChapterText, controller and sheet): another word, a gap, the sheet staying modal while the finger is down, and a
   link under the backdrop whose click is swallowed; three of its four tests failed before the change. The e2e tap
   test goes on to tap 学 behind the backdrop with `page.touchscreen.tap` and sees the sheet for 学校 (passed in
   real Chromium on the first run after the change).
4. The last line could not reach above the sheet: `--lookup-sheet-space` (Ruling above). The
   `bottomBarRules.test.ts` padding rule and a LookupSheet test (set, updated on growth, removed on unmount) failed
   first; the new e2e test (tap 水 on the last line after scrolling to the very end) failed with the word under the
   sheet, then passed.
5. Taps in the line gap: `tapProbes` (Ruling above). The controller test (glyphs 8 px under the finger found, 9 px
   not) failed first; a hover test pins that hover stays exact.
6. Viewport resizes: the LookupSheet test (window and `visualViewport` resize measure again; nothing after unmount)
   failed first.
7. e2e: `expectAboveSheet` also checks that the word's top is on the screen (`y >= 0`) and that
   `CSS.highlights.has('reader-lookup')`.
8. `touchClick` treats `detail === 0` as never a tap's click; unit and controller tests failed first.
9. A tap with no word on a highlight opens its editor (`onTapNoWord`, `highlightMark`); the tapHighlight test (a
   highlight on 。) failed first. The test wires `onTapNoWord` as BookView does; BookView's own wiring is covered by
   review and the type check only.
10. Wiki: `Grammar-lessons.md` (taps and selections count in the history), `Reader.md` (a tap behind the sheet looks
    the next word up; flings; the line gap; punctuation highlights; room under the last line).
11. Known limit, no change: TalkBack's double tap sends a touch to the centre of the focused element (a whole
    paragraph), so with TalkBack on, a double tap looks up whatever character sits at the paragraph's centre.
    Screen-reader users look words up by selecting text, as before.

Also: the `useLookup.tap.dom.test.ts` layout stand-in needed a type annotation for the check (`test(reader)`
commit).

Fix-wave gates (2026-11-25, at 67db08a4):

- `npm run check`: 0 errors, 0 warnings (1780 files).
- `npm run build`: ok.
- Full vitest under Node 26.13.1: 627 files, 13033 passed, 2 skipped, exit 0, no unhandled errors.
- e2e: 3 runs, 20 passed each (develop's 18, the tap test, the last-line test), no failures.
- `node --test scripts/*.test.mjs`: 144 tests, 143 passed, 1 skipped, 0 failed.
- `node scripts/gen-api-docs.mjs --check`: ok.

Still not verified after the fix wave: a real device or WebView (the backdrop release, the swallowed click and the
fling rule are seen in emulated Chromium touch and jsdom only), the keyboard-closing resize, and BookView's
`onTapNoWord` wiring beyond the type check.

