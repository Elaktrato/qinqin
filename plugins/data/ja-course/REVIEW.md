# Japanese course: review notes (#223)

`course.json` (the skeleton of 73 units and the 34 reading texts of ≈ N5–N4) was written for qinqin and **reviewed by
agents acting as native-speaker teachers, not yet by a person**; the manifest's attribution and notice say so. The
owner reviews and corrects it later, in use, as with the grammar lessons. Licence: CC BY 4.0 (`LICENSE`).

## How it was made

1. **Draft (the builder, 2026-11-28).** Sections and units, their themes (topic ids) and the placement of every
   `ja-grammar` lesson of the level; the units filled on a scratch server with the bundled `jlpt-words`, the Jiten
   frequency ranks, topic labels and JMdict; the kanji each unit introduces taken from the real fill (first use); one
   short text per unit of ≈ N5–N4, checked against the words reached at that point
   (`server/internal/courses/realdata_test.go`).
2. **Two teachers, independently** (`claude -p --effort high`, no tools), with the whole course: every unit's
   topics, grammar lessons, kanji and filled words, and every text with its translation and the check's new words:
   - `ja-teacher-1`: a native Japanese speaker from Tokyo, fifteen years teaching adults at a 日本語学校, JLPT N5–N3.
   - `ja-teacher-2`: a native Japanese speaker from Fukuoka who writes graded readers (多読用の読み物) for beginners
     and teaches at a university, strict about natural Japanese, register and kanji/kana choice.
3. **Adjudicator** (`ja-adjudicator`: the head of curriculum at a Japanese language school in Tokyo), who saw both
   reviews and the facts the builder checked (the fill cannot be moved by hand; grammar lessons stay in their level's
   section; the four-new-word rule) and decided every point.
4. **Applied** by the builder and checked again against the real fill (every text within four new words; one wording
   change after the check: 部長 → 上の人 in n4-work, to stay within four).

## What the review changed

- **Texts.** 31 of the 34 texts were revised: 30 bodies and 30 translations changed (n4-directions, n4-reasons and
  n4-moving were kept).
  - Grammar before its lesson was removed: the passive, ば/たら, hearsay そうだ/らしい and かどうか no longer appear
    before their units; ている and で in the first units were reworded.
  - Each text now shows at least one lesson of its own unit: ます and です (first units), ませんか/ましょう/てください
    (café), てもいい/てはいけない (school), から (weather), より/のほうが and もう/まだ (body), ことにする (plans),
    なければならない/なくてもいい (health), ておく/すぎる (home and meals), てくれる (relationships), そう/でしょう/
    かもしれない (sky and nature), のに (feelings), humble お〜する and てある (work), purpose ように (learning), the
    causative (rules), ようだ/みたいだ (news), 間/までに (family life), やすい/にくい (hobbies).
  - Naturalness: どうぞ before いただきます, 辞書で調べる, 頭がよく働く, 自転車の後ろ, 本屋ができる, 卒業した後,
    はい、おかげさまで; a client gets お客様 and 申し訳ありません; ごはん/晩ごはん, きれい and にぎやか in kana.
  - Translations: いただきます is "thank you for the food", ておく is "in advance", no added words.
- **Unit titles** (≈ N4, to match the words the fill gives them): n4-weekend "Time and timing", n4-skills "Actions",
  n4-health "Body and senses", n4-cooking "Home and meals", n4-gifts "Relationships", n4-weather "Sky and nature",
  n4-work "People at work", n4-school-life "Learning", n4-rules "Law and order", n4-moving "Coming and going",
  n4-questions "Greetings and thanks".
- **Grammar moves.** ≈ N5: masu → this-and-that; wo and to → family; counters → numbers-time; i-adjectives and
  ga-kedo → food. ≈ N4: no-koto → weekend. ≈ N3: sonkeigo → company; kenjougo → greetings; ni-yoru-to → media;
  tte → communication.
- **Not applied, and why.** Moving n4-plain-forms into ≈ N5, n5-mae-ato into ≈ N4 and n3-phase-verbs into ≈ N4:
  a lesson stays in its level's section (the grammar pack's levels); listed as follow-ups. Reordering n5-numbers-time
  before n5-family: not needed once counters moved. n4-tara to n4-health: ば/たら/なら are contrasted together in
  n4-if.

## Follow-ups

- **Grammar pack levels:** consider re-levelling n4-plain-forms to ≈ N5 (n5-kotogadekiru, n5-takotogaaru, n5-tari and
  n5-mae-ato need dictionary and た forms) and n3-phase-verbs to ≈ N4.
- **The estimated word list (#219)** comes from a subtitle/fiction corpus:
  - slang, vulgar and violent words at N5–N4 need a stoplist (あいつ/こいつ/そいつ, やがる, お前, 野郎, くそ, 殺す,
    地獄, 魔法, 鬼, 武器), as do written connectors at N5 (である/だが/しかし);
  - junk entries (寇する, あずさ, あし, てて, 翔る, 生ける, れる, てる, てよ, たる, ども, オーレ, でござる) and bound
    readings (下 もと, 内 ない, 上 じょう, 後 ご, 分 ぶん) should go;
  - core words arrive late: 日本, ください, 時, 分, 週末, まだ, みんな;
  - display forms: 綺麗 → きれい, 賑やか → にぎやか, 晩御飯 → 晩ごはん; 描く is read かく.
- **Topics:** several ≈ N4 units got words off their theme (crime and fantasy in rules, house parts in cooking, time
  adverbs in weekend); better topic labels would help, the titles were changed meanwhile.
- **Kanji balance:** n4-opinions introduces about 50 kanji and n4-questions 2; many ≈ N3 units introduce none,
  because the kanji come with the first unit whose words use them.
- **The checker and the reading lesson:** たり forms (聞いたり → り) and 泣きそう (泣き), humble お持ちします (お, 持ち) are not
  lemmatised; the reading lesson's segmenter also splits kana runs against the words (名前は|アン…, 妹|がい|ます).
  Reported for the reader.
- **≈ N3 texts:** when they are written, check the units before the moved sonkeigo, kenjougo, によると and って for
  early use.
