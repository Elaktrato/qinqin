# #223 — courses: Chinese and Japanese skeletons and reading texts (2026-11-28)

Milestone v0.9.0, phase 4 (courses), the fourth of the chain #221 → #222 → #223 → #224 → #225 (tracker #218).
Branch `feature/v090-223-course-content` from `feature/v0.9.0` (57732281). Design:
`docs/superpowers/specs/2026-11-24-courses-design.md` (§11 calls are made here as rulings). Owner decisions that bind
this issue: the issue comment of 2026-11-26 (skeletons and texts are reviewed by native-language teacher agents, the
owner corrects later, nothing waits on the owner), the v0.9.0 plan §2 (review notes kept beside the content, content
marked "reviewed by agents") and §4 for #224 (lessons of 5–7 words; unreached words in texts get a reading and a
gloss — #222 shows them).

Builds on #221 (the `course` pack format, the fill rule, `docs/contracts/courses/`), #222 (roadmap and lesson player),
#220 (topic labels), #219 (estimated JLPT words), #275 (Starter lists).

## What

- **Two real course packs**, `plugins/data/zh-course` (≈ HSK 1–4) and `plugins/data/ja-course` (≈ N5–N3), in the
  #221 format (no format change), with `manifest.json`, `course.json`, `LICENSE` (CC BY 4.0), `ATTRIBUTION.md` and
  `REVIEW.md` (the teacher review notes).
- **Skeleton:** a start section and one section per level; units with stable ids, a theme (topic ids), the grammar
  lessons of the bundled grammar packs that fit, the hanzi/kanji they introduce, kana in the start section, a focus
  where it fits, checkpoints.
- **Reading texts:** one original short text per unit in the fully written levels, with an English translation,
  using only words reached by then plus a few new ones, checked against the real fill.
- **Teacher review** per language: two teacher agents and an adjudicator; findings applied; notes in `REVIEW.md`.
- **Tests:** the shipped packs parse, their grammar points exist in the bundled grammar packs, their characters are
  level-list characters; with a seeded database (`QINQIN_COURSE_DB`), the real fill places the words and every text
  stays within its reached words.
- **Docs:** `plugins/data/README.md`, `docs/sources.md`, wiki `Courses.md` / `Courses-data-model.md`, the Dockerfile
  comment, `docs/releases/NEXT.md`.

## Tasks

1. Plan (this file).
2. Draft skeletons (sections, units, topics, grammar), fill them on a scratch server with the bundled data, tune the
   topics and unit counts until the fill is balanced; assign characters.
3. Write the reading texts and translations; check them against the filled course with the server's segmenter.
4. Teacher review (2 teachers + adjudicator per language), apply, re-check.
5. Pack files (manifest, licence, attribution, review notes), sources and docs.
6. Tests: bundled packs (always) and the real-data fill and text check (seeded database).
7. Gates, execution record.

## Rulings

Format: `Ruling: <what> — <why> — <cost if wrong>`.

### Scope and where the packs live

1. Ruling: **both courses are complete skeletons to their target level; the reading texts cover ≈ HSK 1–2 and ≈ N5–N4**
   (27 Chinese and 34 Japanese texts); ≈ HSK 3–4 and ≈ N3 have units, themes, grammar and characters but no texts yet —
   the brief asks for the first levels in full and the rest as skeletons; texts need the teacher review, which is the
   slow part — those units have no reading lesson until a follow-up writes their texts (the format allows adding them
   without touching progress: lesson ids are derived).
2. Ruling: **the packs are bundled seed packs, `plugins/data/zh-course` and `plugins/data/ja-course`** (version 1.0),
   installed like `zh-grammar`: `qinqin seed` and the first-start auto-seed import every pack under `plugins/data`, and
   the image copies that directory (Dockerfile comment updated) — no new install path; a course pack is a few hundred
   KB — an existing server gets them only with `qinqin seed` (release notes say so).
3. Ruling: **licence CC BY 4.0 with the legal code as `LICENSE`, `ATTRIBUTION.md`, `REVIEW.md`, a manifest notice, a
   `docs/sources.md` section, and `zh-course`/`ja-course` in `check-sources.mjs` `PROJECT_PACKS`** — the project's own
   text (brief §8); the HSK and JLPT lists stay outside the pack (the fill reads them on the server) — none.

### Skeleton

4. Ruling: **unit counts: Chinese start 2, ≈ HSK 1 15, ≈ HSK 2 12, ≈ HSK 3 16, ≈ HSK 4 20 (65); Japanese start 3,
   ≈ N5 14, ≈ N4 20, ≈ N3 36 (73)** — quotas of about 20, 15, 30 and 47 Chinese words a unit (3, 3, 5, 7 lessons) and
   36, 74 and 105 Japanese ones; ≈ HSK 2 needs at least 11 units for its 62 grammar lessons at six a unit; the
   estimated N3 list has 3,776 words (the design expected about 3,700 for N5–N3 together), so 36 units keep a unit at
   about 15 word lessons — ≈ N3 units are long; more units are a cheap change (new ids) while no one has progress.
5. Ruling: **every grammar lesson of a level is placed once in its section** (≈ HSK 1 49, 2 62, 3 68, 4 58; ≈ N5 41, N4
   48, N3 58), one to six a unit, more than the issue's "one or two" — a learner who finishes a section has met its
   level's whole grammar pack; the fully written levels are placed by hand to fit the theme and the words, the
   skeleton levels spread in the grammar pack's order — the skeleton levels' grammar ignores the themes until their
   texts are written (the teachers' order findings for them are follow-ups).
6. Ruling: **no grammar point is referenced that the bundled packs lack**; the start sections have no grammar point:
   pinyin and tones, the sound system and kana have no lesson in the grammar packs, so the sound units are a
   listening focus and the kana units the scripts trainer (`scripts: hiragana`, `katakana`); the test checks every
   point against the bundled packs — none; a grammar lesson on pinyin or kana would be grammar-pack work.
7. Ruling: **the start sections: Chinese "Sounds and tones" (listening focus) and "First characters" (15 simple hanzi:
   一二三十人口大小中日月水火上下); Japanese "The sounds of Japanese" (listening), "Hiragana", "Katakana"; none has a
   unit test** — the issue's section 0; a start section gets no words (#221 ruling 5), so its check is the trainer —
   Starter mode's base set (#214/#275) is not in the course: the pack format has no place for it and the start section
   has no words; #225's onboarding offers Starter mode with the course.
8. Ruling: **script milestones, as set by the skeleton:** all hiragana by the second start unit, all katakana by the third
   (both before ≈ N5); the first 100 kanji by `n5-numbers-time` (≈ N5 unit 5); the first 100 hanzi by `hsk1-dates`
   (≈ HSK 1 unit 5) — the issue asks for the milestones to be set in the skeleton; #225 shows them — none.
9. Ruling: **characters come with the first unit whose words use them**, Chinese from `hsk-chars` levels 1–4 (a
   character of a higher list level than its first section is not introduced: 店, 饺), Japanese from `jlpt-kanji`
   ≈ N5–N3 at first use whatever its estimated level (the estimate puts 猫, 雪, 頭 at ≈ N3 though ≈ N5 words use
   them; leaving them out dropped 82 kanji); computed from the real fill until stable, then committed as data — the
   fill keeps a word after its characters (#221 ruling 15), so first use never leaves a word unplaced; 1,094 hanzi and
   615 kanji — a unit's script lesson can hold up to 35 hanzi or 42 kanji; #222/#224 may split long script lessons.
10. Ruling: **the opening ≈ HSK 1 units have hand-set characters, and a few later units name extra characters to steer
    the fill** (哪 to "Where is it?", 左右 to "Left and right" …); the first six ≈ HSK 1 units carry the topic
    `function` — Chinese has no frequency pack, so the fill's teaching order is the HSK list's alphabetical order
    (#221 ruling 12) and 我, 是, 这, 中国 came last; the characters keep the opening units to the words their texts need
    — some common words still land late (那 and 说 in unit 12, 这个 in unit 14); a zh frequency pack would fix the order.
11. Ruling: **unit ids are `<level>-<theme>` (`hsk1-hello`, `n4-weekend`) and `zh-start-…`/`ja-start-…`**; titles in
    English only — ids are stable progress keys (#221); interface languages are #144/#145 — none.
12. Ruling: **checkpoints: lesson check 5 questions, unit test 12 questions at 80 %, section exam 30 at 75 %** — plan §4
    marks; the counts are the builder's (#224 builds the tests) — #224 may tune them in the pack.

### Reading texts

13. Ruling: **"a few new words" is at most four, checked by reading the text with the fewest new words over every
    dictionary match** (`realdata_test.go` `bestReading`): a match is known when its entry is a reached word, its text,
    dictionary form or compound stem is a reached word's form (another entry of the same word), or it is a grammar
    word (first sense a particle, copula or auxiliary: the grammar lessons teach them); reached = the words of the
    unit and every unit before it in the real fill — the reading lesson's greedy segmenter is not a reliable measure:
    it splits Japanese kana runs against the words (名前は|アン…, 妹|がい|ます, 仕事|はち|と) and joins Chinese words into
    longer dictionary entries (不是, 一个, 中国人); its view is recorded in the test's dump and reported as a follow-up —
    the reading lesson marks more words than the check counts until the segmenter and #224's reading step improve.
14. Ruling: **texts keep the natural sentence where the reading lesson's segmenter misreads it** (有时间 → 有时|间,
    学得很好 → 得很; both teachers asked for 有时间吗) and avoid a misread string only where an equally natural wording
    exists (在教室 → 教室里, 想出国 → 出国旅游) — the segmenter is being fixed separately (follow-up) — a learner sees
    a wrong gloss on those few words until then.
15. Ruling: **dialogues are lines in quotation marks without speaker labels; names are the few new words they cost**
    (王明, 文文, アンナ) — no Latin letters in a text (the test checks it) — none.
16. Ruling: **≈ N5 texts are polite (です／ます); ≈ N4 texts use plain forms where the unit's grammar teaches them** —
    the grammar pack's order (plain forms first in ≈ N4) — none.
17. Ruling: **the pack format changes once: a text's translation may be up to 8000 bytes** (it was checked as a 200-byte
    title, so no real translation fitted), contract 34 (32 on the branch, renumbered after #181, #178 and #224) — a bug of #221's format, found by the first real texts —
    none.

### Tests

18. Ruling: **two tests:** `TestBundledCourses` (always): the packs load and pass the import check, manifest and
    licence files, the scheme is bundled, every grammar point is a lesson of the bundled pack and every lesson of a
    section's level is placed once, characters are list characters, texts (with an English translation, no Latin
    letters) exactly in the written sections; `TestBundledCoursesRealFill` (with `QINQIN_COURSE_DB`, a database
    seeded from `plugins/data`, like the Starter and topic real-data tests): the real fill places every word, every
    grammar point is installed, every text is within its reached words — the fill needs the dictionaries, which CI
    does not seed — CI does not run the fill check; the local follow-up does.

## Teacher review

Per language two teacher agents and an adjudicator (`claude -p --effort high`, no tools); personas, what changed and
what was not applied are in `plugins/data/zh-course/REVIEW.md` and `plugins/data/ja-course/REVIEW.md`. In short:
Chinese 26 of 27 texts revised (measure words 碗/把/家/块, natural answers, coherent scenes, each text practising its
unit's grammar), 6 unit titles, 28 grammar moves (HSK 1–4); Japanese 31 of 34 texts revised (no grammar before its
lesson, each text showing its own lesson, polite forms to clients, kana for きれい/にぎやか/ごはん), 11 ≈ N4 titles,
11 grammar moves (N5, N4, N3). Not applied: moves across levels (a lesson stays in its level's section), pronouns as
grammar items, splitting ≈ HSK 4 units; all listed as follow-ups in REVIEW.md.

## Findings for others (the orchestrator files them)

1. **The reading lesson's segmenter mangles Japanese kana runs**: greedy longest match joins a particle with the next
   kana into an unrelated word: 名前は|アン(ナ), 妹|がい|ます, 仕事|はち|と, 花|がき|れい, 町|はバ|スで, 私|はいつ|も; it also
   gives particles (の, は, を) a reading because they are no level word. Every Japanese reading text shows nonsense
   glosses until the segmenter (lemma-aware boundaries) and #224's reading step improve. The test's dump
   (`QINQIN_COURSE_DUMP`) records, per text, the reading lesson's segmentation and what it marks.
2. **Chinese: the segmenter picks another entry of a reached word** (那 → nā, 着 → zhāo, 得 → dé, 打 → dá) and shows that
   reading; and **joins reached words into longer dictionary words** (不是, 一个, 中国人, 明天见, 喝茶) that the
   reading lesson then marks as new; it misreads 有时间 → 有时|间, 在教室 → 在教|室, 学得很好 → 学|得很|好, 想出国 → 想出|国.
3. **Lemmatiser gaps** seen by the check: たり forms (聞いたり → り), 泣きそう (泣き), humble お持ちします (お|持ち), 描きにくい (描).
4. **The fill's Chinese order is alphabetical** (no zh frequency pack): 我, 这, 说, 那, 以后-like common words land late.
5. **The estimated JLPT list (#219)** puts slang and violence at N5–N4 (あいつ, こいつ, やがる, 殺す, 魔法 …), junk entries
   (寇する, あずさ, 翔る, れる …), and core words late (日本, ください, 時, 分) — teacher findings, details in ja REVIEW.md.

## Execution record

- Task 1, plan: committed first (3a1d2b40).
- Task 2, skeleton: drafted as data (a small generator in the scratchpad writes `course.json` from the unit specs,
  the text file and the character assignment; not committed — the committed `course.json` is the source from now on).
  Filled on a database seeded from `plugins/data` (`qinqin seed`), iterated: the Chinese opening units got the
  `function` topic and hand-set characters after the first fill put 我, 是, 这 in the last units (alphabetical order);
  the characters were assigned by first use and the fill re-run until stable (two rounds). Every word placed in both
  courses at every step.
- Format bug: the first real translation was refused (a title's 200 bytes). `pack.json` cases written first and seen
  failing, then `course.go` (56330bc7); contract 32, renumbered 34 on the merge of `feature/v0.9.0` (b7216373).
- Task 3, texts: 61 texts written against the filled words; the check first used the reading lesson's segmenter and
  was rewritten when it turned out to split Japanese kana runs against the words (Ruling 13).
- Task 4, review: four teacher reviews and two adjudications (see "Teacher review"); applied; every text re-checked
  (at most four new words; one more wording change in n4-work to stay within four).
- Task 5–6, packs and tests: `TestBundledCourses` and `TestBundledCoursesRealFill` were written alongside the content,
  **not test-first**; the real-data test doubled as the builder's tool while drafting (it failed on drafts with too
  many new words, which is how the texts were tuned).
- Real-app check: a scratch server (`qinqin serve` on 127.0.0.1:18723, the scratch database seeded from `plugins/data`
  with the final packs, a test user via `qinqin adduser`): `GET /api/courses` lists both; `GET /api/courses/zh-course`
  200, 315 KB, 1,892 candidates, 1,892 placed (1,460 by topic), 0 unplaced, source `hsk-words`; per section placed:
  HSK 1 300, HSK 2 181, HSK 3 470, HSK 4 941; 698 lessons, every grammar lesson available.
  `GET /api/courses/ja-course` 200, 848 KB, 5,759 candidates, all placed (4,698 by topic), 0 unplaced, source
  `jlpt-words`; N5 509, N4 1,474, N3 3,776; 1,160 lessons, every grammar lesson available. `If-None-Match` 304 on both,
  anonymous 401. Server stopped afterwards.

## Gates

- Go: targeted `internal/courses` while working; one full `go vet ./... && go test -count=1 -p 2 ./...` after the merge
  of `feature/v0.9.0`: every package ok except the known environment failure (`internal/ai`
  `TestHostnameResolvingToEmbeddedFormIsRefused`, no IPv6); gofmt clean. `TestBundledCoursesRealFill` with
  `QINQIN_COURSE_DB`: pass (0 unplaced, every text within four new words).
- Web (Node 26): `npm run check` 0 errors, 0 warnings; `npm run build` ok; full vitest 784 files passed (1 skipped),
  15,646 tests passed, 3 skipped. e2e: 77 passed (one run).
- `node --test scripts/*.test.mjs`: 244 tests, 243 pass, 0 fail, 1 skipped; `node scripts/gen-api-docs.mjs --check`
  ok; `node scripts/check-sources.mjs` ok.

## Local follow-up

- #223: seed a database from `plugins/data` (`qinqin seed --data <dir>`), then run
  `QINQIN_COURSE_DB=<dir>/qinqin.db go test -run TestBundledCoursesRealFill -v ./internal/courses/` — it should pass
  and log 0 unplaced words and at most four new words per text. Optional: `QINQIN_COURSE_DUMP=<dir>` writes the filled
  courses and each text's reading-lesson segmentation for review.
- #223: open Courses in a Chinese and a Japanese workspace on a phone and read a few units' reading lessons; the
  Japanese ones will show the segmenter problems listed under "Findings".
