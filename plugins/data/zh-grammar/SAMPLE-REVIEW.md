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

## Post-review correction: correct-answer distractors (很 / 在)

A content review found that the binding rule "every distractor wrong in that
exact slot / none another correct answer / none correct under a different
reading" was violated where the distractor 很 or 在 itself fills the gap and
yields a grammatical sentence. Every 很 and 在 distractor in all 262 examples
was then audited by substituting it into the gap and judging the result. Twelve
distractors were replaced (eight 很, four 在); the two named minors were fixed.
The lesson focus and the contrast example were preserved in every case.

### Replaced distractors (example id — old → new — why the old was wrong)

很 produced a correct (or borderline-correct) sentence:
- hsk1-hai-ye-1 — 很 → 再 — 我很喜欢猫 is correct (degree adverb before 喜欢).
- hsk1-subject-5 — 很 → 再 — 我们很喜欢他 is correct.
- hsk1-adverbial-4 — 很 → 再 — 他很喜欢猫 is correct.
- hsk1-declarative-3 — 很 → 没 — 今天很冷 is correct; 没 is a genuine 不/没
  contrast and is wrong before an adjective (今天没冷), so kinds stays similar.
- hsk1-subject-2 — 很 → 们 — subjectless 很喜欢喝茶 is grammatical (pro-drop);
  们 cannot start a sentence.
- hsk1-degree-adverbs-3 — 很 → 在 — 很贵了 is borderline (很…了 change statement);
  在贵了 is ungrammatical. kinds now clearly-wrong (no degree adverb is safely
  wrong in the 太…了 frame).
- hsk1-exclamative-1 — 很 → 在 — 很好了 is borderline; 在好了 is ungrammatical.
  kinds now clearly-wrong.
- hsk1-exclamative-3 — 很 → 在 — 很贵了 is borderline; 在贵了 is ungrammatical.
  kinds now clearly-wrong.

在 produced a correct progressive (or other grammatical) sentence:
- hsk1-modal-verbs-1 — 在 → 第 — 我在说汉语 is a correct progressive; 我第说汉语
  is ungrammatical. (们 was rejected: 我+们 would form 我们, also correct.)
- hsk1-modal-verbs-5 — 在 → 第 — 他在吃十个饺子 is a correct progressive;
  他第吃十个饺子 is ungrammatical. (们 rejected: forms 他们.)
- hsk1-declarative-2 — 在 → 很 — 他在喝茶 is a correct progressive; here the gap
  is the verb 喜欢 itself, so 他很喝茶 (很 before the action verb 喝) is wrong.
- hsk1-negation-5 — 在 → 们 — additional finding from the full audit (not in the
  review's named list): 我今天在想上班 is grammatical (在想 = thinking about);
  我今天们想上班 is ungrammatical. (很 rejected: 很想上班 is correct; 没 rejected:
  没想上班 is correct.)

New distractors were checked for adjacent-character word formation (e.g. 们
after 我/他 forms 我们/他们; 小 before 说 forms 小说) so none accidentally spells
a correct sentence. 再 is wrong before the stative verb 喜欢; 第 cannot modify a
verb; 在 cannot modify an adjective; 没 cannot negate an adjective.

### Minors fixed
- hsk1-prefixes-4 reading: xiǎopéngyǒumen → xiǎopéngyoumen (朋友 is neutral
  péngyou).
- hsk1-time-measures-4 translation: "I have studied Chinese for a year" →
  "I studied Chinese for a year" (V+了+duration without final 了 is a completed
  span, simple past).

### Reviewed and kept (wrong in slot, not defects)
- hsk1-modal-verbs-3 在 → 我在去中国: kept in that round as prescriptively wrong,
  but later replaced with 很 per the tutor's Z2 (colloquial 我在去…的路上 reading).
- hsk1-sentence-types-1 很 → 他很狗: 很+狗 is non-standard slang, not a correct
  HSK 1 sentence; kept.
- All other remaining 很/在 distractors sit in noun, measure-word, particle,
  pronoun or verb slots where 很/在 cannot grammatically appear; verified wrong.

After the corrections, no 很 or 在 distractor yields a correct sentence in its
slot. Re-verified with build --check, a full build, check-sources, and
TestBundledGrammarPack / TestCommittedPackNotices (all pass).

## Chinese tutor review (full 49-lesson / 262-example native-teacher pass)

A native-teacher review (chinese-tutor-hsk-1-report.md) examined every lesson and
example. Its 严重 (S1–S3), 重要 (Z1, Z2, Z3, Z5, Z6) and the correctness-improving
建议 (J1–J6, J8–J12) were applied to the authored source and rebuilt. Z4 (the 20
word-order alternative-order cases) was deliberately NOT fixed — it is a separate
engine/content decision deferred to the controller/owner; those example texts are
unchanged. This is a teacher review, not a release native-signoff: the pack still
ships marked "not reviewed by a native speaker".

### What changed (93 examples, 15 lesson bodies)
- S1: the three 第一+量词 readings now write the spoken sandhi (第一本 dì-yì běn,
  第一个 dì-yí ge); the numerals body's 一 tone rule was rewritten to match.
- S2: the six clozes where 的 formed a legal confirmation sentence (我看的 /
  他认识的 / 妈妈做的 / 我们在的 / 我会说汉语的 / 他会开车的) had 的 replaced.
- S3: the two flagship 我吃了饭。examples (了1 + bare object, not a standalone
  sentence) became 我吃了两个苹果。(le-completed-1) and 我吃了两个包子。
  (progressive-5); both bodies' model sentences updated.
- Z1: three over-strong body claims corrected (没 cannot negate 会 but 没能 exists
  above this level; 再 vs 还 reworded without the false "再想 is impossible" claim;
  "After 没 there is no 了" narrowed to "no 了 right after a 没-negated verb").
- Z2: four weak distractors replaced (想 in 我要一杯茶; 在 in 我想去中国; 什么 in
  你是哪国人; 没/的 in 今天不冷).
- Z3: nine 的-defensible distractors replaced.
- Z5: the repeated same-sentence/same-focus examples rewritten (这是我的书, 我在家
  吃饭, 他是医生, 我是学生, 你是学生吗, 我很好你呢, 我们回家吧, 太贵了, 妈妈正在
  做饭, 我吃饭呢, 请坐, 这是我的第一本书, 你叫什么名字, 我和妹妹都喜欢猫, 妈妈对
  我很好, 书在桌子上), keeping each lesson's grammar point and focus.
- Z6: 这是妈妈的电话。translation now "This is Mum's phone." (not "phone number").
- J1: a full audit of every 的 distractor; 的 removed wherever it forms a
  confirmation or possessive/NP fragment (sentence-final 的, V的O nominals, X的N
  possessives), replaced with absolutely-wrong word classes (吗/很/在/们/第). The
  classic 的/得 error distractors (de-6, attributive-5) are kept intentionally.
- J2/J3/J4: negation body note on past 不 (refusal); de-3 given a contrast context;
  double-object-4 → 他问我叫什么名字。
- J5: translation polish (clothes, "I'll buy/give", "already twelve").
- J6: 看病 kànbìng and 唱歌 chànggē written as single words (3 + 1 readings).
- J8/J9/J10/J11/J12: prefixes body (小 is a free word elsewhere), location-nouns
  body (前边/后边 stand alone), existential-2 → 前边有一个老师, wei body (rising
  wéi on the phone), and the weak 岁/本 distractors → 第.

### Safer frames where a tutor suggestion created a new problem
- J3: the suggested 我喜欢大的苹果，不喜欢小的。puts 的 twice (focus must occur
  once), so it was reframed as 我喜欢大的苹果，不喜欢小苹果。(的 unique).
- J1 replacements were checked for adjacent-character word formation: 们 was not
  used after 我/他/她/你 (would form 我们/他们/…); 在 was not used before an action
  verb (would form a progressive). Two extra traps found and fixed in the audit:
  adverbial-1 们 → 我们忙 (legal plural + bare adjective) replaced with 边;
  degree-adverbs-4 的 → 你的好 (possessive fragment) replaced with 第.

### Deliberately left
- Z4 (20 word-order alternative-order cases): deferred to the controller/owner;
  texts unchanged. The only Z4-listed text that changed is coordinate-clauses-5,
  which was rewritten for Z5 (repeat removal) as explicitly requested; its
  word-order alternative remains a deferred Z4 matter.
- J7 (pure variety polish of same-text/different-focus reuse): not done, per scope.
- The pack's "not reviewed by a native speaker" status is unchanged.

Re-verified: build --check (48 rows / 49 lessons), full build, check-sources,
TestBundledGrammarPack and TestCommittedPackNotices all pass; lessons.json matches
the authored source with no contrast/kinds leakage; every focus occurs exactly
once; every lesson keeps 4–8 examples and 1–2 body-explained contrasts.