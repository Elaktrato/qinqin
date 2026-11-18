# HSK 1 sample review (Task 2)

Ten lessons were read against the Appendix B checklist: focus occurs once and
is the point the translation tests; every distractor is wrong in that exact
slot (none is another correct answer); at least one similar/contrastive and one
clearly-wrong distractor; the 1–2 contrast examples are explained in the body;
pinyin tone marks and sandhi are correct and translations match aspect/tone;
vocabulary is HSK 1 (rare above-level words only where the outline lists them
or a contrast needs them); the pattern and summary are accurate; and the
COVERAGE.md row matches the lesson's scope.

## Lessons checked

1. hsk1-particles-ma-ba (split 语气助词: 吗, 吧)
2. hsk1-particles-le-ne (split 语气助词: sentence-final 了, 呢)
3. hsk1-le (了, with 过 contrast)
4. hsk1-negation (不, 没(有), 不要)
5. hsk1-modal-verbs (会, 能, 想, 要, 可以)
6. hsk1-separable-verbs (看病, 睡觉, 上班…)
7. hsk1-measure-words (本, 个, 家, 口, 块, 件, 只, 元, 杯)
8. hsk1-de (的, with 得 contrast)
9. hsk1-double-object (给, 问)
10. hsk1-time-expressions (dates, weekdays, clock time)

## Findings and fixes

- Focus collision fixed (hsk1-double-object): the first draft used 老师问我问题
  and 我问老师一个问题, where the focus 问 also occurs inside 问题, so it appeared
  twice. The build validator caught this. Both examples were rewritten to
  我问你一件事 and 他问我名字, where 问 occurs exactly once and the sentences are
  grammatical double-object forms. Re-checked: focus unique, distractors wrong.
- Distractor soundness: in open verb/modal slots a near synonym would often be
  another correct answer (能/可以 for 会, 过 for 了, 吧 for 吗, 是 for 有, 很 for
  想). Those were deliberately NOT used as distractors; instead the cloze uses
  word-class errors (吗/很/的/在) that cannot fit the slot, and the similar-point
  discrimination is carried by the contrast example and by frames that exclude
  the near point (我要一杯茶 excludes 会/能/想; 我没去过中国 excludes 了;
  他也很忙 excludes 都; 我明天不喝茶 excludes 没). Every example keeps at least
  one clearly-wrong option.
- Intentional pedagogical conventions (not errors): the 的/得/地 distinction is
  enforced strictly (他说得很好, not 说的很好), and a specific past event is
  negated with 没, not 不 (昨天我没去学校). These are the standard HSK
  distinctions the pack teaches; informal usage may differ.
- Above-level words kept rare and justified: 过 in one 了 contrast example (the
  design's own example), 杯 (the outline lists it as a borrowed measure word),
  得/地 in the 的 contrast, and 星期 + numeral (productive from level words).
  All are recorded in ATTRIBUTION.md's vocabulary policy.
- Pinyin follows the hsk-words readings (学生 xuéshēng, 睡觉 shuìjiào, 喂 wèi)
  with sandhi as spoken (不是 bú shì, 一个 yí ge, 一本 yì běn, 不会 bú huì);
  third-tone sandhi unmarked, neutral tones unmarked, proper nouns capitalised.

No wrong distractor, unexplained contrast, tone error or misleading pattern
remained in the ten lessons after the fix above. Native-speaker review is still
a separate, open item; this is an author self-check, not a native review.