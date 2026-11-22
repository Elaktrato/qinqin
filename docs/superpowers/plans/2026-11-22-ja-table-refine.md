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

## Review fixes (2026-11-22, the one fix wave)

**Correction to the record above.** "No other token changed" compared token spans only; counting changes of
the first entry on an unchanged span, the first round changed 149 tokens of the corpus in the JMdict-only
configuration (9 distinct, all from the first-sense kana fit: ところ → 野老, みる → 海松, …) and 23 of the 130
at-risk readings (priority ≥ 60, `uk` only on a later sense). Fixture counts in the first round: `deinflect.json`
78 → 89 cases, `segment.json` 18 → 25 (not "+12 / +8").

Each finding test-first, failing run seen before the fix:

| Finding | Test that failed first | Commit |
| --- | --- | --- |
| 1 first-sense kana fit broke みる, くる, ところ, め | `segment.json` cases みる, くる, ところ, め (the fixture lexicon gained `senses`, so `uk` can sit on a later sense; あげた passed already); `TestKanaFitUsesTheFirstSense` became `TestBareShiteWithoutFrequencyIsTheNoun` (仕手 first, recorded) | `398284d7` (revert to the entry flag; `usuallyReadingTag` removed; no narrow して rule: 仕手 has priority 92 > する 60, Ruling) |
| 2 particle-yields rule (にて → 煮る, たって → 立つ) | `segment.json` 東京にて開催, たって (にて needed a fixture 煮る of priority 86 to fail) | `e90bdcb0` (rule and its test removed) |
| 3 keepWhole blocked better splits | `segment.json` 荷物をおいてください, 本をおいていった, サラダにしてください, 部屋をきれいにしておいてね, ここであれこれ考えた, 家でないていた, 計画に基づいている (now に + 基づいている), と来たら | `b85c4690` |
| 4, 5 prohibition / permission forms | 7 `deinflect.json` cases | `e46e8cb7` |
| 6, 7 てほしい / ないでほしい, かねない; M9 | 5 `deinflect.json` cases; `TestWrittenExpressionDoesNotYield` | `2d2e0ef5` |
| 8 format 1 with format-2 fields | `TestFormat1RejectsFormat2Fields` | `f4f40b2a` (also gofmt of a test file) |
| 9, 10, 11, 12, M6 | — (M6: the と来たら / 法律に基づいて cases fail if keepWhole matched entry texts instead of the surface) | `600411de` docs, README in the commits above |

Fixture counts now: `deinflect.json` 101 cases, `segment.json` 40.

**Re-measured** (fresh scratch servers; `develop` 979d67ee = "base", the branch before this wave = "pre",
the final build = "post"; J = JMdict only, JF = JMdict + Jiten). Corpus (27 522 code points), compared per
token position including the first entry:

| | tokens | span changes (distinct) | same-span entry changes |
| --- | --- | --- | --- |
| J base → post | 10 438 → 10 351 | 55 (44) | **0** |
| JF base → post | 10 435 → 10 351 | 53 (43) | **0** |
| J pre → post | 10 361 → 10 351 | 15 (13) | 149 (the first-sense reverts) |

Every distinct base → post span change is one of: a kept-whole expression (に沿って 5, に応じて 4, をめぐって 3,
によれば 2 (J), に反して 2, に基づいて, にすぎない, を通して, と思ったら), ないでください (11 verbs), てはいけない /
てはいけません (9), てもいい / てもかまいません (13; です/ですか become one token), かねない on a verb (起こしかねない,
招きかねない, 体を壊しかねない, なりかねない, 倒産しかねない, つながりかねない), てほしい (挑戦してほしい, 来てほしい,
連絡してほしい, 大切にしてほしい). The 130 at-risk readings: 0 changes base → post in J and JF (23 / 5 changed
base → pre). Sentences (343: the 188 of the first round, the reviewer's 36 rows of this wave, the 130 at-risk
readings — overlapping): 32 rows change base → post in each configuration, all of them the forms above or the
#177 issue rows (ないでください, てはいけない, てもいい, しかねない, the expressions).

Reviewer rows, post (J / JF): みる 見る, くる 来る, きた 来る, ところ 所, あげた 上げる, め 目 (both);
会場にて受付を行います and 東京にて開催: にて (J) / 似る (JF, unchanged from base: frequency); たって: たって (J) /
立つ (JF, as base); 荷物をおいてください → を + 置く; 本をおいていった → を + 置く; サラダにしてください → に + する;
部屋をきれいにしておいてね → きれい + に + する + ね; ここであれこれ考えた: で + あれこれ in JF, であれ + これ in J
(the first JMdict entry of で is the conjunction, so the particle test fails; unchanged from base); 家でないていた:
でない + ていた in both (J: で's first entry is no particle; JF: でない is 出る's negative; unchanged from base,
not solved); 計画に基づいている → に + 基づく; 少ないです, 危ないです unchanged; 頭に当たって → に + 当たる;
と来たら → と + 来る; して / してから / 仕事をして帰った: 仕手 in J (Ruling), する in JF; 忘れないでね unchanged
(standalone ないで, Ruling); the prohibition, permission, ほしい and かねない rows fold as listed.

**Gates of the wave.** Targeted Go (`lemma lang lookup segment`) green after every finding. One full Go run:
gofmt clean, vet clean, 47 packages ok, exit 1 only for the known `internal/ai`
`TestHostnameResolvingToEmbeddedFormIsRefused`. Node 26 vitest (docs-reading tests; no web code changed):
exit 0, 567 files, 12 268 passed, 8 skipped. Scratch servers and data deleted afterwards.
