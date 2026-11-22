# Japanese grammar pack — ≈ JLPT N5 to N1 (design)

Date: 2026-11-21
Issues: [#111](https://github.com/Elaktrato/qinqin/issues/111), [#119](https://github.com/Elaktrato/qinqin/issues/119)–[#123](https://github.com/Elaktrato/qinqin/issues/123)
Status: proposal. The lesson lists below are qinqin's own selection; the owner's agreement on them
(a "done when" item of every level issue) and the native-speaker review are still open.

## Intent

Ship a Japanese grammar pack, `plugins/data/ja-grammar`, with five levels (≈ N5, N4, N3, N2, N1),
built the same way as the Chinese pack (`docs/superpowers/specs/2026-11-18-grammar-hsk-pack-design.md`):
authored per-level fragments, validated and rendered by `scripts/build-grammar-pack.mjs`, a
reviewable `COVERAGE.md`, the existing schema (with the optional `noOrder` flag), Grammar page and
exercises.

Unlike HSK, the JLPT publishes no grammar list. Issue #111's rule applies unchanged: the selection
and order of grammar points per level are qinqin's own; nothing is copied or paraphrased from JLPT
preparation books or other published lists. Grammar points are facts of the language; the lists
below group and order them for this app. Levels are estimates ("≈ N3"), never "the official N3
grammar".

## Decisions

- **Layout:** one pack, `ja-grammar`, type `grammar`, language `ja`, levels `n5` … `n1`
  (names "Level N5 · First sentences" … see below). Licence CC0 1.0, like `zh-grammar`.
- **Badge:** each level declares `schemeLevels: [{scheme: "jlpt-kanji", level: "N5"}]` …; the
  Grammar page shows "≈ N5" only when the bundled `jlpt-kanji` level pack is installed (it is
  bundled). That pack is a kanji list, so the badge is an orientation, as for HSK.
- **Readings:** `reading` is the whole sentence in kana — hiragana for words written with kanji,
  katakana words kept in katakana, Japanese punctuation kept, no spaces. This matches how the app
  shows Japanese readings elsewhere (kana, not romaji) and avoids a second romanisation standard.
- **Translations:** natural English.
- **Register:** N5–N4 examples use polite ます/です style unless the lesson teaches plain forms;
  from N3 on, plain and polite style mix as natural; N2–N1 examples may use written style.
- **Word order:** Japanese allows argument scrambling, but an order such as 本を私は読みました is
  marked; only neutral second orders count. `noOrder: true` marks examples whose tiles have a
  neutral second order (a time word or adverb that sits naturally before or after the topic, two
  conjoined items that can swap, two clauses that can swap). Authors prefer sentences with one
  natural order.
- **Coverage index:** `COVERAGE.md` lists qinqin's own numbered points per level with the lesson
  id(s); it is the completeness check against this design, not against an outside list.
- **Review:** each level gets a full Japanese-language review by an AI model prompted as an
  experienced Japanese teacher (日本語教師), fixes applied, before it is committed. The pack stays
  marked "not reviewed by a native speaker" until a fluent speaker reviews it.

## Levels and points

One lesson per point by default; a point may split into two lessons when eight examples cannot
teach it. Every lesson: 4–8 examples, 1–2 contrast examples explained in the body, 2–4 distractors
per example that are wrong in the slot.

### N5 — `n5`, "Level N5 · First sentences" (40 points)

1. AはBです / だ: the copula
2. ではありません / じゃない: the negative copula, でした / でしたか
3. か and question words (何, 誰, どこ, いつ, どれ, いくら)
4. の between nouns (possession, type, place)
5. も: also, too
6. こ・そ・あ・ど: これ / この / ここ / こちら
7. あります / います: existence of things and living beings
8. Place に + あります / います; Nの上 / 中 / 前 / 横
9. Verb ます form: ます, ません
10. Past polite: ました, ませんでした
11. を: the direct object
12. に for time and destination; へ for direction
13. で: place of an action, means and tool
14. と: and (complete list), with (a partner)
15. から and まで: from, until
16. い-adjectives: present, くない, かった, くなかった
17. な-adjectives: な before nouns, じゃない, でした
18. Adjectives before nouns and as predicates
19. が好き / 嫌い / 上手 / 下手 / 分かる
20. は and が: topic and new information
21. ませんか / ましょう / ましょうか: invitations and offers
22. たい: want to do
23. てください: requests
24. て form linking actions (〜て、〜て、〜)
25. ている: action in progress and resulting state
26. てもいい / てはいけない: permission and prohibition
27. ないでください and the ない form
28. Dictionary form + ことができる
29. たことがある: experience
30. たり〜たりする: listing actions
31. Counters: つ, 人, 枚, 本, 冊, 回
32. から: because
33. が and けど: but
34. より and のほうが: comparison of two
35. いちばん and の中で: the most
36. もう and まだ
37. ね and よ: sentence-final particles
38. Time: 時, 分, 曜日, and when に is used
39. くなる / になる: becoming
40. 前に and てから / たあとで: before and after

### N4 — `n4`, "Level N4 · Everyday Japanese" (46 points)

1. Plain forms in casual speech (dictionary, ない, た, なかった)
2. と思う and と言う: thinking and quoting
3. Potential verbs (られる / える) and ことができる
4. Volitional form (よう / おう) and ようと思う
5. つもりだ and 予定だ: intentions and plans
6. ことにする and ことになる: decisions
7. ようになる and ようにする: change of ability and habit
8. ように: so that (purpose)
9. ために: in order to, for the sake of
10. と conditional: whenever, as soon as
11. ば conditional
12. たら conditional: if, when
13. なら: if it is the case that
14. ても / でも: even if
15. てしまう: completion and regret
16. ておく: doing in advance
17. てみる: trying out
18. てある: a state someone left on purpose
19. ていく and てくる
20. ながら: while doing
21. し: listing reasons
22. ので: because (soft)
23. のに: although, despite
24. そうだ (appearance): looks like
25. そうだ (hearsay): I hear that
26. ようだ and みたいだ: it seems
27. らしい: apparently
28. かもしれない
29. でしょう / だろう: probably
30. はずだ: should be, is expected to
31. なければならない / なくてはいけない
32. なくてもいい: need not
33. ほうがいい: advice
34. すぎる: too much
35. やすい and にくい: easy and hard to do
36. かどうか and question words + か in a sentence
37. あげる, くれる, もらう
38. てあげる, てくれる, てもらう
39. Passive (られる)
40. Causative (させる)
41. までに and まで
42. 間 and 間に
43. ところだ: about to, in the middle of, just did
44. たばかり: just did
45. の and こと: turning a clause into a noun
46. お〜になる and お〜する: first honorific and humble forms

### N3 — `n3`, "Level N3 · Connected speech" (57 points)

1. わけだ: that explains it
2. わけではない: it is not that
3. わけがない and はずがない: cannot be
4. ことになっている and ことにしている
5. ように言う / 頼む: indirect requests
6. させてください and させていただく
7. Causative passive (させられる)
8. 尊敬語 verbs (いらっしゃる, おっしゃる, 召し上がる, ご覧になる)
9. 謙譲語 verbs (参る, 申す, いたす, いただく, 拝見する)
10. として
11. について and に関して
12. によって: by, depending on
13. にとって
14. に対して
15. によると and によれば
16. たびに
17. うちに
18. 最中に
19. ところだった: nearly happened
20. おかげで and せいで
21. ため(に): because of
22. ばいい and たらいい: advice
23. Question word + ても: no matter
24. ば〜ほど: the more … the more
25. ほど and くらい: degree
26. こそ
27. さえ and さえ〜ば
28. なんか and なんて
29. ばかり: nothing but
30. てばかりいる
31. まま
32. ずに and ないで
33. 代わりに
34. ついでに
35. とおり(に)
36. っけ
37. って: quoting and topic in speech
38. とか: listing examples
39. わりに
40. 一方だ
41. ことはない
42. しかない
43. べきだ and べきではない
44. ようとする and ようとしない
45. かける and かけの
46. きる and きれない
47. 出す, 始める, 続ける, 終わる: compound verbs of phase
48. たとたん(に)
49. てからでないと
50. に違いない
51. とは限らない
52. くせに
53. ほど〜ない: not as … as
54. っぽい and らしい (typical of)
55. 気がする and 感じがする
56. ようだ as a comparison (まるで〜ようだ)
57. ことか and ものか in exclamations

### N2 — `n2`, "Level N2 · Nuance and attitude" (55 points)

1. あげく
2. 以上(は) and からには
3. うえ(に): on top of
4. うえで: when doing, after doing
5. おそれがある
6. かぎり: as long as, as far as
7. かねない
8. かねる
9. からこそ
10. からといって
11. 気味 and がち
12. きり and っきり
13. ことから
14. ことだ: advice
15. ことなく
16. ことに: emotion (残念なことに)
17. 際(に) and に際して
18. 次第: as soon as
19. 次第だ: depends on
20. 末(に)
21. ずにはいられない
22. せいか
23. だけあって and だけに
24. たところ
25. っこない
26. つつ and つつある
27. て以来
28. てしょうがない, てたまらない, てならない
29. というより
30. といっても
31. どころか
32. どころではない
33. ないことはない
34. ないことには
35. にあたって
36. に応じて
37. にかかわらず and を問わず
38. にかけては
39. に沿って and に基づいて
40. に反して
41. にほかならない
42. にわたって
43. のもとで
44. ばかりか
45. はともかく
46. 反面
47. ものだ: nature, nostalgia, advice
48. ものの
49. ものなら
50. わけにはいかない
51. をきっかけに
52. をはじめ and を中心に
53. をめぐって
54. 得る and 得ない
55. 向け and 向き

### N1 — `n1`, "Level N1 · Mastery" (60 points)

1. あっての
2. いかんで and いかんによらず
3. (よ)うが〜まいが
4. (よ)うにも〜ない
5. かたがた and がてら
6. かたわら
7. が早いか and や否や
8. きらいがある
9. 極まる and 極まりない
10. ごとき and ごとく
11. こととて
12. ことなしに and なくして(は)
13. 始末だ
14. ずくめ
15. ずにはおかない and ずにはすまない
16. すら and だに
17. そばから
18. たが最後
19. たところで
20. たりとも
21. たる
22. つ〜つ
23. であれ and であろうと
24. てやまない
25. と相まって
26. とあって and とあれば
27. といえども
28. といったらない
29. と思いきや
30. ときたら
31. ところを
32. とはいえ
33. とばかりに and んばかり
34. ともなると and ともなれば
35. ないまでも
36. ながらも
37. ならでは
38. なり: as soon as
39. なりに
40. にあって
41. に至って and に至るまで
42. にかこつけて
43. に即して
44. にたえない and にたえる
45. に足る
46. にひきかえ
47. にもまして
48. の至り and の極み
49. はおろか
50. べからず and べく
51. まじき
52. までもない and までだ
53. もさることながら
54. ものを
55. ゆえ(に)
56. をおいて
57. を皮切りに
58. を禁じ得ない
59. を余儀なくされる
60. をものともせず and んがため

## Size

N5 40, N4 46, N3 57, N2 55, N1 60 points: 258 points, about 260–280 lessons with splits. The pack
limit is 500 lessons.

## Tooling

`scripts/build-grammar-pack.mjs` gains a `--pack ja` option: the pack's levels (ids, names,
`jlpt-kanji` scheme levels, point counts as floors), its directories and its `COVERAGE.md` heading
and source paragraph come from a per-pack table. `--pack zh` (the default) keeps today's behaviour.

## Credits

`ja-grammar` manifest and `ATTRIBUTION.md`: written for qinqin, CC0 1.0; own selection and order,
not based on JLPT preparation books or published lists; the JLPT publishes no grammar list; levels
are estimates; not reviewed by a native speaker. `docs/sources.md` and `plugins/data/README.md` get
an entry; the notice test lists the pack.
