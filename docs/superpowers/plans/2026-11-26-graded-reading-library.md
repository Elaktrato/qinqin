# Graded reading library — plan (issue #231)

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (track R, after #183). Short stories, dialogues and
simple informational texts for each level, beyond the unit texts of the course: Chinese ≈ HSK 1–4, Japanese
≈ N5–N3, several per level, written for the project under **CC BY 4.0**. Needs #183 (the scoring and the
chapter type counts), the shared text format (overview §3.3, defined by #221/#223), and the reader's library
sources (`server/internal/library/sources`). New pack type `graded-readers` (expected contract 19). Builder: one
agent for the pack type and the reader integration, one for the content (agent-drafted, owner-reviewed); branches
`feature/v090-graded-readers`, `content/v090-graded-zh`, `content/v090-graded-ja` from `develop`.
Test first in every task; one commit per task.

## Shape

- **Pack type `graded-readers`**, one pack per language (`plugins/data/graded-zh`, `graded-ja`), `languages`
  shape *One*, not uploadable; follows ADR 0008. Files: `manifest.json`, `index.json` (`[{id, title, level, kind:
  story | dialogue | info, words (tokens), glossed (count), summary}]`), `texts/<id>.json` (the shared text
  format), `LICENSE` (CC BY 4.0), `ATTRIBUTION.md`.
- **Reader integration:** a library source kind `pack` listing the pack's texts as a source named "Graded readers",
  filterable by level and kind; a text opens as a pack text (read-only, no stored row; bookmarks and highlights
  copy it into the learner's library, as for the course's unit texts). Chapters = the whole text (one chapter).
  "Read next" (#183) includes them as candidates.
- **Level and coverage:** each text declares its `level` (a name in the installed levels pack: `HSK 2`, `≈ N4`).
  The build check measures, with the reader's coverage rule, the share of tokens at or below that level
  (level words from the installed level pack, plus words of earlier levels) and requires **≥ 92 %**; a text
  that misses it is revised or moved up a level. The measured share is stored in `index.json` for the UI
  ("92 % at this level"). Glossed words (≤ 5 per text) count as known.
- **Volume target for the first release:** Chinese 12 texts per level (48), Japanese 12 per level (36): about
  half stories, a third dialogues, the rest short informational texts. Lengths 80–150 tokens (level 1) growing to
  300–500 (level 4/N3).

## Tasks

1. **Pack type** per ADR 0008 steps 1–4 and 5–10 (migration, `server/internal/gradedreaders`, `All` and
   `handlers` rows, contract row, web `PackType` and label, table tests, `pack-types.json`, wiki); import
   validates the index against the text files (ids, levels, counts).
2. **Library source `pack`**: server lists texts (`GET /api/library/sources/graded` with the pack's index), the
   reader opens `GET /api/library/pack-texts/{pack}/{id}`; web library page "Graded readers" source with level
   and kind filters; jsdom tests; an empty state when no pack is installed.
3. **Copy-on-use:** bookmarking or highlighting a pack text creates a library book row from the pack text
   (the attribution and licence note carried in the book row's `attribution` and `licenseNote`); test that the
   same text copied twice gives one book.
4. **Check scripts** `scripts/check-graded-readers.mjs`: schema, unique ids, coverage ≥ 92 % under the level packs
   (skipped with a clear message when no level pack is available), glossed ≤ 5, length bounds, no copyright
   text (a manual attestation field `original: true` per text); runs in CI on the pack files.
5. **Content drafting**: agents write texts per level in batches with the allowed-vocabulary list of the level
   (from the level pack, read at drafting time, not committed); each text is checked by task 4 and revised until
   it passes. The drafts avoid copying any published graded reader (prompt rule, plus a review note).
6. **Owner review packet** (export to Markdown in the scratchpad, not committed): per text title, level, coverage,
   the text and glosses; the owner approves or edits; `humanReviewed: false` until then.
7. **Sources and licence:** `docs/sources.md`, `LICENSING.md` (the packs are project content, CC BY 4.0), pack
   `ATTRIBUTION.md`; `check-sources` rule: no level-list words in `index.json` (the texts themselves obviously
   contain words; the rule is about listing level words as data).
8. **Docs:** wiki `Reader` (graded readers), `Data-pack-format`, ROADMAP.
9. **Verify:** Go tests for the new type and the source with `-race`, web `check` and `test`, merge
   `origin/develop`, PR.

## Rulings

- Ruling: the graded readers are a **pack type of their own**, not part of the course pack — the course is
  per-language skeleton content with a fixed contract, while graded texts are a growing library other languages
  (#201) can extend later — if wrong, two pack types where one would do (cost: small; both reuse the text format).
- Ruling: texts open as **pack texts** without a stored library row until the learner acts on them — a server
  with graded readers installed must not fill every learner's library with 84 books — if wrong, a learner expects
  them in "My books" (cost: a one-click "Add to my library").
- Ruling: **≥ 92 % coverage at or below the level** for acceptance — a measurable proxy for "within the level's
  vocabulary plus a few glossed words" (the reader's rule, unchanged) — if wrong, a text is harder than its
  label (cost: it is moved up a level; the stored measurement shows the share).
- Ruling: no external texts (public-domain simplified readers are excluded) — project-written CC BY 4.0 only, as
  the issue says — if wrong, fewer texts (cost: content effort).

## Needs human review

**The owner reviews every text** (title, level, content, tone) before `humanReviewed` flips; **native-speaker
review happens during the owner's own use**, as for the grammar lessons. Do not describe the texts as
native-checked. Content sensitivity: dialogues and stories should avoid real people, brands and sensitive topics.

## Done when

Both packs install on a fresh server, the reader lists "Graded readers" with level filters, a text opens and
shows its coverage, the check script passes in CI, and "Read next" can suggest them; texts are owner-reviewed or
clearly flagged unreviewed; CI green.
