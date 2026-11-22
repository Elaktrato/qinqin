# Lemmatizer (issue #165) Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [x]`) syntax. Strictly test-first: write the test, run it,
> SEE IT FAIL, implement, see it pass. One commit per task.

**Goal:** One language-neutral lemmatizer engine driven by per-language JSON rule tables; Japanese ported
behaviour-identically, then extended with contractions, folded te-form auxiliaries, ながら and the adverbial
く; ranking and segmentation fixes so common verbs win over rare homophones and particle-led expressions;
furigana over the noun of a する compound.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-22-ja-lemmatizer-design.md`.

**Branch / worktree:** `feature/sb-ja-lemma` at `.claude/worktrees/sb-ja-lemma` (`<wt>`), from
`feature/study-batch`.

## Gates

- Go per task (targeted):
  `cd <wt>/server && flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./<pkgs> && go test -count=1 -p 2 -timeout 30m ./<pkgs>'`.
  ONE full `./...` at the end (known environment failure: `internal/ai`
  `TestHostnameResolvingToEmbeddedFormIsRefused`).
- Web: `npm --prefix apps/web run check`, targeted `npx vitest run <paths>`; at the end full `test`, `build`
  and the Node 26 vitest run. Exit codes read.
- Commits end with a blank line and exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Tasks

### Task 1 — engine (`internal/lemma`)

- [x] `lemma_test.go`: decode a synthetic non-Japanese table (toy rules, two classes, a stem predicate,
      chaining, `whole`/`suffix-or-whole`), check `Deinflect` order/reasons/classes, `ClassMatches`
      (tags and prefixes), validation errors (unknown key, unknown class, unknown predicate, bad match,
      maxDepth out of 1..8). Run: fails (no package).
- [x] Implement `Table`, `Parse`, `Deinflect`, `ClassMatches`, predicates. Pass.
- Commit `feat(lemma): data-driven deinflection engine`.

### Task 2 — Japanese table, parity with the Go rules (`lemma`, `lang`)

- [x] `lang` parity test: for every prefix (≤ 12 code points) at every offset of the grammar-pack example
      corpus plus every surface in the existing tests, the table engine's output equals the Go rules'
      (form, class, reasons, order). Run: fails (no table).
- [x] Generate `server/internal/lemma/tables/ja.json` from `buildJaRules` (scratch generator, not
      committed), embed it (`lemma.Builtin`). Pass; existing `lang` tests unchanged.
- Commit `feat(lemma): Japanese rule table ported from the Go rules`.

### Task 3 — seam: Ja on the table, lookup asks the pack (`lang`, `lookup`, `segment`)

- [x] Tests: `lang` — `For("xx")` with a registered table-only language deinflects; Ja's `ClassMatches` and
      `Hints` come from the table. `lookup` — a table-only language deinflects in lookup (synthetic table),
      the する compound comes from the table's `compounds`. Run: fail.
- [x] `lang.Deinflector` gains `ClassMatches`, `Hints`; `lang.Ja` delegates to the table; `lang.For` gives a
      table-only language a generic pack with its table; lookup uses `deinflector.ClassMatches` and the
      table's compounds. Delete `buildJaRules`, the Go class table and the parity test. Pass `lang lemma
      lookup segment`.
- Commit `refactor(lang): Japanese deinflection runs on the rule table`.

### Task 4 — contract `docs/contracts/lemma/` (`lemma`)

- [x] README, `ja.rules.json` (copy), `deinflect.json` (today's behaviour), Go test decoding both plus the
      byte-identity check. Run: fails until the files exist; pass.
- Commit `docs(contracts): lemma rule table format and fixtures`.

### Task 5 — new Japanese forms (`lemma` table)

- [x] Add fixture cases (contractions, auxiliaries, ながら, adverbial く, depth 5, rejects). Run: fail.
- [x] Add rules to `ja.json` and the contract copy; `maxDepth` 5. Pass; existing tests updated only where
      the depth-4 test pinned the old limit (recorded).
- Commit `feat(lemma): Japanese contractions, te-form auxiliaries, ながら, adverbial く`.

### Task 6 — ranking keys (`lookup`)

- [x] Tests: しました → する before 揣摩 (no frequency); しよう → する before 使用; すれば → する before the
      expression; ください and しかし stay; した without frequency → する (old test updated, Ruling). Fail.
- [x] `kanaFit` and `yields` keys in `rank.go`, hints from the pack. Pass `lookup segment`.
- Commit `feat(lookup): kana fit and expression keys rank common verbs first`.

### Task 7 — segmentation boundary and segment fixtures (`segment`)

- [x] `segment.json` fixture (mini lexicon, texts → tokens) and the decoding test; a case for 仕事をしている
      and the kept にとって. Fail.
- [x] Boundary rule in `Segment`. Pass.
- Commit `feat(segment): particle-led expressions never cut a longer word`.

### Task 8 — `stem` and furigana (`segment`, web)

- [x] Go: `Match.Stem` set for a compound stem match. Web: `smart-readings.json` case with `stem`;
      `smartReadings.test.ts` fails. Fail.
- [x] `Match.Stem`; web `SegmentMatch.stem`, `smartReadings.ts` aligns against `stem ?? lemma`. Pass.
- Commit `feat(reader): furigana over the noun of a する compound`.

### Task 9 — docs

- [x] `docs/wiki/Reader.md`, `docs/wiki/Searching-and-entries.md`, `docs/contracts/README.md`,
      `docs/contracts/overview.md`, `docs/contracts/reader/README.md`.
- Commit `docs: lemmatizer in the wiki and contracts index`.

### Task 10 — real-app check, measurements, final gates

- [x] Issue table and 30+ sentences before/after (JMdict only, and JMdict + Jiten frequency), corpus
      timing before/after, token diff over the corpus reviewed; Execution record; full gates.
- Commit `docs(plan): lemmatizer execution record`.

## Execution record

Executed 2026-11-22 in `.claude/worktrees/sb-ja-lemma`, unattended, while three other agents ran Go and web
suites on the same 4 cores (load average 8–14): timings below are noisy.

**Commits** (one per task, plus one fix from the corpus check): `8f7c9f92` engine, `840aa88f` table + parity,
`0e728551` seam, `86bb9d68` contract, `326e88c9` new forms, `ca09e0b2` ranking, `42fa6ae4` boundary,
`31d164a1` stem/furigana, `d906dd98` docs, `5c64c611` corpus-check fixes, then this record.

**Test-first, as run.** Task 1: the lemma tests failed with "no non-test Go files" (implementation moved
aside while the shared lock was held by another agent's suite), then passed. Task 2: the parity test failed
(no embedded table), then passed: 153 964 surfaces (every ≤ 12-code-point prefix of the grammar-pack
examples plus the test surfaces), 0 differences against the Go rules. `builtin_test.go` was committed in
Task 2 without a run of its own; it first ran (green) in Task 3. Task 3: failed at vet (`Rules` undefined),
then green; the parity test and the Go rules were deleted there. Task 4: contract tests failed (files
missing), then passed; the README already described the final state (folding, ranking, `segment.json`)
before those tasks landed. Task 5: 31 fixture expectations failed, then passed; `TestJaDeinflectDepthAtMostFour`
became `…AtMostFive` (deliberate: `maxDepth` 5). Task 6: the new ranking test and the updated した tests
failed, then passed; four existing tests pinned the old no-frequency order and were updated deliberately
(`TestShitaWithoutFrequencyRanksSuruByKanaFit`, `TestFirstPackWithAnyDataRanks`,
`TestFrequencyFailureDegrades`, segment `TestMatchAtShitaFollowsFrequency`), and `TestKanaMatchShowsTheDisplayForm`
now uses しゅくだい for its "not usually kana" case (した now resolves to する). Task 7: the fixture case
仕事をしている failed, then passed. Task 8: Go (vet: `Stem` undefined) and web (`smartReadings.test.ts`, the new
stem case: `[]` instead of べんきょう over 勉強) failed, then passed. Corpus-check fix: the として ranking case,
the すし compound test and the にはいられない fixture case each failed first, then passed.

**Real-app check** (scratch server built from this branch, copies of the seeded JMdict data dir; config A
= JMdict only, as the issue measured; config B = JMdict + the bundled Jiten frequency pack, a default
install). Issue table, re-measured on every row:

| Text | Before (A) | After (A) | After (B) |
| --- | --- | --- | --- |
| している / します / していません | する | する | する |
| 勉強しています | 勉強する | 勉強する (`stem` 勉強, べんきょう) | same |
| しなければ | する | する | する |
| させられた | させる (passive past) | させる (unchanged: JMdict entry) | する (causative passive past) |
| しました | しまする (揣摩) | する (polite past) | する |
| 仕事をしている | 仕事 / をして / いる | 仕事 / を / している → する | same |
| しちゃった | しち / た | する (past, completion, te-form) | same |
| してしまった | して / しまった | する (… completion …) | same |
| しておく | して / おく | する (in advance, te-form) | same |
| されている | される | される (unchanged: JMdict entry, shorter chain) | する (passive …) |
| すれば | すれば (exp) | する (conditional) | same |
| しよう | しよう (使用 etc.) | する (volitional) | same |
| しながら | しながら (品柄) | する (while) | same |

Further sentences (all in `tools/sentences.txt` of the scratch dir, 47 more real grammar-pack sentences in
`tools/real.txt`; all before/after pairs reviewed): 食べちゃった, 食べてしまった, 行っておく, 飲んじゃう,
飲んでしまいました, 書いておきます, 読んどいた, 見てみる, 食べてみたい, 走っていく, 教えてあげる, 手伝ってくれた,
教えてもらいました, 待ってください, 来ちゃった, 来てしまった, 行ってしまった, 行っちゃった, 忘れちゃった,
寒くなってきた, 高くなってしまった, 死んでしまった, 買ってくる, 使ってみました, 言っておいた, 勉強しておきます,
勉強しちゃった, 窓を開けておいてください, 宿題を忘れてしまいました, 日本語を勉強してみたい, なくしちゃった,
飲んじゃった, やってしまいました, 調べておいてください, 片付けておきます, 読んでみてください, 迎えに来てくれました,
撮ってくれません, 持ってあげましょう, 増えていく, 進めていく, 帰っていった (before: 帰って + いった → いる),
聞きながら, 歩きながら, 電話をしています — all now one token on the main verb with the chain. Unchanged
by design: ください / しかし alone, 書いとく, 帰ってきた and 持ってきて in config A (JMdict lists 書いとく,
帰って来る and 持って来る as entries of their own; with the frequency pack the plain verbs win), 宿題をしてから
(をして kept: nothing longer follows), 行ってきます (an expression entry). Still wrong, out of scope:
吸わないでください / 見ないでください (ないで + ください is not a rule), single kanji without KANJIDIC in this
data set (飲, 来 alone), ジュース split by an odd entry.

Corpus (27 522 code points of grammar-pack examples, 7 chunks of ≤ 4 000): tokens 10 589 → 10 408 in both
configs; 225 (A) / 214 (B) changed spans, every distinct one reviewed. The first after-run found three
regressions — として → とする (11×), には/にも split before 入る/いく (7×), すし → す + し (2×) — fixed in
`5c64c611` (an expression never yields to another expression; only unprioritised expressions are split; a
compound stem needs two code points or a non-kana one) and re-measured: none left.

Timing, `POST /api/segment` with `readings: true` over the corpus, three passes per run, before and after
interleaved on the same loaded machine: config A before 17.6 / 17.6 / 18.4 and 19.5 / 20.3 / 18.0 s, after
19.6 / 17.7 / 20.4 and 18.9 / 18.8 / 19.0 s (median ≈ 18.2 → 19.0 s, +4 %); config B before 25.7 / 24.0 /
24.9 s, after 25.0 / 26.3 / 27.7 s (+6 %). Deinflection alone (every ≤ 12 prefix of the corpus, 330 k calls,
best of 3, in-process): 535 ms → 697 ms (+30 %), candidates 85 851 → 94 810 (+10 %); the database lookups
dominate. Within the spec's 1.5× budget.

Consumers: the popup's `/api/lookup` at 食べちゃった returns entry 33229 (食べる), the same entry the segment
match lists first, so add-to-deck, the known mark, word states and coverage use the lemma's entry (all read
`entries[0]` / the lookup result; code checked, no change needed). `/api/segment` returned `stem: "勉強"` for
勉強しています; the web aligns べんきょう over 勉強 (contract case in `reader/smart-readings.json`).

**Final gates.** Go, one full run: gofmt clean, `go vet ./...` clean, 46 packages ok, exit 1 only for the
known environment failure `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 sockets).
Targeted runs per task (`lemma lang lookup segment`, `api` after the ranking and `stem` changes) green.
Web: `check` exit 0 (0 errors, 0 warnings), `build` exit 0, Node 26 `vitest run` exit 0 (561 files, 12 067
passed, 2 skipped). Node 22 `npm test` exit 1: 5 tests in `BookView.dom.test.ts` (4) and
`AccountSettings.dom.test.ts` (1) fail here; they fail identically with this branch's only web code change
(`smartReadings.ts`) reverted — the other web change is an optional type field — and pass under Node 26,
so they are not caused by this item (not investigated further).

**Not verified:** the reader UI in a browser (no browser automation here; the furigana path is covered by
the contract test and the real server's `stem`), Android, Chinese segmentation beyond the existing tests
(no table, no change expected), and a server with KANJIDIC2 installed. The scratch servers and data were
deleted afterwards.

**Follow-up (not filed: agents do not write to GitHub):** a `lemma-rules` data-pack type (format
`rules-json`) that `lemma.Register`s a table at startup and is served as a package for Android, so a new
study language gets rules without a server release; `ないで` (negative te-form) + ください.
