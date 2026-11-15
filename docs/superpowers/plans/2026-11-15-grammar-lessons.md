# Grammar Lessons (issue #47) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner always runs plans subagent-driven, but they must say "start" before anyone dispatches an implementer.

**Goal:** A `grammar` pack type (lessons by level with examples), imported by `qinqin seed`, served by a public API, read and practised on a `/p/grammar` page, with a bundled CC0 Chinese A1 demo pack.

**Architecture:** Go package `internal/grammar` validates `lessons.json`, stores packs and lessons (migration 026) and serves them through `GET /api/grammar` and `GET /api/grammar/{pack}/{lesson}`. The web plugin `qinqin-grammar` (`apps/web/src/lib/plugins/grammar/`) browses, reads (reader lookup, script variant) and practises (fill the gap; word order on a `WordSaladBoard` extracted from `SentenceCard`), storing progress as workspace plugin data.

**Tech Stack:** Go 1.26 (stdlib mux, modernc SQLite); SvelteKit 2 + Svelte 5 (runes), vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-grammar-lessons-design.md`. Also read `server/internal/sentences/sentences.go` and `server/internal/levels/levels.go` (importer patterns), `apps/web/src/lib/plugins/reader/BookView.svelte` (how `LookupController` and `PopupStackView` are wired), and the Round 3 section of `docs/superpowers/specs/2026-11-12-flashcards-design.md` (Word Salad).

**Worktree:** `<wt>` = `/home/user/www/github/qinqin/.claude/worktrees/grammar`, branch `feature/grammar` from `develop`. Run `npm --prefix <wt>/apps/web ci` once.

## Gates

- Web: `npm --prefix <wt>/apps/web run check`, `npm --prefix <wt>/apps/web test`, `npm --prefix <wt>/apps/web run build`.
- Go: `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e GOCACHE=/tmp/gocache -e GOPATH=/tmp/gopath -v <wt>:/src -w /src/server -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false golang:1.26 sh -c "go vet ./... && go test ./..."` (own user, scratch GOPATH/GOCACHE).
- Sources: `node <wt>/scripts/check-sources.mjs <wt>`.
- Every task ends green with one commit on `feature/grammar`; conventional message and, after a blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge or push.

## Global Constraints

- No third-party grammar content. Nothing from the HSK syllabus's grammar points; the demo text is exactly Task 6's, licensed CC0-1.0.
- Validation limits (reject the whole pack, error names the JSON path, e.g. `lessons[3].examples[1].focus`): levels 1–50; lessons 1–500; ids `^[a-z0-9]+(-[a-z0-9]+)*$`, level ids unique, lesson ids unique per pack, example ids unique per pack; `title` ≤ 120, `summary` ≤ 300 (both required); `pattern` 0–5 lines ≤ 120; `body` 1–20 paragraphs ≤ 2,000; examples 1–20 per lesson; `text`, `translation` required, `reading` optional, each ≤ 500; `focus` optional, must occur in `text`; `distractors` 0–4, non-empty, distinct, ≠ `focus`. Lengths are in Unicode code points.
- Lesson text is plain text everywhere: no `{@html}`, no Markdown.
- A cloze exists only for an example with `focus` and ≥ 2 distractors; choices are `[focus, …distractors]`, keys 1–5.
- Progress key `lesson:<packId>:<lessonId>` → `{completedAt: string, best: number, total: number}`, plugin `qinqin-grammar`, workspace-scoped; `best` never decreases.
- Migration file `026_grammar.sql`. **Ruling:** at build time 026 was the next free number on `develop` (it ends at 025). Sibling plans (core stats, pack management, audio) also want 026: whichever branch merges second renumbers its migration to the next free number (rename the file; nothing else references the number). Seed `importOrder[dict.TypeGrammar] = 4`.
- Web style: tabs, single quotes; Svelte 5 runes; touch targets ≥ 44 px; everything works by keyboard.

## Review Focus

- A Chinese demo sentence where a distractor is in fact grammatical, or a reading/tone that is wrong: the final reviewer reads all 40 examples of Task 6 against the spec's anti-goal (a native check is still an open point for the owner).
- `focus` occurring twice in a sentence (e.g. 是…是): only the first occurrence is blanked and the answer check stays correct (Task 4 test).
- Traditional variant on: `focus` and distractors convert with the sentence, so the gap is still found (Task 4 test with a fake converter mapping 个→個).
- A lesson removed from a pack by a re-import while the learner has progress for it: browse ignores orphaned progress rows; the old lesson URL shows "This lesson is no longer available." (Task 3 404 test, Task 7 page state).
- A language with no grammar pack, or a disabled pack: the Grammar page shows the empty state with a link to Sources, not an error (Task 4 browse test).

---

### Task 1: Pack type and `lessons.json` validation

**Files:**
- Modify: `server/internal/dict/manifest.go` (`TypeGrammar = "grammar"` in the type enum and the error text)
- Create: `server/internal/grammar/schema.go`, `server/internal/grammar/schema_test.go`

**Interfaces:**
- Produces: `type Level struct { ID, Name string; SchemeLevels []SchemeLevel }`, `type SchemeLevel struct { Scheme, Level string }` (JSON `scheme`, `level`), `type Example struct { ID, Text, Reading, Translation, Focus string; Distractors []string }`, `type Lesson struct { ID, Level, Title, Summary string; Pattern, Body []string; Examples []Example }`, `type Data struct { Levels []Level; Lessons []Lesson }` (lower-camel JSON tags as in the spec), `func ReadData(dir string) (Data, error)` wrapping `dict.ErrInvalidPack` with the JSON path.

- [ ] **Step 1: Failing tests**: a table test with one case per Global Constraints rule (valid minimal pack passes; each violation fails and the error contains the path, e.g. `lessons[0].examples[0].focus: "吗" does not occur in text`); unknown JSON fields are rejected (`DisallowUnknownFields`); `dict.Manifest{Type:"grammar", Format:"json", …}.Validate()` is nil.
- [ ] **Step 2: Run** the Go gate with `go test ./internal/grammar/... ./internal/dict/...` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; full Go gate.
- Ruling: absent `pattern`, `distractors` and `schemeLevels` normalize to empty arrays after validation, and the JSON tags carry no `omitempty`, so the stored JSON and the API never contain `null` and the web types can treat them as always present.
- [ ] **Step 5: Commit** `feat(grammar): grammar pack type and lessons.json validation`.

### Task 2: Storage and import

**Files:**
- Create: `server/internal/db/migrations/026_grammar.sql`, `server/internal/grammar/grammar.go`, `server/internal/grammar/grammar_test.go`, `server/internal/grammar/testdata/zh-mini/{manifest.json,lessons.json}` (2 levels, 3 lessons, own text)

**Interfaces:**
- Consumes: Task 1.
- Produces: tables per the spec; `func Import(ctx context.Context, db *sql.DB, pack dict.Pack) (Result, error)` with `Result{Lessons int}`; `ErrNotGrammar`; `func ListPacks(ctx context.Context, db *sql.DB, language string) ([]PackInfo, error)` (`language == ""` → all); `func LessonByID(ctx context.Context, db *sql.DB, packID, lessonID string) (LessonView, error)`, `ErrNotFound`. `PackInfo{PackID, Name, Version, Language, License, Attribution, Notice string; Levels []Level; Lessons []LessonSummary}`, `LessonSummary{ID, Level, Title, Summary string; Examples int}` in level then array order; `LessonView{Pack PackInfo (without Lessons); Lesson Lesson; Prev, Next string}` (neighbour ids across the pack's level order, "" at the ends).

- [ ] **Step 1: Failing tests**: import zh-mini → 3 lessons, `ListPacks("zh")` order and counts; re-import of identical data changes no `updated_at`; re-import without one lesson soft-deletes it and `LessonByID` → `ErrNotFound`; a pack that used to exist and is re-imported revives; `ListPacks("ja")` empty; wrong manifest type → `ErrNotGrammar`; the import is one transaction (an invalid second pack leaves the first untouched).
- [ ] **Step 2–4:** FAIL → implement (store each lesson's full JSON in `content_json`, `levels_json` on the pack) → PASS; Go gate (the migration tests in `internal/db` must still pass).
- Ruling: the fixture directory is `testdata/zh-mini` but its manifest id is `zh-grammar-mini`: pack ids share one plugin namespace (settings, plugin data), and the sample dictionary `plugins/samples/zh-mini` already owns `zh-mini`. Later task tests say `zh-mini` for the fixture pack; read it as `zh-grammar-mini`.
- Ruling: `LessonView.Pack` is a `PackInfo` whose `lessons` is omitted (`omitempty`); `ListPacks` returns a non-nil empty slice for a language without packs. Lesson order (list and prev/next) is the pack's level order, then array order inside a level. A re-import diff compares the pack's fields and each lesson's level, order, title, summary and content JSON; there is no uninstall route in this task, so pack revival is covered by clearing `deleted_at` in the test.
- [ ] **Step 5: Commit** `feat(grammar): store and import grammar packs`.

### Task 3: Seed, API, plugin listing, credits check

**Files:**
- Modify: `server/cmd/qinqin/seed.go` (dispatch + `importOrder`), `server/cmd/qinqin/packcheck.go` (`grammar_packs` in `warnStalePackTerms`), `server/cmd/qinqin/main.go` (`builtinGrammarManifest = {"id":"qinqin-grammar","name":"Grammar","version":"1.0","type":"feature","surfaces":["page"]}` registered with the others), `server/internal/plugins/plugins.go` (`grammarPlugins`, type `grammar`), `server/internal/api/api.go` + new `server/internal/api/handlers_grammar.go`
- Test: `server/internal/api/handlers_grammar_test.go`, `server/cmd/qinqin/seed_test.go`, `server/internal/plugins/plugins_test.go`

**Interfaces:**
- Consumes: Task 2.
- Produces: `GET /api/grammar?language=<code>` → `200 []PackInfo` (JSON lower-camel: `packId, name, version, language, license, attribution, notice, levels, lessons`), public; `GET /api/grammar/{pack}/{lesson}` → `200 LessonView` (`pack, lesson, prev, next`), `404 {"error":"not_found"}`, public.

- [ ] **Step 1: Failing tests**: seed of a root with a dictionary and zh-mini grammar imports both, grammar after sentences; both routes without a session → 200; unknown lesson → 404; `language` filter; plugin list contains `zh-mini` with type `grammar`; registry contains `qinqin-grammar`; stale-terms warning fires for a changed grammar manifest notice.
- [ ] **Step 2–4:** FAIL → implement → PASS; Go gate.
- Ruling: the `qinqin-grammar` built-in feature manifest (`builtinGrammarManifest` in `main.go`, registry test) is NOT part of this commit. `feature/plugin-sdk` replaces that constant pattern with embedded `server/internal/plugins/builtin/*.json` and a strict `ParseManifest` (sdk 1, permissions such as owns-data). When it has merged into develop, merge develop here and add `builtin/grammar.json` (sdk 1, page surface, owns-data for the progress rows) and append it to `builtinFiles`, with the registry test. Until then plugin progress rows have no registered plugin id.
- Ruling: `plugins.Exists` also accepts an active grammar pack id, so a pack's enable/disable state can be stored.
- [ ] **Step 5: Commit** `feat(grammar): seed, API and plugin listing for grammar packs`.

### Task 4: Web data and exercise logic

**Files:**
- Create in `apps/web/src/lib/plugins/grammar/`: `types.ts`, `api.ts`, `browse.ts`, `exercises.ts`, `progress.ts` and a `*.test.ts` beside each logic file
- Modify: `apps/web/src/lib/api/types.ts` only if shared types are needed (prefer `grammar/types.ts`)

**Interfaces:**
- Produces:
  - `types.ts`: TS mirrors of `PackInfo`, `Level`, `Lesson`, `Example`, `LessonView`.
  - `api.ts`: `listGrammar(language?: string): Promise<PackInfo[]>`, `loadLesson(pack: string, lesson: string): Promise<LessonView | null>` (404 → `null`), both `auth: false`.
  - `browse.ts`: `browseSections(packs: PackInfo[], schemes: { packId?: string; levels: { name: string }[] }[], enabled: (packId: string) => boolean, progress: Map<string, Progress>): Section[]` with `Section = { packId; packName; credits; levels: { id; name; badges: string[]; lessons: (LessonSummary & { progress: Progress | null })[] }[] }`; a badge `≈ HSK 1` only when the scheme pack and level exist.
  - `exercises.ts`: `convertLesson(lesson: Lesson, convert: (s: string) => string): Lesson`; `clozeParts(text: string, focus: string): { before: string; after: string } | null` (first occurrence); `buildExercises(lesson: Lesson, seed: string): Exercise[]` with `Exercise = { kind: 'cloze'; example: Example; choices: string[] } | { kind: 'order'; example: Example }` — clozes in example order (choices shuffled with `shuffleTokens` from `lib/study/wordSalad.ts`, seed `seed + example.id`), then one `order` per example shuffled with `seed`.
  - `progress.ts`: `GRAMMAR_PLUGIN_ID = 'qinqin-grammar'`, `progressKey(packId, lessonId)`, `parseProgress(raw: unknown): Progress | null`, `loadProgress(workspaceId): Promise<Map<string, Progress>>` (from the sync pull, like `study/store.ts`), `saveProgress(workspaceId, packId, lessonId, score: number, total: number, previous: Progress | null): Promise<Progress>` (keeps `max(best)`).
- [ ] **Step 1: Failing tests**: `clozeParts('是不是学生是', '是')` → before `''`, after `'不是学生是'`; an example with 1 distractor → no cloze; with focus + 2 → choices contain all three, same order for the same seed; `buildExercises` count for the demo-like lesson (4 examples, all clozes) is 8; `convertLesson` with a converter `s => s.replaceAll('个','個')` converts `focus` so `clozeParts` still finds it; `browseSections` hides a disabled pack, drops orphan progress, shows no badge without the scheme; `saveProgress` with best 7 then score 5 keeps 7.
- [ ] **Step 2–4:** FAIL → implement → PASS; web gates.
- [ ] **Step 5: Commit** `feat(grammar): grammar data, browse and exercise logic`.

### Task 5: Word Salad board extraction and the cloze component

**Files:**
- Create: `apps/web/src/lib/plugins/flashcards/cards/WordSaladBoard.svelte`, `apps/web/src/lib/plugins/grammar/ClozeChoice.svelte`
- Modify: `apps/web/src/lib/plugins/flashcards/cards/SentenceCard.svelte` (uses the board; keeps its grade suggestion and translation reveal)

**Interfaces:**
- Produces: `WordSaladBoard` props `{ solution: string[]; seed: string; disabled: boolean; onResult: (r: { wrongChecks: number; gaveUp: boolean }) => void }` (tile bank, answer row, Check, Give up, the refocus behaviour moved from `SentenceCard`); `ClozeChoice` props `{ before: string; after: string; choices: string[]; answer: string; onResult: (r: { correct: boolean }) => void }` (choice buttons, keys 1–5, a wrong pick marks it and reveals the answer, `aria-live` feedback).
- [ ] **Step 1:** Move the board markup and its state from `SentenceCard` into `WordSaladBoard` without behaviour change; `SentenceCard` still loads tokens and passes `solution`.
- [ ] **Step 2:** Write `ClozeChoice`.
- [ ] **Step 3: Run** web gates — every existing Word Salad test passes unchanged.
- [ ] **Step 4: Real-app check**: a Word Salad card in a deck session behaves as before (tap, keyboard, Check, Give up, suggested grade).
- [ ] **Step 5: Commit** `refactor(flashcards): extract the Word Salad board; feat(grammar): cloze choice` (one commit, message `feat(grammar): reusable Word Salad board and cloze choice`).

### Task 6: Demo pack `zh-grammar-demo`

**Files:**
- Create: `plugins/data/zh-grammar-demo/manifest.json`, `lessons.json`, `ATTRIBUTION.md`
- Modify: `docs/sources.md` (a "Grammar lessons" section naming `zh-grammar-demo`), `plugins/data/README.md` (type `grammar`, its format, the demo row), `server/internal/grammar/bundled_test.go` (imports `../../../plugins/data/zh-grammar-demo` cleanly: 10 lessons, 40 examples, 40 clozes)

Manifest: `{"id":"zh-grammar-demo","name":"Chinese grammar demo (A1)","version":"1.0","type":"grammar","language":"zh","license":"CC0-1.0","attribution":"Demo content written for qinqin by the project; CC0 1.0","format":"json","notice":"Demo content: ten short lessons for beginners, written for qinqin. The explanations and all example sentences are original and released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The levels (A1, roughly HSK 1) are the author's own estimates and are not taken from any syllabus."}`. `ATTRIBUTION.md`: the same facts plus the CC0 deed link. Readings show tone changes as spoken.

`lessons.json` levels: `a1-1` "A1 · Part 1", `a1-2` "A1 · Part 2", both `schemeLevels: [{"scheme":"hsk-words","level":"HSK 1"}]`. Lessons, exactly (example id = lesson id + `-1`…`-4`; `focus` | `distractors`):

| id / level | title · summary · pattern | body paragraphs |
|---|---|---|
| `shi` a1-1 | 是: A is B · Link two nouns. · `A + 是 + B` | 是 (shì) links two nouns: “A is B”. It is not used before adjectives; for those see the lesson on 很. / To say “is not”, put 不 before it: 不是 (bú shì). |
| `bu` a1-1 | 不: not · Negate verbs and adjectives. · `Subject + 不 + Verb / Adjective` | 不 (bù) goes directly before the verb or adjective it negates. Before a fourth-tone syllable it is said bú: 不是 bú shì, 不去 bú qù. / For 有 (to have) use 没 instead: 没有. |
| `ma` a1-1 | 吗: yes/no questions · Turn a statement into a question. · `Statement + 吗？` | Add 吗 (ma) to the end of a statement to turn it into a yes/no question. The word order does not change. / Answer by repeating the verb: 是 or 不是, 喝 or 不喝. |
| `hen` a1-1 | 很 + adjective · Describe things without 是. · `Subject + 很 + Adjective` | Adjectives work as predicates on their own, without 是. A bare adjective sounds like a comparison, so 很 (hěn) is added; here it often just means “is” rather than “very”. / To negate, use 不 and drop 很: 我不忙. |
| `de` a1-1 | 的: possession · Say whose something is. · `Owner + 的 + Thing` | 的 (de) joins an owner to what it owns, like English ’s. / With close people and groups it is often left out: 我妈妈, 我们学校. |
| `ye-dou` a1-2 | 也 and 都: also, all · Adverbs before the verb. · `Subject + 也 / 都 + Verb` | 也 (yě, also) and 都 (dōu, all, both) are adverbs: they stand after the subject and before the verb, never at the end of the sentence. / When both are used, 也 comes first: 我们也都去. |
| `ge` a1-2 | 个: counting things · Numbers need a measure word. · `Number / 这 / 那 + 个 + Noun` | Between a number (or 这, 那, 几) and a noun, Chinese needs a measure word. 个 (ge) is the most common one and works with many nouns, especially people. / “Two” before a measure word is 两, not 二: 两个人. |
| `zai` a1-2 | 在: where something is · Say where someone is or does something. · `Subject + 在 + Place` / `Subject + 在 + Place + Verb` | 在 (zài) says where someone or something is: 我在家. No 是 is needed. / The place comes before the action: 我在家吃饭 (I eat at home). |
| `you` a1-2 | 有 and 没有: to have · Having and “there is”. · `Subject + 有 + Thing` / `Subject + 没有 + Thing` | 有 (yǒu) means “to have”, and also “there is”: 这里有一个商店. / Its negative is 没有 (méiyǒu), never 不有. |
| `le` a1-2 | 了: it happened · Mark a completed action. · `Subject + Verb + 了 + (Object)` | 了 (le) after a verb marks that the action happened or is complete. / To say it did not happen, use 没 (or 没有) and drop 了: 我没吃. |

| example | text · reading · translation | focus · distractors |
|---|---|---|
| shi-1 | 我是学生。 · wǒ shì xuéshēng. · I am a student. | 是 · 很, 在 |
| shi-2 | 他是老师。 · tā shì lǎoshī. · He is a teacher. | 是 · 很, 在 |
| shi-3 | 这是我的书。 · zhè shì wǒ de shū. · This is my book. | 是 · 很, 吗 |
| shi-4 | 她不是医生。 · tā bú shì yīshēng. · She is not a doctor. | 是 · 很, 在 |
| bu-1 | 我不喝咖啡。 · wǒ bù hē kāfēi. · I don't drink coffee. | 不 · 吗, 的 |
| bu-2 | 他不去学校。 · tā bú qù xuéxiào. · He isn't going to school. | 不 · 吗, 的 |
| bu-3 | 今天不冷。 · jīntiān bù lěng. · It isn't cold today. | 不 · 吗, 在 |
| bu-4 | 我们不吃肉。 · wǒmen bù chī ròu. · We don't eat meat. | 不 · 吗, 的 |
| ma-1 | 你是学生吗？ · nǐ shì xuéshēng ma? · Are you a student? | 吗 · 很, 也 |
| ma-2 | 你喝茶吗？ · nǐ hē chá ma? · Do you drink tea? | 吗 · 很, 也 |
| ma-3 | 他是中国人吗？ · tā shì Zhōngguó rén ma? · Is he Chinese? | 吗 · 很, 也 |
| ma-4 | 你忙吗？ · nǐ máng ma? · Are you busy? | 吗 · 很, 也 |
| hen-1 | 我很好。 · wǒ hěn hǎo. · I'm fine. | 很 · 是, 吗 |
| hen-2 | 今天很热。 · jīntiān hěn rè. · It's hot today. | 很 · 吗, 在 |
| hen-3 | 这个苹果很大。 · zhège píngguǒ hěn dà. · This apple is big. | 很 · 吗, 在 |
| hen-4 | 中文很有意思。 · Zhōngwén hěn yǒu yìsi. · Chinese is interesting. | 很 · 吗, 在 |
| de-1 | 这是我的手机。 · zhè shì wǒ de shǒujī. · This is my phone. | 的 · 很, 吗 |
| de-2 | 那是老师的车。 · nà shì lǎoshī de chē. · That is the teacher's car. | 的 · 很, 吗 |
| de-3 | 你的名字很好听。 · nǐ de míngzi hěn hǎotīng. · Your name sounds nice. | 的 · 很, 吗 |
| de-4 | 他的朋友是医生。 · tā de péngyou shì yīshēng. · His friend is a doctor. | 的 · 很, 吗 |
| ye-dou-1 | 我也是学生。 · wǒ yě shì xuéshēng. · I am a student too. | 也 · 吗, 在 |
| ye-dou-2 | 他们都喜欢猫。 · tāmen dōu xǐhuan māo. · They all like cats. | 都 · 吗, 的 |
| ye-dou-3 | 我们都很忙。 · wǒmen dōu hěn máng. · We are all busy. | 都 · 吗, 在 |
| ye-dou-4 | 她也不喝酒。 · tā yě bù hē jiǔ. · She doesn't drink alcohol either. | 也 · 吗, 的 |
| ge-1 | 我有一个哥哥。 · wǒ yǒu yí ge gēge. · I have an older brother. | 个 · 的, 很 |
| ge-2 | 这个人是谁？ · zhège rén shì shéi? · Who is this person? | 个 · 的, 很 |
| ge-3 | 我们班有十个学生。 · wǒmen bān yǒu shí ge xuéshēng. · Our class has ten students. | 个 · 的, 很 |
| ge-4 | 我想买两个包子。 · wǒ xiǎng mǎi liǎng ge bāozi. · I'd like to buy two steamed buns. | 个 · 的, 很 |
| zai-1 | 我在家。 · wǒ zài jiā. · I'm at home. | 在 · 是, 很 |
| zai-2 | 老师在学校。 · lǎoshī zài xuéxiào. · The teacher is at school. | 在 · 是, 很 |
| zai-3 | 他在图书馆看书。 · tā zài túshūguǎn kàn shū. · He reads in the library. | 在 · 是, 很 |
| zai-4 | 我们在饭馆吃饭。 · wǒmen zài fànguǎn chī fàn. · We eat at a restaurant. | 在 · 是, 很 |
| you-1 | 我有一只猫。 · wǒ yǒu yì zhī māo. · I have a cat. | 有 · 在, 很 |
| you-2 | 他没有车。 · tā méiyǒu chē. · He doesn't have a car. | 没有 · 不有, 很 |
| you-3 | 这里有一个商店。 · zhèlǐ yǒu yí ge shāngdiàn. · There is a shop here. | 有 · 很, 吗 |
| you-4 | 我没有时间。 · wǒ méiyǒu shíjiān. · I don't have time. | 没有 · 不有, 很 |
| le-1 | 我吃了。 · wǒ chī le. · I've eaten. | 了 · 很, 是 |
| le-2 | 他买了一本书。 · tā mǎi le yì běn shū. · He bought a book. | 了 · 很, 是 |
| le-3 | 我们看了一个电影。 · wǒmen kàn le yí ge diànyǐng. · We watched a film. | 了 · 很, 是 |
| le-4 | 她去了北京。 · tā qù le Běijīng. · She went to Beijing. | 了 · 很, 是 |

- [ ] **Step 1: Failing test** `TestBundledGrammarDemo` in `bundled_test.go` (10 lessons, 40 examples, every example has a focus and 2 distractors).
- [ ] **Step 2:** Write the three files exactly from the tables (body cells split at ` / ` into paragraphs, pattern cells into lines).
- [ ] **Step 3: Run** Go gate and `check-sources` — PASS.
- [ ] **Step 4: Commit** `feat(grammar): CC0 Chinese A1 demo grammar pack`.

### Task 7: Grammar pages, Sources table, docs

**Files:**
- Create in `apps/web/src/lib/plugins/grammar/`: `manifest.ts` (`id: 'qinqin-grammar'`, `name: 'Grammar'`, `surfaces: ['page']`), `GrammarPage.svelte` (routes `rest`: `''` → browse, `<pack>/<lesson>` → lesson, `<pack>/<lesson>/practice` → practice), `GrammarBrowse.svelte`, `LessonView.svelte`, `PracticeRun.svelte`
- Modify: `apps/web/src/lib/plugins/index.ts` (register with `pages: [{ title: 'Grammar', nav: true, component: GrammarPage }]`), `apps/web/src/routes/sources/+page.svelte` (a "Grammar lessons" table from `listGrammar()`), `docs/ROADMAP.md` (#47 on develop)

**Interfaces:**
- Consumes: Tasks 3–5.

- [ ] **Step 1:** Browse for the workspace language (`browseSections`, plugin states, `/api/schemes`, `loadProgress`); empty state "No grammar lessons for this language yet." with a link to `/sources`; credits footer per pack.
- [ ] **Step 2:** Lesson: `loadLesson` → `null` shows "This lesson is no longer available." with a link back; `convertLesson` with the reader prefs variant (`prepareVariant` then `convertText`); pattern box, body, examples; reading toggle (localStorage key `qinqin.grammar.readings`, try/catch); `LookupController` over the lesson container with `runsOf(p) = [{ text: paragraphs[p] }]`, `PopupStackView` with `studyWorkspaceId` set (as `BookView.svelte` does); prev/next links; Practice button.
- [ ] **Step 3:** Practice: `buildExercises(lesson, lesson.id)`; `ClozeChoice` and `WordSaladBoard` (tokens from `loadTokens(language, text, segmentBatch)`); first-try correctness counts; summary with score, Retry, Back to lesson, Next lesson; `saveProgress` at the end (a write failure shows a message, the summary stays).
- [ ] **Step 4: Run** all gates — PASS.
- [ ] **Step 5: Real-app check**: `qinqin seed --packs plugins/data` into a scratch database, serve, `npm run dev`. In a Chinese workspace: Grammar in the nav; two levels with "≈ HSK 1"; open 是, hover 学生 shows the lookup popup; readings toggle survives a reload; traditional variant shows 個 in the 个 lesson and its cloze still works; practise a lesson with one wrong answer → 7/8 and a ✓ in browse; a retry with 5/8 still shows 7/8; Sources lists the demo pack with CC0; disabling the pack in Settings hides it; a Japanese workspace shows the empty state; keyboard-only run of a practice.
- [ ] **Step 6: Commit** `feat(grammar): grammar lessons page, practice and Sources credits`.
