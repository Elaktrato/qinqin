# Tap to look up — design (short)

Status: approved by the owner on 2026-11-25.

## Intent
On a phone, a word is looked up only by long-pressing it to make a selection. That opens the phone's own selection
menu as well, and the lookup's bottom sheet then covers the word that was looked up. The owner wants **a tap on a
word to look it up**.

## Today
- The lookup controller (`apps/web/src/lib/features/reader/useLookup.svelte.ts`) has two paths:
  - **hover**, mouse only: `#resolveHover` finds the word under the pointer through `caretFromPoint`, the runs and
    `HoverLookup`;
  - **selection**, for touch and pen.
- The phone shows the root frame in `LookupSheet.svelte` (`lib/ui/Sheet`).
- The same controller serves the reader (`ChapterText.svelte`), the AI conversation partner's replies
  (`features/journal/conversation/ConversationView.svelte`) and grammar lessons (`features/grammar/LessonView.svelte`).

## Approaches
- **A — a tap resolves the word like a hover and opens a sticky lookup (chosen).** It reuses the hover word finding,
  so a tap and a hover always agree on what "the word" is.
- **B — on tap, select the word programmatically and let the selection path run.** Rejected: the selection would
  still raise the phone's selection menu, which is the complaint.
- **C — a separate tap handler with its own word finding.** Rejected: it would duplicate the hover code, and the two
  could disagree.

## Design
- **What a tap is:** a touch or pen pointer that is released within a short time and a small movement of where it
  went down. It leaves no selection and does not land on a control (a link or a button).
  - A tap over text resolves the word under the finger exactly as `#resolveHover` does.
  - It then opens the lookup the way a selection does: sticky, in the bottom sheet on a phone and the popup stack
    elsewhere. It counts in the lookup history like a selection lookup.
  - A tap on no word closes an open lookup.
  - A scroll, a drag or a long press is no tap.
- **Long press stays:** it still makes a selection. Highlights and multi-word lookups need one. It is no longer needed
  for a single word. (Owner call.)
- **Tapping a highlight** opens the lookup, not the highlight editor. The sheet already carries the highlight's
  actions (`HighlightActions`), so every word reacts the same way. A mouse click on a highlight still edits it.
  (Owner call.)
- **The word stays visible:** when the sheet opens, the reading area scrolls so the tapped word sits above the
  sheet's top edge with a small margin. The word keeps its lookup highlight.
- **No tap delay:** `touch-action: manipulation` on the lookup text, so a tap does not wait for double-tap zoom.
- **Everywhere:** the reader, the conversation partner and grammar lessons, through the shared controller.

## Constraints
- Records 0001, 0004, 0005 and 0009 apply. The logic (the tap rules and the scroll offset) lives in tested pure
  modules.
- It must work in the Android shell's WebView.
- The e2e suite stays green. Add a phone-viewport spec: tap a word, the sheet opens for that word, the word is above
  the sheet, and no text selection exists.

## Left to the builder
- The exact tap thresholds: a duration of about 500 ms and a movement of about 10 px are the usual values.
- How the scroll finds its scroll container: the reader's own, or the window.
