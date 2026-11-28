# Chinese course: review notes (#223)

`course.json` (the skeleton of 65 units and the 27 reading texts of ≈ HSK 1–2) was written for qinqin and **reviewed
by agents acting as native-speaker teachers, not yet by a person**; the manifest's attribution and notice say so. The
owner reviews and corrects it later, in use, as with the grammar lessons. Licence: CC BY 4.0 (`LICENSE`).

## How it was made

1. **Draft (the builder, 2026-11-28).** Sections and units, their themes (topic ids) and the placement of every
   `zh-grammar` lesson of the level; the units filled on a scratch server with the bundled `hsk-words`, topic labels
   and dictionaries; the characters each unit introduces taken from the real fill (first use); one short text per
   unit of ≈ HSK 1–2, checked against the words reached at that point (`server/internal/courses/realdata_test.go`).
2. **Two teachers, independently** (`claude -p --effort high`, no tools), with the whole course: every unit's
   topics, grammar lessons, characters and filled words, and every text with its translation and the check's new
   words:
   - `zh-teacher-1`: a native Mandarin speaker from Beijing, fifteen years teaching adult beginners abroad (HSK 1–3),
     who designs her school's first-year curriculum and its reading materials.
   - `zh-teacher-2`: a native Mandarin speaker from Nanjing who teaches at a university language centre and writes
     graded readers (分级读物) for HSK 1–4, strict about idiomatic Chinese and measure words.
3. **Adjudicator** (`zh-adjudicator`: the curriculum lead of a Chinese language school, a native speaker from Beijing),
   who saw both reviews and the facts the builder checked (the fill cannot be moved by hand; which words are in which
   HSK level; the four-new-word rule) and decided every point.
4. **Applied** by the builder and checked again against the real fill (every text within four new words).

## What the review changed

- **Texts.** 26 of the 27 texts were revised: 24 bodies and 23 translations changed (hsk1-health was kept; hsk1-food and
  hsk1-school changed only their translations).
  - Measure words: 一碗面条儿, 两碗米饭, 一把椅子, 一家电影院/公司/超市/书店/饭馆, 这块手表 (the drafts overused 个).
  - Natural answers: 不是，我不是… to a 是-question, 对 to a 吧-question, 有时间吗, 两百块, 从小就认识, 拿着东西呢,
    懂得多了, 第一次说汉语的时候.
  - Logic: hsk1-hello became a mistaken-identity scene (so 对不起 and 谢谢 have a reason), hsk1-names asks "is he your
    husband?", the shopping, studying, around-town and eating-out texts no longer contradict themselves.
  - Each text now uses its own unit's grammar where the words allow: 有/都 (family), 几口人 (numbers), 再要
    (restaurant), 一…就… (around town), V得 (sports, studying), 看了看/写了写 (studying), 还是…吧 (eating out),
    虽然…但是 with 可能 (weather).
  - Translations: 我不吃了 as a polite refusal, 读书 as reading aloud, 过年 as Chinese New Year.
- **Unit titles.** hsk1-names "Names", hsk1-family "Family and friends", hsk2-friends "Friends and relatives",
  hsk2-home "Helping at home", hsk2-seasons "Weather and nature", hsk2-plans "Hopes and plans".
- **Grammar moves (lesson to the unit whose words it needs).** ≈ HSK 1: hsk1-wei → weather; hsk1-zai-zhengzai and
  hsk1-progressive → health; hsk1-separable-verbs → work. ≈ HSK 2: existential-zhe → colours; together → friends;
  question-why → weather and nature; yinwei → travel; adversative-complex → weather and nature; modal-possibility →
  plans. ≈ HSK 3: compass-directions and xiang-direction → city; both 把 lessons → daily life; measure-words-units,
  verbal-measures and measure-reduplication → shopping. ≈ HSK 4: gan → emotions; ge-renhe → people;
  measure-words-special, approx-numbers, decimals-fractions → numbers; time-adverbs-habit, time-adverbs-soon,
  frequency-adverbs → life changes; choice-bushi-jiushi, adversative-clauses, conditional-yaoshi-fouze → thinking.
- **Not applied, and why.**
  - Treating the pronouns of hsk1-personal-pronouns as known before their words are filled: the check counts words,
    and the fill puts 她 in hsk1-food; texts before it spend a new word on 她.
  - Adding 以后, 杯, 碗, 把, 得 earlier: they are HSK 3 words or not in the list; texts use them as new words.
  - Splitting ≈ HSK 4 units (about 47 words each) or a second text per unit, and merging the duplicate grammar lessons
    of ≈ HSK 3–4 (zh-grammar pack work): follow-ups.

## Follow-ups

- A Chinese frequency list, so the fill's order inside a level is not alphabetical (common words like 以后, 就, 她 land
  late; 那 and 说 in unit 12).
- The reading lesson's segmenter misreads some strings (有时间 → 有时|间, 学得很好 → 得很, 想出 …) and marks reached words
  joined into longer dictionary words (不是, 一个, 中国人) as new; reported for the reader.
- ≈ HSK 3–4 texts: when they are written, each uses its unit's grammar, and 但是 rather than 可是 before hsk3-travel.
- Duplicate lessons to merge or mark as review: hsk3-zhiyou-zhiyao-ruguo / hsk3-zhiyou-zhiyao, hsk3-ruguo-jiu;
  hsk3-budan-erqie-keshi-ranhou / hsk3-budan-erqie, hsk3-suiran-keshi; hsk3-weile-wei / hsk3-weile-purpose;
  hsk3-huo-huozhe / hsk3-huozhe-huozhe; hsk3-yibian / hsk3-you-you-yibian; hsk3-question-zenyang /
  hsk3-zenyang-questions; hsk4-mood-jingran-daodi / hsk4-rhetorical-nandao; hsk4-prep-jiang-you-jiao-rang /
  hsk4-passive-jiao-rang.
- Light units after the moves (hsk3-feelings, hsk4-character, hsk4-people): rebalance when their texts are written.

The full review outputs are summarised here; the builder's plan (`docs/superpowers/plans/2026-11-28-223-course-content.md`)
records the rulings.
