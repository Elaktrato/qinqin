# Graded readers: review notes (#231)

`zh.json` (20 texts, ≈ HSK 1–4) and `ja.json` (15 texts, ≈ N5–N3), five per level, were written for qinqin and
**reviewed by agents acting as native-speaker teachers, not yet by a person**; each file's `attribution` says so and
`humanReviewed` stays `false` until the owner has read them. Licence: CC BY 4.0 (`NOTICE`). Plan:
`docs/superpowers/plans/2026-11-28-231-graded-readers.md`.

## How they were made

1. **Draft (the builder, 2026-11-28).** Five texts a level, mixing stories, dialogues and informational texts, each
   drafted against the level's word list (`hsk-words`, `jlpt-words`) and tuned with the level check
   (`../level_test.go`: the server's segmenter on the shipped dictionaries, the level rule of
   `docs/contracts/graded/`) until every text's computed level was its declared level.
2. **Two teachers per language, independently** (`claude -p --effort high`, no tools), with every text, its names,
   glosses and the check's result, asked for naturalness, level fit, coherence and accuracy, and the glosses:
   - `zh-teacher-1`: a native Mandarin speaker from Beijing, fifteen years teaching adult beginners abroad (HSK 1–3),
     who designs her school's first-year curriculum and writes its reading materials.
   - `zh-teacher-2`: a native Mandarin speaker from Shanghai who teaches at a university language centre and writes
     graded readers (分级读物) for HSK 2–5; strict about idiom, measure words, 了 and 的/地/得, register and accuracy.
   - `ja-teacher-1`: a native Japanese speaker from Tokyo, fifteen years at a Japanese language school from beginners
     to N3, who writes the school's extensive-reading (多読) materials.
   - `ja-teacher-2`: a native Japanese speaker from Osaka (teaching standard Japanese) in a university programme, who
     has written leveled readers for N5–N2; strict about particles, counters, word choice and cultural accuracy.
3. **An adjudicator per language** (the curriculum lead of a Chinese school in Beijing; the head of studies of a
   Japanese school in Tokyo), who saw both reviews and the check and decided every finding.
4. **Applied** by the builder and checked again (both the always-on check and the seeded-database one). Where an
   adjudicated wording put a text above its level, the builder adapted it (below).

## What the review changed

**Chinese** (19 of 20 bodies changed; 我的家 kept as drafted; no title changed):
- Natural spoken forms: 是啊, 不行 (a vendor's refusal, glossed), 还要什么, 那怎么走, 你汉语说得真好, 哪里哪里，我还在学呢,
  运动对身体好, 跑完步, 搬上了车, 八楼, 其实很会爬树, 忘在地铁上, 我帮您查一下, 让她过一个快乐的生日.
- Measure words and V了 objects: 喝了一杯牛奶 (杯 glossed), 一碗面条 (碗 glossed), 一块很漂亮的手表.
- One word per place: 饭馆 for a restaurant (glossed at HSK 1), 食堂 on campus (glossed), 餐厅 in the hotel; 饭店 no
  longer appears.
- Accuracy: pandas' black eye patches and shoulders (周围, 肩膀 glossed) and their home in Sichuan; tea's history
  "two thousand years and more", the regions of each tea and the finger-tap custom of Guangdong; the subway text is
  about big cities, the doors' side, and the QR-code ticket; the rubbish text names the four kinds and says that each
  bin has its colour; the ticket text: a changed ticket cannot be changed again, pets may not go into the carriage.
- Logic: a mistaken watch reference, the doctor's advice to a screen worker (少看…多运动), an umbrella loss told in
  order, a hotel's own shuttle and the luggage sent up, a full name for an adult's self-introduction (张文文).
- Kinds: "我的大学" is a story (a first-person account), so HSK 1 has no informational text; the next batch should add
  one (the adjudicator's note).

**Japanese** (all 15 bodies changed; no title changed):
- Natural forms: どこから来ましたか, 昼ご飯は近くの店で、会社の人と食べます, 喫茶店でお茶, 三冊 (冊 glossed), 辛かった in
  kanji (からかった was a homograph of からかう), 父と母に (家族に was illogical), 店や銀行や郵便局, 水をたくさん, 一日三回,
  相談した, 何人か, 〜んですか, こともあった, どのパンのことか分からなくて, ことにしたんだ, 候補が二つ, 道が暗くないか.
- Accuracy: phone calls on trains are etiquette, not a rule (話さないのがマナーです); a yukata is thin and cool, not
  "light"; festivals pray that illness and bad things stay away; konbini lend toilets and tap water to people walking
  home after a disaster; konbini sell books.
- Sequence and register: the cooking text grills the fish and forgets it while making soup; the letter ends with
  「ゆいより」 on its own line; ご飯 is spelled one way across the set; a full-width space after ？／！ mid-line.
- Glosses are exactly the words the check finds above the level (the adjudicator's policy).

## Adapted to the level check after the adjudication

The builder changed these adjudicated wordings because the check put them above the level; each keeps the reviewers'
point where the level allows:
- Chinese: 我家在学校后边 (就 is HSK 2), 我和小猫玩 (一起 is HSK 2), 我们回家了 and 我给妈妈打电话 at HSK 1 (就; 打了 splits as
  打 alone), 两块，可以吗 (行 alone is no HSK 1 word), 还要什么 (别的), 回家了还要上网 and 你要少看电脑和手机 (以后 is HSK 3),
  the subway's 票可以在车站买，也可以在手机上买, 你再上车 and 爷爷奶奶 (用, 先, 老人 are HSK 3), 在一个学校 (同一),
  去城市北边的山 (城, 座), 也在饭馆工作过 (打工 reads as 打｜过｜工), 我想换一下我的火车票 (改签 above HSK 4) and 您想换后天几点的,
  每种垃圾桶都有自己的颜色 (蓝色 and 灰色 are not in the list).
- Japanese: 十一時に寝ます (ごろ is ≈ N4), 肉のパン (カレーパン reads as カレ｜ーパン), ありがとうございます (ございました is
  ≈ N4 and the text had its two glossed words), 川の近くの木がとてもきれいです (赤, 黄色 are not ≈ N5 words), 電車の中にとても多くの
  人がいます (混む is ≈ N1 in the estimate), 体の悪い人のための席 (お年寄り reads as お｜年寄り), おととい glossed again and one
  のど dropped (the doctor text fell below 95 % on the shipped dictionary without the frequency pack).

## Findings for others

- The estimated JLPT list (#219) puts core N5 words late or nowhere: 時, 分, ください, 人気, 大好き, 日本, いらっしゃいませ,
  そう, ありがとうございました (≈ N4) — the texts gloss them; the adjudicator asks for them at ≈ N5.
- The HSK list keeps one membership per entry at its lowest level, so a character that is also a listed word at a
  higher level (先 at HSK 3, derived at HSK 1 from 先生) has no direct membership; the level check reads the list file
  as well (`listedForms`). 没 (alone) and measure words such as 杯 are in no HSK level.
- Segmenter: Japanese kana runs still split against the words (わたしも｜すし → もす｜しが, 食べに → 食｜べに, のあと → のあ｜と,
  カレーパン → カレ｜ーパン, インターネット → イン…); Chinese keeps some unlisted compounds whole (早点儿, 穿着, 换成, 学会, 走出).
  The level check reads such runs again with the lowest-level reading; the reader shows the segmenter's reading.
