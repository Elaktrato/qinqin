# Look-alike character sets: review notes (#228)

`look-alikes-zh.json` (53 sets, 125 characters: 26 for both scripts, 16 simplified only, 11 traditional only) and
`look-alikes-ja.json` (56 sets, 132 characters: 17 kana sets, 2 kana/kanji sets, 37 kanji sets) were written for
qinqin and **reviewed by agents acting as native-speaker teachers, not yet by a person** (`humanReviewed: false`; the
`attribution` says so). Licence: CC BY 4.0 (`NOTICE`). The owner reviews them later (owner decision, 2026-11-26).

## How the sets were made

1. **Draft (the builder, 2026-11-28).** The classic confusions a teacher points out, by hand: 42 Chinese sets (the
   issue's 未/末, 己/已/巳, 人/入, 土/士, 日/曰, 鸟/乌, 天/夫 and others up to HSK 4), 25 Japanese kana and kana/kanji sets
   (ソ/ン, シ/ツ, ク/ケ/タ, ぬ/め …) and 38 kanji sets. Each character got a reading, a short meaning, an example word
   (with its gap checked against the other members) and per set a note and the strokes that make the difference.
   **Nothing was derived from a third-party list**: the KanjiVG component index is CC BY-SA 3.0 and only usable as its
   own pack, Unihan has no look-alike field for learners. Bopomofo was written by the server's own converter
   (`internal/pinyin`, checked by `server/internal/drills/lookalikes_contract_test.go`); every stroke count and every
   marked stroke was checked on a rendering of the Hanzi Writer stroke data with the stroke numbers drawn on it (the
   data the app draws for Chinese, and for Japanese where no KanjiVG strokes pack is installed), and the counts are
   pinned by `sets.test.ts`.
2. **Four teachers, independently** (`claude -p --effort high`, no tools), with every set, reading, meaning, example,
   gap, note and stroke number:
   - `zh-teacher-1`: Beijing, a university's international students' college, 15 years, HSK 1–6, simplified, 现代汉语词典.
   - `zh-teacher-2`: Taipei, a university's Mandarin Training Center, 12 years, TOCFL and HSK, traditional and simplified.
   - `ja-teacher-1`: Tokyo, a university's Japanese language centre, 15 years, JLPT N5–N1.
   - `ja-teacher-2`: Osaka, a 日本語学校, 12 years, beginners to N3, Genki / Minna no Nihongo, handwriting classes.
3. **Adjudicator** (`adjudicator`, the curriculum lead of a school teaching both languages), on the points the teachers
   disputed or left open: rare members, Taiwan readings, the kana/kanji pairs, and which new sets to add (with their
   data).
4. **Applied** by the builder, then a **final pass** by one teacher per language (`zh-teacher-1`, `ja-teacher-2`) on
   the revised files; their must-fix items were applied (below).

## Chinese: what the review changed

- **Ambiguous gaps fixed** (another member made a real word): 买 购买 (卖单 is a trading term), 卖 外卖, 買 購買; 冰 冰块
  (水箱); 毛 毛衣 (手巾); 田 田野 (甲地); 入 收入 (进人); 刀 菜刀 (剪力). 土豆 means peanut in Taiwan → 土地.
- **Notes:** 天/夫, 力, 牛 "pokes out above the top"; 太 "a dot between the legs"; 白 "nothing above the short
  left-falling stroke" (百 has it too); 自 "a short left-falling stroke"; 小/少 (the hook; the long stroke at the
  bottom); 老 匕; 特 牜; 问/间 "door (门)"; 往 "to go; towards"; 象 "elephant", 像 "to look like; likeness" (the
  meanings overlapped).
- **Highlights:** 今/令 only 令's dot (the fold is shared); 貝/見 only the last stroke; 小 its hooked vertical, 少 the
  vertical and the long stroke.
- **Rare members (adjudicator):** 巳 dropped (己/已 stays), 狠 dropped (很/恨), 日/曰 and 候/侯 dropped: a set joins as
  soon as any member is studied, so every beginner who studies 日 or 时候 would have met 曰 and 侯.
- **Added:** 永 to 冰/水; new sets 学/觉 (學/覺), 包/饱/跑/抱 (包/飽/跑/抱), 跟/根/眼/银 (跟/根/眼/銀), 东/车 (東/車),
  看/着, 妈/吗/码/马 (媽/嗎/碼/馬), 孩/该/刻 (孩/該/刻); the simplified-only examples lost their traditional spelling.
- **Final pass:** 包 and 马/馬 "nothing on the left" (both are radicals themselves), 入 "the right stroke is the long
  one" (人撇长、入捺长), 车/車 "no spreading strokes at the bottom", 鳥 "a stroke inside the top box".
- **Taiwan readings: not added** (adjudicator): the app's readings everywhere are the mainland standard (CC-CEDICT);
  Taiwan's full tones (眼睛 yǎnjīng, 事情 shìqíng …) wait for a licence-compatible source (the MOE dictionary is
  CC BY-ND). New examples avoid words whose reading differs.
- **Not applied:** `zh-teacher-1` gave 由's vertical as stroke 3; the stroke data the app draws (Hanzi Writer) writes it
  4th (checked on the rendering), and a mark indexes the data drawn. The proposed 左/右/石 has no 右 example whose gap
  左 cannot fill; 書/畫/晝 has a rare member; 话/活, 谁/准/推, 钱/线/浅, 厂/广, 万/方, a traditional 木/本 and 乌/马 are
  left for a later batch.

## Japanese: what the review changed

- **Kana:** シ/ツ and ソ/ン became one set シ/ツ/ソ/ン (learners mix all four); notes rewritten for コ/ユ (ユ is open on
  the left too), チ/テ, ヌ/ス, あ/お; ambiguous or awkward gaps: ウ ウイスキー (フール), ま まくら (ほど), ほ ほそい, ろ ろく
  (いる), き きもの, は はやい (ほな).
- **Kana/kanji pairs dropped** (both teachers, adjudicator): カ/力, ロ/口, エ/工, ニ/二, タ/夕, ハ/八 are one glyph at a
  size; a single character cannot be judged. オ/才 and the new チ/千 stay (their shapes differ), with 才's and 千's
  third stroke highlighted.
- **Rare members dropped:** 己/已/巳 (not jōyō), 日/曰, 候/侯, 烏 (Japanese writes カラス, ウーロン茶).
- **Merged and added:** 天/夫/失/矢 (the 2 × 2 of the top-left stroke and the long stroke above the top); 聞 to 問/間,
  時 to 待/持/特; new 東/束, 族/旅, 新/親.
- **Readings and examples:** 未 ミ only (いま(だ) is not jōyō), 末 バツ, 入 い(れる), 八 や(っつ), 天 あま, 干 ひ(る), 士
  "professional (as in 弁護士)"; 人 日本人 (大人 is a special reading), 見 意見, 今 今度 (令月), 鳥 焼き鳥 (小島), 手 手紙,
  時 時間 and 田 田んぼ (時計 and 田舎 are special readings); 象 12 and 像 14 strokes.
- **Notes and highlights:** 今/令, 貝/見 as for Chinese; 鳥/島 the dots and 山; 輸 "月 and a knife"; 緑/縁 their bottom
  parts.
- **Not applied:** the final pass asked to mark 田's and 由's vertical (stroke 3 in the Japanese order). The Chinese
  stroke data writes it 4th, and the app draws that data for Japanese wherever the KanjiVG strokes pack is not
  installed, so a mark would light the wrong stroke there; the note names the vertical instead. 甲/申 are marked (the
  same stroke in both orders). 孝, 腹, 録, 祈 and the sets 右/石, 若/苦, 開/閉, 使/便, 低/底, 祭/察/際, 姉/妹, 万/方 are
  left for a later batch (adjudicator: beyond about N3 or a rare member).

## Display (all four teachers)

Look-alikes must be set large, at a regular weight, in a face of the right script: the question shows the character
at 4–6 rem and the choices at 3.5 rem (56 px), weight 400, `font-synthesis: none`, with `lang` set to the workspace's
script (zh-Hans, zh-Hant, ja) so a device never falls back to another region's glyphs (令, 今, 骨). The answer draws the
members from the stroke data (the shapes the writing cards teach) when its stroke count matches the set's, else the
font's glyph. See the plan's Ruling on fonts.

The review prompts and the full answers were scratch files of this run; their content is summarised here.
