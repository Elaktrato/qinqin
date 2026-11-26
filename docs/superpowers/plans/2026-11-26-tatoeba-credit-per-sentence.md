# Tatoeba credit on every sentence (owner decision 2026-11-26)

Decision: "Adding the credits and linking to them should be added to each sentence if that is required for the
credit. We don't need to be backwards compatible, so we can throw the old structure out." (answer to v0.8.0 handoff
question 6, which asked whether the credits go into the sentence-package format 1 or a format 2.)

## What changes

1. **Pack file** (`plugins/data/*-sentences-tatoeba/sentences.json`, written by `server/tools/tatoeba`): each sentence
   carries `id`, `by`, `tid`, `tby` itself. The top-level `credits` map is removed; the importer refuses a pack that
   still has it, and refuses an `id` without a `tid` and a credit without an `id`.
2. **Data package** (`sentences.<packId>`): the `sentences` table gains `credit_id`, `credit_owner`, `credit_tr_id`,
   `credit_tr_owner`. The package type is **format 2**; every other type stays format 1 (`datapkg.FormatVersionOf`).
3. **Docs and contract:** `docs/contracts/packages/` (README, `schemas.json`, `catalogue.json`), CHANGELOG entry
   (contract 12), wiki Data-pack-format and Data-and-licences, `docs/sources.md`, pack `LICENSE` and `ATTRIBUTION.md`.

Not changed: migration 054 (the stored columns are exactly what the entry answer needs), the entry API's `credit`
object, the web app (it reads the entry answer, not the pack file), `credits.tsv`, the manifest notices.

## Rulings

- Ruling: credit sits on each sentence, a sentence under several words repeats it — one place to read a credit, no
  join, nothing to get out of step — +0.6 MB gzip over both packs (8.1 to 8.8 MB), +0.3 MB and +0.08 MB raw — cost if wrong:
  a bigger file; a dedupe would bring the map back.
- Ruling: the link is not stored, it is the source's page of the id (`https://tatoeba.org/en/sentences/show/<id>`),
  written once in the format docs — a stored URL is 45 bytes times 98,000 sentences of the same prefix and says no more
  than the id — cost if wrong: a second source with another URL shape needs a `url` field (an additive change).
- Ruling: sentences data package is **format 2** and the other types stay format 1 — the owner wants no compatibility,
  but a server that already built format-1 sentences packages must rebuild them (reconcile does that for a changed
  version, not for a changed schema under the same one), and a client sees `unsupported` instead of misreading rows —
  cost if wrong: one more place that has a per-type version (`FormatVersionOf`).
- Ruling: `credits.tsv` stays (the readable, GitHub-viewable list with the licence column; the manifests link it). It
  duplicates the pack's credits and could be dropped (-13 MB in the tree) if the owner prefers one copy; the CC0
  marking per sentence exists only there — cost if wrong: re-run the tool without it.
- Ruling: migration 054 is not touched and no migration 055 is needed — the importer maps the inline credit to the
  same four columns — cost if wrong: none for data; the columns keep the name `credit_*`.

## Test first

`server/tools/tatoeba/build_test.go` (`TestSentencesCarryTheirCredits`), `server/internal/sentences/credit_test.go`
(inline credit, refusal of the old shape), `server/internal/datapkg/credits_test.go` and the extended contract
test (schemas and per-type `formatVersion`). The bundled packs were converted by a script that first proved it
reproduces the old files byte for byte and then that every inline credit equals the row of `credits.tsv`.

## Not verified

A fresh `go run ./tools/tatoeba build` against the real export (the export is not downloaded here; the pack files
were converted from the committed ones and the tool is covered by the golden fixture); the web tests (no
`node_modules` in this worktree, CI runs them); an upgrade of a server that already built format-1 sentences
packages (covered by the version-bump rule in `registry.go` and its tests, not run against a real database).
