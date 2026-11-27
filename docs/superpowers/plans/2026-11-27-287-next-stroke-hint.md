# #287 — after three misses, hint only the next stroke (2026-11-27)

Milestone v0.9.0, phase 2. Branch `feature/v090-287-next-stroke-hint`, from `feature/v090-285-larger-pad` (#285).

## What

Today three misses on one stroke make the next stroke glow and then leave the whole character's outline on the pad
as a scaffold for the rest of the character, once per character (`lib/writing/quiz.ts`: `autoHinted`,
`outline: true`; `WritingPad.svelte` draws `.outline.scaffold`). That gives the rest of the character away.

Wanted: after 3 misses on a stroke, show **that stroke only**: the glow with its start marked, and then the stroke
stays faintly visible (dimmed, with its start) until the learner draws it. No outline of any other stroke. The rule
applies again to any later stroke that gets 3 misses. Each automatic stroke hint counts as one hint in
`meta.hints`. The Hint button and Show strokes are unchanged. Both pads share `quiz.ts`.

## Tasks

1. This plan.
2. `quiz.ts` (test first): `QuizState` loses `autoHinted` and `outline`, gains `autoHints` (count) and `trace`
   (the stroke shown dimmed, or null). The third miss on a stroke glows it and sets `trace`; a match that covers it
   clears `trace`; a fourth and later miss on the same stroke adds nothing; the next stroke starts counting at 0
   again. `hintsOf` = manual + automatic hints. Tests: a second stroke reaching 3 misses, no outline state, the hint
   count, a join that covers the traced stroke.
3. `WritingPad.svelte`: draws the traced stroke (outline and start marker, dimmed) instead of the scaffold; the lint
   allowlist entry for `.outline.scaffold` becomes the trace's.
4. Docs: the writing-feel design (on-miss rule and the decision "Hint after 3 misses"), the flashcards design (Round 2
   text), the wiki (Flashcards: Writing; scripts trainer), `docs/releases/NEXT.md`. No stroke contract describes the
   scaffold (`docs/contracts/strokes/` covers the route only; `cards/` the hint control); the cards README's
   "Recording" line already counts "stroke hints" in `meta.hints`, which now includes the automatic ones: one sentence
   added there so Android counts them the same way.

## Rulings

- Ruling: the automatic hint fires when a stroke's miss count reaches exactly 3 (once per stroke), not again at 6 —
  the trace stays on the pad until the stroke is drawn, so a second glow would add nothing; the issue says "per
  stroke" — cost if wrong: a learner who keeps missing gets no second pulse (the dimmed stroke is still there).
- Ruling: the grade suggestion is unchanged by the automatic hints — the cards contract says the card's own help
  ("stroke hints and shown strokes") is recorded in `meta.hints` but does not lower the suggestion by itself, and the
  three misses already count as mistakes in `suggestWritingGrade`; "the grade suggestion follows" is read as "follows
  the existing rules" — cost if wrong: one more rule to add in `suggestWritingGrade` and the contract.
- Ruling: the dimmed trace keeps its start marker, also dimmed — the issue wants the glow "with its start marked" and
  then "stays faintly visible ... so they can trace it"; a trace without its start leaves the direction to guess —
  cost if wrong: a small dot removed.
- Ruling: a manual Hint press while a stroke is traced still glows it and counts — "Unchanged: the Hint button" —
  cost if wrong: none.
- Ruling: a join (#292) that covers the traced stroke clears the trace (it was drawn) — cost if wrong: none.
- Ruling: Show strokes on a traced stroke fills it as usual; the trace is drawn under the fill and disappears with
  it — cost if wrong: cosmetic.

## Execution record

(filled in as the work goes)
