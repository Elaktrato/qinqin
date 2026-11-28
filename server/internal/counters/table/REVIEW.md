# Counters and measure words: review notes (#179)

`counters-ja.json` (32 counters, 161 nouns, the readings of number + counter in
`docs/contracts/counters/readings.json`) and `measures-zh.json` (corrections to the measure words derived from
CC-CEDICT's `CL:` notes) were written for qinqin and **reviewed by agents acting as native-speaker teachers, not yet
by a person** (`humanReviewed: false`; the `attribution` says so). Licence: CC BY 4.0 (`NOTICE`). The Chinese measure
words themselves come from CC-CEDICT at run time and keep its licence (CC BY-SA 4.0).

## Japanese: how the table was made

1. **Draft (the builder, 2026-11-28).** 28 counters a beginner to intermediate learner meets (N5–N3), what each counts,
   its sound class, the numbers asked (1–10 and 何, plus 20 for 歳 and 日, 14 and 24 for 日, 11 and 12 for 時 and 月),
   the irregular readings (一人 ひとり, 二十日 はつか, 四時 よじ …), and 102 example nouns. No commercial list was
   copied; JMdict gives no counter per noun (owner, 2026-11-26).
2. **Two teachers, independently** (`claude -p --effort high`, no tools), with the counters, the nouns and the whole
   generated readings matrix (canonical / accepted / the wrong options):
   - `ja-teacher-1`: a native speaker from Tokyo, 15+ years teaching adults (beginners to N2) at a university language
     centre, author of the school's counters handout.
   - `ja-teacher-2`: a native speaker from Osaka, 15+ years at a 日本語学校, JLPT N5–N3, strict about Genki, Minna no
     Nihongo, Marugoto and NHK norms.
3. **Adjudicator** (`ja-adjudicator`, the curriculum lead of a language school), who saw both reviews and decided
   every point (adopt, adopt with a change, reject) into one change list, with a rule for each reading: accepted,
   neither (not accepted when typed but never shown as wrong), or a wrong option (clearly wrong to any teacher).
4. **Applied** by the builder (the general rules in `readings.go`, the rest in the table), then checked by the tests
   (`readings_test.go`, the web `check.test.ts` over the whole matrix).

## Japanese: what the review changed

- **Accepted now:** every はち + plain counter for 8 (はちほん, はちさつ, はちしゅうかん …; はっ stays canonical); the
  unvoiced 3/何 of 軒 and 足 (さんけん, なんそく), as for 階; 9時間 きゅうじかん, 7分 しちふん, 6か月 ろくかげつ. The
  rules: a counter voiced after 3 and 何 also accepts the unvoiced form; a geminated 8 also accepts はち.
- **Wrong options removed:** every っ before h (いっほん: no word, a free elimination), the voiced 個 forms except さんご
  and なんご (いちご, ごご, じゅうご are real words), ぢゃく for 着 (→ じゃく), づう for 通 except after 3 and 何, がげつ
  for か月 except after 3 and 何, じゅうかん for 週間, にじゅうさい for 20歳 (neither list).
- **Wrong options added:** the classic slips: 4日 ようか / 8日 よっか, 20日 はたち / 20歳 はつか, 1日 いっか / いちか
  (いちにち kept: the prompt says "dates"), 10日 とうか, よ and く overused (よまい, くまい, よふん, くえん, よさい …),
  1人 いちり / ひとにん, 2人 ふたにん, the つ series (いちつ, ここのっつ …), 羽 さんぱ / なんぱ, か月 vs 月 (いちがつ for
  1か月), the vowel length of 週間 (にしゅかん).
- **Prompts:** 十 (とお) dropped: it has no counter and is mostly read じゅう; the つ readings run 1–9.
- **Counters added:** 番, 度, 泊 (ぱ after 3, 4 and 何), 件 (never voiced: 3件 さんけん). 年生, 名, 秒, 番目, ページ and
  日間 deferred (7–10年生 are not grades; 名 would be right for every person noun; 日間 clashes with the date prompt).
- **Nouns:** 人 → 人 and 曲 → 曲 dropped (the prompt is the answer); bottled and canned drinks take 本 and, when ordered
  or bought, つ (コーヒー, お茶, 水, ビール, ワイン …); 質問 and 問題 take 個 after つ; シャツ, セーター take 着; 葉書 通;
  メール 件; 59 common nouns added (家族, 鍵, 封筒, スマホ, コンビニ, スニーカー, 時計 個/つ/台, 予約 件 …).
- **"Counts" texts** rewritten for つ, 本, 匹, 頭, 杯 (the contents, not the cup), 着, 足, 通, 回, 階 (1階 is the
  ground floor), 日 (dates only), 年.
- **Rejected:** labelling 1日 with "also N days" (it would make the prompt ambiguous again), dropping 道, 川, ご飯
  (the gloss is JMdict's, which counts them right), みたり and みつ/よつ/むつ/やつ as wrong options (archaic or
  dictionary forms), level tags (no levels in the data yet).
- **Builder's own call:** 7月 なながつ is in neither list (heard informally; never shown as wrong).

## Chinese: the spot check

The drill derives a noun's measure words from CC-CEDICT's `CL:` notes (`docs/contracts/counters/measures.json`). Two
teachers spot-checked **161 nouns** (every HSK 1–2 noun with a note, 111, and 50 random HSK 3–4 ones), with the shown
gloss, the derived list, the 个 fallback decision, the fallback rule, the pool of wrong choices and sample questions:

- `zh-teacher-1`: a native speaker from Beijing, 15+ years teaching adults (HSK 1–5), author of the school's
  measure-word handout.
- `zh-teacher-2`: a native speaker from Taiwan who also teaches simplified characters and mainland usage, 15+ years,
  strict about the HSK Standard Course, 当代中文 and 新实用汉语课本.

The two agreed on almost every point; the builder applied the union (no adjudicator for the spot check):

- **Left out** (not countable, or the question teaches something wrong): 年, 边, 可能, 信心, 温度, 性格, 内容, 地, 意思,
  头, 血, 门口, 费用, 钱, 文化 and the time words 白天, 早上, 中午, 下午, 晚上, 秋天.
- **Lists replaced** (the shown answer was wrong or not the usual one): 词 个 (首 is for the poem form), 号码 个 (堆), 机场,
  车站, 楼 栋, 运动 项, 菜 道, 工作 份, the meals 顿, 日记 篇, 羊 只, 手 只, 题 道, 女士 位, 同学/爸爸/奶奶 个, 先生 位,
  烟 支, 药 片, 月 个 ("month").
- **Lists extended:** 个 fully right for 面包, 房子, 任务, 考试 (and 场), 文件, 本子, 表演, 门 (and 道), 电话, 房间, 教室,
  新闻, 消息, 意见, 建议, 短信, 手机 (and 支); 鸡蛋 颗, 牙膏 支, 作业 份, 总结 份, 电影 场, 饭 份, 草地 块, 通知 条 份, 茶 瓶,
  牛奶 盒, 服务 种.
- **Glosses** for the question: 字 "(Chinese) character", 店 "shop; store", 先生 "Mr.; sir; gentleman", 本子 "notebook",
  包 "bag", 网球 "tennis ball", 公交车 "bus", 车站 "station; stop", 成绩 "grade; result", 课 "class; lesson", 饭店
  "restaurant; hotel", 表演 "performance; show", 烟 "cigarette", and CC-CEDICT markup and register notes ("(abbr. for
  …[…])", "(coll.)", "(loanword)") taken out of every shown gloss.
- **Rules:** 个 is fully right after 位/名 (people); 支 and 枝 are one word; 场 is accepted as cháng and chǎng, 个
  toneless, 匹 as pī; the 个 fallback ("understood and common in speech, but … is the standard word") no longer follows
  条, 根, 匹, 头, 块 (一个路, 一个烟, 一个马 are wrong) and now follows 扇, 盏, 项, 处; never for 课, clothing, tickets, 照片,
  脸, 光, 纸; the pool lost 个, 枝, 口 and gained 扇, 盏, 幅, 顿, 次; a container noun (一杯茶) never gets another container
  or portion word as a wrong choice, and a noun never its own character (一门门).
- **Not applied:** a full per-noun list for every HSK noun (only the flagged ones); 名 for Japanese; Taiwan-only
  measure words beyond 支 for 手机 and 颗 for 鸡蛋.

## Wanted

- A person's review of both files, and of a larger sample of the derived Chinese pairs (HSK 3–6).
- Level tags for the counters (頭, 羽, 着, 足, 通, 曲 are N3), so a beginner can leave them out.
- The deferred counters (年生, 名, 秒, 番目, ページ, 日間).
