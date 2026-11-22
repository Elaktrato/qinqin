# Japanese table refinements (issue #177) Implementation Plan

> Steps use checkbox syntax. Strictly test-first: write the test, run it, SEE IT FAIL, implement, see it pass.
> One commit per task.

**Goal:** keep taught grammar expressions whole, fold ないでください / てはいけない / てもいい, and close the
no-frequency gaps (bare して, しかねない) — in the Japanese table, with generic table-driven engine features.

**Spec (binding):** `docs/superpowers/specs/2026-11-22-ja-lemmatizer-design.md`, section "Refinements (#177)".

**Branch / worktree:** `feature/ja-table-refine` at `.claude/worktrees/ja-table-refine`, from `develop`.

## Gates

Go per task under `flock /tmp/qinqin-go.lock` (`lemma lang lookup segment`); ONE full `./...` at the end
(known environment failure: `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused`). Web only if web
code changes. Commits end with a blank line and exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Tasks

### Task 1 — engine format 2 (`lemma`)
- [x] Tests: `hints.keepWhole`, `hints.usuallyReadingTag` decode; format 2 accepted, format 1 still accepted,
      format 3 refused; `Hints.KeepsWhole(texts...)`. Fail; implement; pass.
- Commit `feat(lemma): format 2 hints keepWhole and usuallyReadingTag`.

### Task 2 — boundary keeps listed expressions (`segment`, `ja.json`)
- [x] `segment.json` cases: 法律に基づいて判断する, 計画に沿って進める, しかねない stay whole; 彼は行くと言っていました
      still splits と + 言っていました. Fail; boundary honours `keepWhole`; Japanese list in the table. Pass.
- Commit `feat(segment): expressions the table keeps whole are never split`.

### Task 3 — kana fit on the first sense (`lookup`, `ja.json`)
- [x] Tests: bare して → する without frequency (仕手 has `uk` on its second sense); こと, する, いる unchanged. Fail;
      implement with `hints.usuallyReadingTag`; pass.
- Commit `fix(lookup): kana fit's usually-kana is the first sense's tag`.

### Task 4 — ないで, てはいけない, てもいい (`ja.json`)
- [x] `deinflect.json` and `segment.json` cases. Fail; add rules. Pass.
- Commit `feat(lemma): negative te-form, prohibition and permission`.

### Task 5 — docs, measurement, gates
- [x] Contract README (format 2, hints, list), wiki Reader; re-measure (issue table, reviewer rows, 62 + 47
      sentences, #177 rows, corpus) JMdict-only and + Jiten, before/after, every changed token listed;
      Execution record; full gates.
- Commit `docs: Japanese table refinements (#177)` and `docs(plan): execution record`.

## Execution record

Executed 2026-11-22 in `.claude/worktrees/ja-table-refine`, machine otherwise idle.

**Commits:** `88bd4ed8` spec/plan; `8e041ecd` Task 1 (format 2 hints); `06b31804` Task 2 (keepWhole + the
Japanese list); `cebf9ea0` Task 3 (kana fit on the first sense); `205ad8a3` Task 4 (ないで, てはいけない,
てもいい); then three commits from the measurements: `567794c8` (an unwritten particle yields to a strictly
higher-priority inflection — after Task 3 bare して still lost, to the priority-0 particle して), `9b0ae137`
(a particle is an entry whose *first* sense is one — JMdict's して has a conjunction-only last sense),
`e2359697` (ないで / なくて `chainOnly`; くて back to surface-only — the first corpus re-check found 高くないです,
どころではないでしょう cut as ないで + す and 痛くてたまらない read as a contracted progressive); `1c6f13d7` docs.

**Test-first, as run.** Task 1: `TestFormat2Hints` failed at vet (`UsuallyReadingTag` undefined), then green.
Task 2: the three keep-whole `segment.json` cases failed (5/4/2 tokens), the quotation case passed already
(と言って is deliberately not listed), then green. Task 3: `TestKanaFitUsesTheFirstSense` failed (仕手 first),
then green. Task 4: 13 fixture expectations failed, then green. `567794c8`: `TestParticleYieldsOnlyToAHigherPriority`
failed (して first), then green; `9b0ae137`: the same test with a conjunction-only last sense on して failed,
then green; `e2359697`: `TestChainOnlyRule` (unknown field) and two `deinflect.json` rejects (高くないで,
痛くてた) and the `segment.json` case 寒くないです failed, then green. The deinflect case "negative te-form"
(食べないで → 食べる) was removed: standalone ないで is deliberately not deinflected any more (Ruling).

**Real-app check** (fresh scratch servers seeded with the bundled JMdict, and JMdict + Jiten; "before" = a
build of `develop` 979d67ee, "after" = this branch). Sentences: the #165 issue table, the reviewer's 62 rows,
my 62 + 47 sentences from #165 and 37 new #177 rows (188 distinct). Every changed row, both configurations
unless marked:

| Text | Before | After |
| --- | --- | --- |
| して (JMdict only) | して (仕手) | して → する (te-form) |
| してから, 宿題をしてから寝る, 宿題をしても, 仕事をして帰った (JMdict only) | して (仕手) | して → する |
| しかねない (JMdict only) | し + かねない | しかねない |
| 食べないでください, 行かないでください, 心配しないでください, 吸わないでください, 見ないでください | 〜ない + でく + ださい | one token → main verb (negative te-form request) |
| してはいけない, 撮ってはいけない | して + はいけ + ない | → する / 撮る (te-form prohibition) |
| しなくてもいい, 着てみてもいいですか | 〜なくて + もい + い(で) | → する / 着る (… permission) + です(か) |
| 法律に基づいて判断する | に + 基づいて → 基づく | に基づいて |
| 計画に基づいている | に + 基づいている → 基づく | に基づいて + いる (recorded trade-off) |
| を通して, によれば (JMdict only; with Jiten によれば was already による), に応じて, に沿って, をめぐって, をおいて, にすぎない, と思ったら | particle + verb | the expression |

Unchanged on purpose: 忘れないでね (忘れない + で + ね: standalone ないで, Ruling), 行くと言っていました
(と + 言う), しか, 水しか飲まない, every #165 issue-table row, and all other rows.

Corpus (27 522 code points): JMdict only 10 438 → 10 361 tokens, 57 changed spans (38 distinct); + Jiten
10 435 → 10 361, 47 spans (35 distinct). Every distinct change is one of: して → する (7×, JMdict only), a
kept-whole expression (に沿って 5, に応じて 4, をめぐって 3, をおいて 3, によれば 2, に反して 2, に基づいて 2, にすぎない,
を通して, と思ったら, しかねない), ないでください (11 verbs), てはいけない / てはいけません (9), てもいい (12, the
following です/ですか now a token of its own instead of もい + いで + す). No other token changed; no
regression found. Segment time over the corpus (best of 3 per run, several runs): JMdict only 12.2–12.5 → 11.4–12.1 s, + Jiten
17.3–17.7 → 16.4–18.1 s: no measurable change.

**Not verified:** the reader UI in a browser (no browser automation; no web code changed); Android.

**Gates.** Targeted Go (`lemma lang lookup segment`) green after every task. One full Go run: gofmt clean,
vet clean, 47 packages ok, exit 1 only for the known `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused`
(no IPv6). No web code changed; the docs-reading web tests ran in the full Node 26 vitest run: exit 0, 567
files, 12 268 passed, 8 skipped. Node 22 `npm test`, `check` and `build` were not run (no web change). The
scratch servers and data were deleted afterwards.
