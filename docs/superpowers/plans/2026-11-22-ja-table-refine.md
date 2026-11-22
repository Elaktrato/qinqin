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
- [ ] Tests: `hints.keepWhole`, `hints.usuallyReadingTag` decode; format 2 accepted, format 1 still accepted,
      format 3 refused; `Hints.KeepsWhole(texts...)`. Fail; implement; pass.
- Commit `feat(lemma): format 2 hints keepWhole and usuallyReadingTag`.

### Task 2 — boundary keeps listed expressions (`segment`, `ja.json`)
- [ ] `segment.json` cases: 法律に基づいて判断する, 計画に沿って進める, しかねない stay whole; 彼は行くと言っていました
      still splits と + 言っていました. Fail; boundary honours `keepWhole`; Japanese list in the table. Pass.
- Commit `feat(segment): expressions the table keeps whole are never split`.

### Task 3 — kana fit on the first sense (`lookup`, `ja.json`)
- [ ] Tests: bare して → する without frequency (仕手 has `uk` on its second sense); こと, する, いる unchanged. Fail;
      implement with `hints.usuallyReadingTag`; pass.
- Commit `fix(lookup): kana fit's usually-kana is the first sense's tag`.

### Task 4 — ないで, てはいけない, てもいい (`ja.json`)
- [ ] `deinflect.json` and `segment.json` cases. Fail; add rules. Pass.
- Commit `feat(lemma): negative te-form, prohibition and permission`.

### Task 5 — docs, measurement, gates
- [ ] Contract README (format 2, hints, list), wiki Reader; re-measure (issue table, reviewer rows, 62 + 47
      sentences, #177 rows, corpus) JMdict-only and + Jiten, before/after, every changed token listed;
      Execution record; full gates.
- Commit `docs: Japanese table refinements (#177)` and `docs(plan): execution record`.

## Execution record

(empty)
