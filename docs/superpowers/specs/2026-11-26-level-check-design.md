# Level check — design (issue #82, experimental)

A learner picks a target level (HSK 1-6, JLPT N5-N1, or any other bundled level scheme) and sees how much of that
level's vocabulary they cover, an estimate of readiness, and what to study next. Web only, no server code, no new
row family, no contract change. Nothing is ever written by a check.

## What it is, and is not

It estimates **vocabulary and character knowledge only**. It is not the official exam and does not cover
listening, grammar or reading. The screen says so before the check starts and again on the result, and marks the
feature "Experimental".

## Method (pure: `lib/placement/levelCheck.ts`)

1. **Range.** The target level and every level below it (exam lists are cumulative). An entry that sits in two
   levels counts once, at its first.
2. **Coverage from the learner's own data, exactly.** Each entry is `known`, `learning` or `new` ("unseen" on
   screen) by the shared predicate `lib/study/known.ts` (a manual or declared mark, or a well-reviewed vocab card
   = known; a live vocab card = learning). No question is needed for this part.
3. **Sample the rest.** Only entries the app does not call known can still be known from outside the app. Up to
   `SAMPLE_SIZE` (20) of them are drawn without replacement with the placement test's seeded generator
   (`pick` in `placement.ts`, mulberry32): the same seed gives the same sample. The learner answers "I know it" or
   "Not sure" (self-assessed, as in the placement test; "Not sure" counts as not known).
4. **Estimate.** With K entries known by data, N in range and r the sampled "yes" share:
   `readiness = (K + r * (N - K)) / N`. The range is the same formula with the lower and upper end of the 90 %
   Wilson interval of r (lower end 0 when every answer was "Not sure"). Per level the same r is applied to that
   level's own K and N.
5. **Band.** From the point estimate: `ready` at 90 % or more, `close` 70-89 %, `partway` 40-69 %, `early` below.
   The wording for `ready` still says the exam tests more than vocabulary.
6. **Next.** The lowest level (in range) whose estimate is below 90 %. The button starts a level study session
   for it (`levelSessionConfig`, the same as "Study" on a level deck), the app's existing focus path. When every
   level is covered no button is shown.

## Limits (stated on the method, shown in short on screen)

- Self-report over-estimates: someone who clicks "I know it" freely is told they are readier than they are. The
  range reflects sampling noise only, not dishonesty or misreading a similar-looking word.
- 20 answers give a range of about plus or minus 15 percentage points at its widest; a small pool is asked in full.
- One rate r is applied to every level, although the learner probably knows more of the lower levels than the
  upper ones; the per-level figures therefore flatten, and "next" can point one level low rather than high.
- Lists carry written forms and readings, not meanings, so recognition is the only question type; no reading,
  listening or grammar signal exists and none is invented.
- Words the learner knows but did not mark or study are counted only through the sample.

## Where

Settings → Study → "Level check", under "What you already know" (both use the installed level lists through
`lib/placement/levels.ts`; character schemes ask characters). The question card is the placement test's
(`SelfAssessQuestion.svelte`, extracted, not forked).

## Rulings

- Ruling: coverage comes from the learner's cards and marks, only the not-yet-known remainder is sampled — it is
  exact where we have data and spends questions where we do not, and keeps a long-time learner's check short —
  cost if wrong: a learner whose cards were created in bulk but never studied counts those as "learning", not
  known, and is asked about them.
- Ruling: the range is cumulative up to the target, not the target level alone — the exams assume the lower
  lists and the declaration feature already treats levels as "everything up to" — cost if wrong: a learner
  checking HSK 4 is asked partly about HSK 1-3 words they surely know; the data covers most of those for free.
- Ruling: one pooled yes-rate, not a per-level one — 20 questions cannot support a rate per level — cost if wrong:
  see the limits; "what to study next" can be one level off.
- Ruling: extend the placement generator (`pick` exported, question card extracted), not a second generator —
  one seeded sampler to test and to trust — cost if wrong: a later change to the placement's sampling changes
  level checks too.
- Ruling: nothing is written, no marks are offered — the check is advice, "I already know this" stays the
  declaration path — cost if wrong: a learner has to repeat the placement test to mark what the check just
  suggested they know.
- Ruling: Settings → Study, not a new route or nav entry, for an experimental feature — it ships without
  adding navigation and is easy to remove or promote — cost if wrong: it is hard to find.
- Ruling: only installed level schemes (the bundled, licensed ones), never a sample scheme — same filter as
  placement (`declarableSchemes`) — cost if wrong: none beyond the placement's.
