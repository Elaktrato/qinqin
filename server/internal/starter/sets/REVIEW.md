# Starter words: review notes (#275)

`starter-zh.json` (146 words) and `starter-ja.json` (145 words) were chosen for qinqin and **reviewed by agents
acting as native-speaker teachers, not yet by a person** (`humanReviewed: false`; the `attribution` says so). The owner
reviews them later, in use. Licence: CC BY 4.0 (`NOTICE`).

## How they were made

1. **Draft (the builder, 2026-11-28).** About 160 words per language across the course themes, kept only where the
   word resolves to a dictionary entry (CC-CEDICT, JMdict) **and** the picture the server serves for that entry is a
   good one. Every picture was looked at (OpenMoji black line drawings and Mulberry symbols rendered side by side);
   words were left out where the served picture is wrong (JMdict 牛 → Mulberry "beef", 頭 → "top", 虹 resolves to
   二次, コップ → broken glass), where two pictures look alike at the first stage (テーブル/机, 儿子/女儿), or where the
   first CC-CEDICT line is vulgar (鸟). No mapping row was added or changed: the mappings are the picture review's
   (#274), and a word without a good picture waits for it (see "Wanted" below).
2. **Two teachers per language, independently** (`claude -p --effort high`, no tools), with the list, each word's
   entry (key, readings, first gloss, "usually kana"), a description of its picture, and a pool of other words that
   already have pictures:
   - `zh-teacher-1`: a native Mandarin speaker from Beijing, fifteen years teaching adult beginners abroad (HSK 1–3),
     who writes the school's first-term vocabulary lists.
   - `zh-teacher-2`: a native Mandarin speaker from Chengdu who teaches children and adult beginners and makes
     picture-card (识字卡) materials.
   - `ja-teacher-1`: a native Japanese speaker from Tokyo, fifteen years teaching adults, JLPT N5–N3.
   - `ja-teacher-2`: a native Japanese speaker from Osaka at a 日本語学校, who makes picture-card (絵カード) materials
     for complete beginners.
3. **Adjudicator per language** (`zh-adjudicator`, `ja-adjudicator`: the curriculum lead of a language school), who saw
   both reviews and the facts the builder checked (which words have pictures, what the dictionary entries show) and
   decided every point either teacher raised, the additions, the order and the follow-ups.
4. **Applied** by the builder, then checked by the tests (`dictionaries_test.go`, `starter_test.go`).

## What the review changed

- **Order.** Both teachers asked to stop opening with animals: the lists now start with people and numbers, then
  school/classroom words, and keep look-alike pictures (car/taxi, tea/coffee, man/child, the buildings) and
  sound-alikes (鼻/花, 眼睛/眼镜) apart.
- **Chinese.** Dropped 狮子, 柠檬, 菠萝, 月饼, 啤酒 (children use the list too), 相机, 铅笔 (its picture is the pen's),
  报纸, 剪刀, 车站 (a train at a platform, like 火车), and 草 (its CC-CEDICT character entry carries the vulgar cào line,
  which pinning cǎo does not hide). Replaced 云 → 云彩 ("(classical) to say" was the first line), 钟 → 闹钟 (the picture is
  an alarm clock; no surname line), 桃 → 桃子, 邮局 → 洗手间; added 零. Pinned 猫 māo, 蛇 shé, 头 tóu, 脚 jiǎo,
  六 liù, 喝 hē. Kept 汉堡包 (汉堡's entry opens with "Hamburg"), 电视机 (电视 has no picture yet), 男人/女人.
- **Japanese.** Kana forms where textbooks use them and the word resolves to the same entry: うさぎ, さる, りんご, みかん,
  いちご, すいか, にんじん, おにぎり; 茄子 → じゃがいも, 警察官 → おまわりさん, 茶 → お茶 (Mulberry cup of tea; the
  handle-less teacup is mapped only to 茶), 男の子 → 子供, 葉 → 葉っぱ (は clashed with 歯). Dropped 桃, ビール, 女の子,
  桜 (its drawing is 花's), タクシー (the car with a roof sign), ホテル, 郵便局, 料理 (a fried egg). Added 財布,
  携帯電話. Glosses of 足 ("foot; leg") and 団子 corrected.
- **Not applied, and why.** The teachers also asked for kana rows for 熊, 象, 虎, 鼠, 蛇, 蝶, 椅子, 箸, 鍵, 眼鏡: as kana
  these resolve to another word (くま "corner", ちょう "just a minute") or to none, so the list keeps the kanji with the
  kana reading; the cards show the kana until the last stages anyway. Every word they wanted added that has no
  picture yet is under "Wanted".

## Wanted: words for the picture work (#274)

Chinese: 吃, 爸爸, 妈妈, 家 (the 家庭 family picture), 宝宝 (a real baby; the "baby symbol" reads as a toilet sign),
医生 (OpenMoji "health worker"), 蓝色 (the blue blot mapped to 蓝), 裤子, 睡觉, 电视 (the television picture of 电视机;
then 电视 replaces 电视机).
Japanese: 食べる, 書く, 寝る, 海 ("water wave"), ジュース, お母さん, お父さん, ズボン, 頭 (its only row is wrong),
お弁当 (the bento picture of 弁当), ボールペン, and a commuter train for 電車 (its only picture is a steam locomotive).
Better pictures: an empty plate for 皿 (the current one holds a fork), someone listening for 聞く (a cupped ear reads as
耳), the handle-less teacup for お茶, a T-shirt or outer shirt for シャツ.

## Follow-ups outside the lists

- **Child safety:** CC-CEDICT slang lines show on card backs and in every lookup (鸡, 鸭子 "prostitute", 黄色
  "pornographic", 草 cào). A sense filter is an app-wide decision; then 草 can return, pinned to cǎo.
- **Sense order of one-character Chinese cards:** surname, "abbr." and "variant of" lines come first (鱼, 牛, 马, 三, 水,
  雪, 花, 火, 门, 钱, 书 "abbr. for 書經", 蛇, 碗, 船). The everyday line should come first; a pinned reading should limit
  the lines shown.
- **Japanese sense order and "usually kana":** 肉 shows "flesh", 電話 "telephone call", シャツ "shirt (undergarment)"
  first; 目 and 山 (and perhaps 犬, 猫) are flagged "usually kana" by side senses, so their cards never reach the N5 kanji.
- **Resolution:** 虹 (にじ) resolves to 二次, whose search-only form is 虹, because the entry's priority wins over the
  plain form of 虹 (j:1463740). The word-and-reading rule should not let a search-only (`sK`) form win.

## Decisions in full

The adjudicators' decisions on every point the teachers raised (row numbers are those of the reviewed draft; the
teachers' own notes are summarised in the reasons).

### Chinese: decisions

| Row (draft) | Word | Raised by | Decision | Reason | Applied |
|---|---|---|---|---|---|
| 2 | 猫 | 1, 2 | change reading māo, gloss cat | Confirmed: pin māo, since máo only occurs in 猫腰; the pin is recorded and checked, and the extra line on the card back goes to the follow-ups. | yes |
| 3 | 鱼 | 2 | keep | The problem is real, but a one-character card shows every CC-CEDICT line in file order and no pictured two-character swap exists, so 'fish' stays and the 'surname Yu first' issue goes to the dictionary follow-up. | yes |
| 4 | 牛 | 2 | keep | The 'surname Niu first' problem cannot be fixed on the card in this change, so it goes to the follow-up; the word is essential and is the base of 牛奶. | yes |
| 5 | 马 | 2 | keep | Agreed that 'surname Ma' first is the most misleading of the surname cases, but there is no pictured alternative, so the word stays and the sense order is reported as a follow-up. | yes |
| 7 | 鸡 | 2 | keep | The '(slang) prostitute' line shows on this card and in every lookup in the app, so dropping one starter card would not make the app child-safe; 鸡 is core (鸡蛋), and the fix is an app-wide sense filter, reported as a top-priority follow-up. | yes |
| 8 | 鸭子 | 2 | keep | Same as 鸡: the slang line cannot be hidden per card, so the word stays and the app-wide child-safe sense filter is reported as a follow-up. | yes |
| 15 | 狮子 | 1 | drop | Confirmed: animals are the largest group, and lion is the least needed big cat next to 老虎. | yes |
| 16 | 蝴蝶 | 1 | keep | Overruled: the list also serves children, the picture is distinctive and not another zoo mammal, and the words the slot was meant for (吃, 爸爸, 妈妈) have no picture yet. | yes |
| 17 | 蛇 | 1, 2 | change reading shé, gloss snake | Confirmed: pin shé; the 'variant of 蛇[she2]' line will still show until the dictionary follow-up is done. | yes |
| 24 | 桃 | 2 | change → 桃子 táozi | Accepted: 桃子 is the spoken form beginners are taught, it matches 橙子, and the builder confirmed it has the peach picture. | yes |
| 26 | 柠檬 | 1, 2 | drop | Confirmed: fruit is over-represented, and lemon is the least needed fruit and looks like 橙子 and 梨 at the picture stage. | yes |
| 27 | 菠萝 | 1 | drop | Accepted: fruit is over-represented and 菠萝/凤梨 regional variation is a needless early complication (zh-teacher-2 also named it as the next candidate to drop). | yes |
| 44 | 汉堡包 | 1 | keep | Overruled: 汉堡 has no picture, and its entry opens with 'Hamburg (German city)', while 汉堡包 is correct, understood everywhere and has the picture. | yes |
| 45 | 月饼 | 1 | drop | Accepted: it is seasonal and belongs in a Mid-Autumn festival unit, not in the first weeks (zh-teacher-2 also named it as a candidate). | yes |
| 46 | 水 | 2 | keep | Agreed that pinning shuǐ cannot separate it from the shui3 surname line; the word is essential, so the sense order goes to the dictionary follow-up. | yes |
| 48 | 咖啡 | 1 | keep | The 'hot beverage' mug with steam and handle differs from the handleless teacup of 茶, so the word stays, but 茶 and 咖啡 are kept apart in the order as a precaution. | yes |
| 50 | 啤酒 | 2 | drop | Accepted: the list is also used with children, and the slot is better spent on 零; adults will meet 啤酒 in the first food-and-drink unit. | yes |
| 52 | 碗 | 1, 2 | keep | Agreed that the 'variant of' line is a problem, but it cannot be fixed on the card here, so it goes to the follow-up; the bowl is separated from 米饭 and 面条 in the order. | yes |
| 60 | 头 | 1, 2 | change reading tóu, gloss head | Confirmed: pin tóu, because neutral-tone tou is the suffix in 石头 and 木头, not 'head'. | yes |
| 61 | 脚 | 1, 2 | change reading jiǎo, gloss foot | Confirmed: pin jiǎo, since jué is a literary or opera reading. | yes |
| 64 | 男人 | 2 | keep | Overruled: 爸爸 has no picture yet, so dropping 男人 would only empty the people group; 男孩 is moved well away to deal with the look-alike drawings. | yes |
| 65 | 女人 | 2 | keep | Overruled for the same reason as 男人: 妈妈 cannot be added yet, and 女孩 is moved away from 女人 in the order. | yes |
| 74 | 三 | 1, 2 | keep | Both teachers are right that 'surname San' first is misleading, but the dictionary cannot be reordered in this change and 三 is indispensable, so the problem goes to the follow-up. | yes |
| 77 | 六 | 1, 2 | change reading liù, gloss six | Confirmed: pin liù, since lù only occurs in place names such as 六安. | yes |
| 83 | 黄色 | 2 | keep | The 'pornographic' line is app-wide and the single character 黄 carries the same sense plus 'surname Huang', so 黄色 stays, matching 红色/绿色, and the sense filter goes to the follow-up. | yes |
| 90 | 云 | 1, 2 | replace → 云彩 yúncai | The '(classical) to say' line cannot be demoted on a one-character card, and 云彩 has the same cloud picture and a clean 'cloud' entry; it is kept apart from 雨 in the order. | yes |
| 92 | 雪 | 2 | keep | The word is essential and has no pictured two-character alternative, so the 'surname Xue first' problem goes to the dictionary follow-up. | yes |
| 93 | 花 | 2 | keep | The word is essential and has no pictured two-character alternative, so the 'surname Hua first' problem goes to the dictionary follow-up. | yes |
| 95 | 草 | 1, 2 | drop | Both teachers require that the vulgar cào line never be shown, but pinning cǎo does not hide it from the card back, so grass leaves the starter list until the follow-up hides that line (then re-add it pinned to cǎo). | yes |
| 96 | 火 | 2 | keep | The word is essential (and the base of 火车), so the 'surname Huo first' problem goes to the dictionary follow-up. | yes |
| 101 | 门 | 2 | keep | The word is essential and has no pictured alternative, so the 'surname Men first' problem goes to the dictionary follow-up. | yes |
| 108 | 钟 | 2 | replace → 闹钟 nàozhōng | Accepted: the picture is an alarm clock, 闹钟 has that same picture and a clean entry, and this removes the 'surname Zhong' card. | yes |
| 109 | 电视机 | 1, 2 | keep | Overruled for now: both teachers prefer 电视, but only 电视机 has the television picture, so 电视 goes on the wanted list. | yes |
| 113 | 相机 | 1, 2 | drop | Confirmed: not a first-weeks word, and phones have taken its place. | yes |
| 114 | 书 | 1, 2 | keep | The 'abbr. for 書經' line is badly misleading, but the dictionary cannot be reordered in this change and 书 is indispensable, so it is the top item in the sense-order follow-up. | yes |
| 117 | 铅笔 | 2 | drop | Accepted: the pen and pencil drawings are near-identical, 笔 already covers 'pen, pencil', and 铅笔 is easy later as a compound. | yes |
| 118 | 报纸 | 1, 2 | drop | Confirmed: a newspaper is dated and not a first-weeks need. | yes |
| 122 | 钱 | 2 | keep | The word is essential, so the 'surname Qian first' problem goes to the dictionary follow-up; the card moves next to 银行. | yes |
| 124 | 剪刀 | 1 | drop | Accepted: not first-weeks vocabulary, and home and things is the largest group. | yes |
| 129 | 衬衫 | 2 | keep | Overruled: 裤子 has no picture yet, and the Mulberry button-up shirt and the OpenMoji coat come from different sets and read differently; they are kept apart in the order. | yes |
| 138 | 地铁 | 1 | change reading dìtiě, gloss subway, metro | Accepted: 'subway, metro' is the natural gloss. | yes |
| 141 | 船 | 1, 2 | keep | The 'variant of 船' line cannot be fixed on the card in this change and the word has no pictured alternative, so the problem goes to the follow-up. | yes |
| 145 | 酒店 | 1, 2 | keep | The builder checked that the hotel drawing says 'HOTEL' and the hospital drawing has a cross, so the feared H/H confusion does not exist and hotel is a real first-trip word. | yes |
| 146 | 邮局 | 1, 2 | replace → 洗手间 xǐshǒujiān | Confirmed: 洗手间在哪儿 is a day-one need, the toilet picture exists and is unambiguous, and the post office is dated and looks like the other buildings. | yes |
| 147 | 车站 | 1 | drop | Accepted: the builder confirmed the picture is a train at a platform, which cannot be told from 火车 and 地铁 at the picture stage. | yes |
| 151 | 喝 | 1, 2 | change reading hē, gloss to drink | Confirmed: pin hē, since hè 'to shout' is not the word taught here. | yes |

Added: 零 (zero).

Wanted (no picture yet, for the picture work): 吃 (to eat): a person eating from a bowl with chopsticks (clearly different from the 喝 drinking picture); 爸爸 (dad, father): a man holding or carrying a small child, clearly distinct from the 男人 drawing; 妈妈 (mum, mother): a woman holding a baby or small child, clearly distinct from the 女人 drawing; 家 (home, family): a family of parents and child (the existing 家庭 'family' picture could be mapped to 家), or a family inside a house; 宝宝 (baby): an actual baby; the existing 'baby symbol' is the baby-changing-room sign and would read as a toilet sign next to 洗手间; 医生 (doctor): OpenMoji 'health worker' (person with stethoscope); 蓝色 (blue): a blue paint blot with a paint tube in the same Mulberry style as the other colours (the existing blue blot used for 蓝 could be mapped to 蓝色); 裤子 (trousers): a pair of long trousers; 睡觉 (to sleep): a person asleep in bed with 'zzz', distinct from the empty 床 bed; 电视 (television): the existing OpenMoji 'television' (then 电视 replaces 电视机)

Follow-ups the adjudicator raised:

- Child safety, highest priority: CC-CEDICT slang and vulgar lines appear on card backs and in every dictionary lookup: 鸡 and 鸭子 '(slang) (male) prostitute', 黄色 'pornographic', 黄 'pornographic', and the cào 'variant of 肏' line of 草. An app-wide sense filter is needed, at least for children's profiles. Once the cào line is hidden, re-add 草 pinned to cǎo.
- Sense order on one-character cards: capitalised surname lines, 'abbr.' lines and 'variant of' lines show before the everyday meaning on 鱼, 牛, 马, 三, 水, 雪, 花, 火, 门, 钱, 书 ('abbr. for 書經'), 蛇, 碗 and 船, and also on 蓝 and 黄. The common lowercase line should come first, and surname and variant lines should be demoted. Pinning a reading does not help when the surname line has the same reading (水 shui3, 书 shu1).
- Pinned readings (猫 māo, 蛇 shé, 头 tóu, 脚 jiǎo, 六 liù, 喝 hē) are recorded and checked, but the card back still lists the other readings' lines (máo, yí, tou, jué, lù, hè). The back should show only the pinned reading's lines.
- Picture work for the wanted list: map the existing television picture to 电视, the Mulberry blue blot to 蓝色 and the 家庭 family picture to 家; draw 吃, 爸爸, 妈妈, 睡觉, 裤子 and a real baby for 宝宝; use OpenMoji 'health worker' for 医生. After that, swap 电视 for 电视机.
- 汉堡's entry opens with 'Hamburg (German city)'. If 汉堡 is ever taught for 'hamburger', its sense order must be fixed first; until then 汉堡包 stays.
- Shared pictures elsewhere in the course: after the 闹钟 swap, make sure 钟 no longer uses the alarm-clock picture. Guard the pool pairs 口/嘴, 牙齿/牙, 公共汽车/公交车, 站/车站 and 冰激凌/冰淇淋 so the same picture never stands for two words in one deck.
- Check the OpenMoji man/boy and woman/girl drawings side by side; if they are as alike as zh-teacher-2 says, the picture work should give 男孩/女孩 child-proportioned drawings.

### Japanese: decisions

| Row (draft) | Word | Raised by | Decision | Reason | Applied |
|---|---|---|---|---|---|
| 7 | 兎 | 1, 2 | change → うさぎ | Confirmed: 兎 is not jōyō and every beginners' book and picture book writes うさぎ. | yes |
| 8 | 猿 | 1 | change → さる | Textbooks write さる and JMdict marks it usually kana, so the list should show the kana form. | yes |
| 9 | 熊 | 1 | change → くま | Beginners' materials write くま, and without the kana form the card would end on a kanji far beyond this level; keep the match to j:1246850, not 隈. | kept 熊 (くま): the kana row resolves to くま "corner" (j:2131810) |
| 10 | 象 | 1 | change → ぞう | Learners meet 象 much later and mostly in 印象/気象, so ぞう is the right beginner form; keep the match to j:1351830, not 像. | kept 象 (ぞう): the kana row resolves to no entry |
| 11 | 虎 | 1 | change → とら | 虎 is a late kanji, and children's and beginners' materials write とら. | kept 虎 (とら): the kana row resolves to no entry |
| 12 | 鼠 | 1, 2 | change → ねずみ | Confirmed: nobody writes 鼠 for beginners, and ねずみ covers the rat picture too. | kept 鼠 (ねずみ): the kana row resolves to no entry |
| 13 | 蛇 | 1 | change → へび | Beginners have no use for the kanji 蛇, and textbooks write へび. | kept 蛇 (へび): the kana row resolves to no entry |
| 16 | 蝶 | 1, 2 | change → ちょう | Confirmed: 蝶 is not jōyō, and ちょう is the standard dictionary form for learners. | kept 蝶 (ちょう): the kana row resolves to ちょう "just a minute" (j:2449460) |
| 17 | 林檎 | 1, 2 | change → りんご | Confirmed: textbooks, menus and shops all write りんご. | yes |
| 18 | 蜜柑 | 1, 2 | change → みかん | Confirmed: it is always みかん in teaching materials and daily life. | yes |
| 20 | 苺 | 1, 2 | change → いちご | Confirmed: 苺 is not jōyō, and beginners see いちご. | yes |
| 21 | 桃 | 1 | drop | As a line drawing it is a third round fruit beside りんご and みかん, it is the least needed of the three, and the emoji's slang use is a real problem with adult learners. | yes |
| 22 | 西瓜 | 1, 2 | change → すいか | Confirmed: 西瓜 is a jukujikun puzzle, and すいか is the standard form. | yes |
| 25 | 人参 | 1, 2 | change → にんじん | Confirmed: supermarkets and textbooks write にんじん, and the kanji also suggests ginseng. | yes |
| 26 | 茄子 | 1, 2 | replace → じゃがいも | Rather than respelling it なす, replace it: potato is the more basic vegetable (カレー, 肉じゃが), the eggplant emoji has a slang meaning, and the kana form resolves to じゃが芋 with the OpenMoji potato. | yes |
| 30 | お握り | 1, 2 | change → おにぎり | Confirmed: お握り is almost never written, and おにぎり is universal. | yes |
| 31 | 弁当 | 1, 2 | keep | Overruled for now: お弁当 is the better teaching form, but only the 弁当 entry has the bento picture, so お弁当 goes to 'wanted' and a picture remap is a follow-up. | yes |
| 38 | 肉 | 1, 2 | keep | The word and picture are right; showing 'meat' before 'flesh' is a sense-order fix that the builder cannot make in this change, so it is listed as a follow-up. | yes |
| 43 | 団子 | 1, 2 | change reading だんご, gloss dango (sweet rice dumplings on a skewer) | Keep it with teacher 1's gloss: the picture is distinct and collides with nothing, children like it, and the proposed replacement 頭 has no picture. | yes |
| 45 | 茶 | 1, 2 | replace → お茶 おちゃ | Bare ちゃ is the wrong word to teach, so accept お茶 even though only the Mulberry cup of tea is available; keep it in a different session from コーヒー until the handle-less teacup is remapped (follow-up). | yes |
| 48 | ビール | 2 | drop | Children use this section too, so an alcohol word does not belong in section 0; ジュース has no picture yet and goes to 'wanted'. | yes |
| 49 | 皿 | 1, 2 | keep | Both teachers are right that the picture is weak, but it is the only plate picture, so keep 皿 and schedule it in a different session from フォーク. | yes |
| 50 | 箸 | 1 | change → はし | Beginners' textbooks write はし, and 箸 is a late kanji; keep the match fixed to j:1476410, not 橋 or 端. | kept 箸 (はし): the kana row resolves to no entry |
| 54 | 目 | 1, 2 | keep | The card should reach the N5 kanji 目, but the 'usually kana' flag cannot be overridden in this change, so it is a follow-up. | yes |
| 59 | 足 | 1 | change reading あし, gloss foot; leg | あし covers the whole leg, and learners should know that from the first card. | yes |
| 60 | 男の子 | 1 | replace → 子供 こども | 子供 is the more basic N5 word and needs only one child picture, which removes the boy/man and girl/woman look-alike pairs at the picture stage. | yes |
| 61 | 女の子 | 1 | drop | Its face picture is nearly identical to 女の人, 子供 now covers the child picture, and 男の子/女の子 can come later in the course. | yes |
| 68 | 警察官 | 1 | change → おまわりさん | おまわりさん is the word beginners actually hear and use, and in kana it resolves to お巡りさん with the same police-officer picture. | yes |
| 92 | 山 | 1, 2 | keep | As with 目, the card should reach 山, but the flag override is outside this change and is listed as a follow-up. | yes |
| 95 | 葉 | 1, 2 | change → 葉っぱ はっぱ | Teacher 2's fix is better than dropping the word: はっぱ is what learners say, it removes the は/歯 clash, and it keeps the Mulberry leaf picture. | yes |
| 97 | 桜 | 1, 2 | drop | Confirmed: in line drawings it cannot be told apart from 花; 海 has no picture yet and goes to 'wanted'. | yes |
| 102 | 椅子 | 1, 2 | change → いす | Confirmed: beginners' textbooks write いす, and 椅 is rarely written. | kept 椅子 (いす): the kana row resolves to no entry |
| 106 | 鍵 | 1, 2 | change → かぎ | Confirmed: textbooks write かぎ, and 鍵 is a 17-stroke late kanji. | kept 鍵 (かぎ): the kana row resolves to no entry |
| 109 | 眼鏡 | 1, 2 | change → めがね | Confirmed: in practice it is めがね/メガネ, and 眼鏡 is an irregular reading. | kept 眼鏡 (めがね): the kana row resolves to no entry |
| 113 | ペン | 2 | keep | ボールペン is the better classroom word but has no picture yet, so it goes to 'wanted' and ペン stays for now, scheduled apart from 鉛筆. | yes |
| 115 | 電話 | 1 | keep | The word and picture are right; showing 'telephone' before 'telephone call' is a sense-order follow-up. | yes |
| 118 | ギター | 2 | keep | It is not core, but it is an easy katakana loanword with a distinct picture, and the proposed replacement 寝る has no picture yet (see 'wanted'). | yes |
| 127 | シャツ | 1, 2 | keep | No T-shirt picture exists, and putting the outer-garment sense first is a sense-order follow-up the builder cannot make now. | yes |
| 132 | タクシー | 2 | drop | In line drawings it is the 車 picture plus a small roof sign, so the two cannot be told apart at the picture stage; 車 is the basic word. | yes |
| 133 | 電車 | 1, 2 | keep | 電車 is too important to drop, and its only picture is the locomotive, so keep it now and list a commuter-train picture under 'wanted' and as a follow-up. | yes |
| 140 | ホテル | 1, 2 | drop | Confirmed: it is the least needed of the look-alike building pictures and the closest to 病院. | yes |
| 143 | 郵便局 | 2 | drop | Its picture depends on the 〒 mark that foreign beginners do not know, it adds to the building look-alikes, and it is a long word for week one. | yes |
| 150 | 聞く | 1, 2 | keep | No listening picture exists, so keep it but teach it next to 音楽 and in a different session from 耳; a better picture is a follow-up. | yes |
| 151 | 料理 | 1, 2 | drop | Confirmed: the fried-egg-in-a-pan picture reads as たまご, and 料理 is a noun among the verbs; 食べる has no picture yet and goes to 'wanted'. | yes |

Added: 財布 (wallet); 携帯電話 (mobile phone).

Wanted (no picture yet, for the picture work): 食べる (to eat): A person eating from a bowl with chopsticks.; 書く (to write): A person or hand writing on paper, without a separate pen object that could be read as ペン.; 寝る (to sleep): A sleeping person with 'Zzz', not just a bed, so it does not clash with ベッド.; 海 (sea): Sea waves (e.g. OpenMoji 'water wave'), clearly different from the 水 droplet.; ジュース (juice): A glass with a straw and a fruit slice, clearly different from the glass of milk.; お母さん (mother): A mother with a child, distinct from 女の人 and from the 家族 picture.; お父さん (father): A father with a child, distinct from 男の人 and from the 家族 picture.; ズボン (trousers): A pair of trousers (e.g. OpenMoji 'jeans').; 頭 (head): A head with the whole head highlighted; this replaces the current wrong mapping.; お弁当 (boxed lunch): The existing OpenMoji 'bento box', mapped to the お弁当 entry.; ボールペン (ballpoint pen): A ballpoint pen (the current OpenMoji pen could be remapped), clearly different from the pencil.; 電車 (train): A modern electric commuter train (OpenMoji 'train', 'metro' or 'tram car'), checked against the 駅 picture.

Follow-ups the adjudicator raised:

- Sense order on the card back: show 'meat' first for 肉 (j:1463520), 'telephone' for 電話 (j:1443840), and the general outer-garment 'shirt' sense for シャツ (j:1061520).
- Override the JMdict 'usually written in kana' flag for the main sense of 目 (j:1604890) and 山 (j:1302680) so the cards reach the kanji. Review 犬 and 猫 the same way (textbooks write them in kanji); 帽子 can be decided later.
- Picture remaps: the OpenMoji 'teacup without handle' to お茶 (so it no longer looks like the coffee cup), 'bento box' to お弁当, 'train'/'metro' to 電車, and a correct picture for 頭.
  - Done on merge with #274: お茶 now uses the OpenMoji 'teacup without handle' (1F375) and 手紙 the OpenMoji envelope (2709). The #274 picture review removed both Mulberry pictures.
- New pictures needed: a plain empty plate for 皿 (without the fork), a person listening with headphones for 聞く, and a T-shirt or outer shirt for シャツ.
- Confirm the kana forms resolve to the intended entries: くま→j:1246850 (not 隈), ぞう→j:1351830 (not 像), はし→j:1476410 (not 橋/端), かぎ→j:1260490, さる→j:1177390, おまわりさん→お巡りさん, じゃがいも→じゃが芋.
- Check that j:2796520 is the main ビール entry before the word is used later in the course.
- Check that the bear and panda line drawings are distinct enough. If 男の子/女の子 return later, they need pictures clearly different from 男の人/女の人, and 子供 should not be paired with a 'boy' picture.
- Teacher notes: in speech, learners will mostly hear おさら, おはし and おみず, so add these polite forms to the audio or example sentences in later sections.

