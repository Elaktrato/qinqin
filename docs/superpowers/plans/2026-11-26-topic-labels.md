# Topic labels for words — plan (issue #220)

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (stage A). The fill rule (#221) places words
into themed units, so words need topic labels. Owner decision: OpenMoji categories plus agent-suggested labels,
**reviewed by the owner (low-confidence labels in full, a 10 % sample of the rest); only reviewed or sample-passed labels ship**. No contract change here; the files are packaged into the
course pack by #221/#223. Builder: one agent, branch `feature/v090-topic-labels` from `develop`; needs the images
pack mapping (#216, merged in v0.8.0).

## Files this issue produces

`plugins/data/course-<lang>/` for `zh` and `ja`, **without** a `manifest.json` yet (the `course` pack type does not
exist until #221; `scripts/check-sources.mjs` must skip a directory with no manifest, one test for that):

- `topics.json`: the fixed list, about 40 topics for both languages, stable ids (`food-drink`, `family`, `body`,
  `home`, `transport`, `work`, `school`, `time`, `weather`, `emotions`, …), each with `parent` (optional grouping
  for the roadmap) and an English name. Names shown to learners come from the message catalogue
  (`apps/web/src/lib/i18n/messages/en.json`, keys `topic.<id>`); `topics.json` holds ids and the OpenMoji
  mapping only.
- `labels.tsv`: `form`, `reading`, `senseIdx` (empty = the whole word), `topics` (comma-separated, first is the
  primary), `source` (`openmoji` | `agent`), `confidence` (0–1), `reviewed` (`yes` | `sampled` | empty). Sorted by form, then
  reading. A header comment records the model, date and prompt version of the agent run.
- `LICENSE` (CC BY 4.0), `ATTRIBUTION.md` (OpenMoji group credit if used, see Ruling 2).

## Tasks

1. **Topic list.** Write `topics.json` with a test: ids match `^[a-z]+(-[a-z]+)*$`, unique, every OpenMoji group and
   subgroup (read from the images pack's data, #216) is mapped to exactly one topic or to `none`; the unmapped
   remainder is printed.
2. **Frequency band (Ruling 1).** The words to label are the **top N by frequency per language** (N = 8,000), taken
   from the bundled frequency data: Japanese by Jiten rank, Chinese by the fallback of decision 7 (character
   frequency from Unihan/`hsk-chars` plus word length; replace with a word frequency pack when one exists).
   `scripts/prepare-topic-labels.mjs` writes the candidate list (`form`, `reading`, dictionary gloss, part of
   speech) into a scratch directory. It never reads or writes level membership.
3. **Labels from pictures.** Words with an images-pack mapping inherit the emoji's group → topic (`source=openmoji`,
   confidence 0.9, primary topic only). Test: a fixture of five mapped words and one unmapped; deterministic output.
4. **Agent batch for the rest.** `scripts/suggest-topic-labels.mjs` writes **prompts and a results file in batches
   of 200 words** (gloss and part of speech in, up to two topic ids and a confidence out); the batches run as
   subagent tasks, not inside the script (no network call in the repository's scripts). Validate each result
   (unknown topic id, more than two topics, confidence outside 0–1 → rejected and re-queued). Multi-sense words:
   label the sense, not the word (`senseIdx` from the dictionary's sense order; when the sense is not stable,
   label the word and set `senseIdx` empty).
5. **Review file.** `scripts/review-topic-labels.mjs` produces a review view: by topic, lowest confidence first,
   with the gloss; the owner edits `labels.tsv` (or a `review.tsv` of corrections) and sets `reviewed=yes`.
   `--check` fails when a row is unreviewed **and** would ship (see task 7) so unreviewed labels can never
   ship by accident.
6. **Coverage report** per level (needs the installed level packs, read only at report time, never stored in a
   committed file): the share of HSK 1–4 and ≈ N5–N3 words with a reviewed topic. The course fill rule works well
   at ≥ 70 % per section; report the gap and the 20 most frequent unlabelled words per level.
7. **Ship rule.** A script option `--ship` writes `labels.tsv` with only `reviewed=yes` rows (or `source=openmoji`
   rows whose confidence is 0.85 or more, once their 10 % sample passes: decision 3); everything else stays in `labels.candidates.tsv` (not
   packaged). Test: the committed `labels.tsv` has no row without `reviewed=yes` (or the sampled exception).
8. **Docs.** `docs/sources.md` (how the labels were made and reviewed), `LICENSING.md` mention, wiki
   Data-and-licences, ROADMAP.

## Rulings

- Ruling 1: labels are keyed by `form|reading` over a **frequency band, not by level** — a file carrying exactly
  the HSK 1–4 words would reproduce a list with no reuse licence, which the owner kept out of the course pack —
  if wrong, some level words fall outside the cut and are placed by frequency (cost: weaker themes for those
  words; raise N for review time).
- Ruling 2: the **assignment** (word → topic) is project content under CC BY 4.0, with an OpenMoji credit in the
  notice and no emoji group names in the file — a classification is a fact about the word, but a strict reading
  could call it an adaptation of OpenMoji metadata — if wrong, the labels file must be CC BY-SA 4.0
  (cost: a second licence in the course pack; the owner decided on CC BY 4.0 with an OpenMoji credit, decision 4 of the overview).
- Ruling 3: only labels that are `reviewed=yes` or in a source whose 10 % sample passed (`reviewed=sampled`, confidence
  0.85 or more) ship — the owner's decision of 2026-11-26 — if wrong, a wrong label ships (cost: a re-review of that
  source and a pack update; the confidence column and the `--check` rule keep the exception narrow).
- Ruling 4: the topic list is **fixed per release**; adding a topic is allowed, renaming or removing an id needs a
  migration note in the course contract — units refer to ids — if wrong, a unit loses its theme match
  (cost: one fill-rule report line).

## Needs human review

**The low-confidence labels in full, plus a 10 % sample of the rest** (decision 3, owner, 2026-11-26). A sample
(seeded, stratified by source and level) with more than 5 % wrong rows sends that source back for full review. Chinese labels for polysemous
words and Japanese labels for kana-only words are the risky ones; a native-speaker pass is not planned before the
release.

## Done when

`topics.json` and `labels.tsv` exist for both languages, the coverage report is committed under
`docs/superpowers/specs/2026-11-26-topic-label-coverage.md` with the numbers, `--check` passes in CI, and the
files carry a licence and a notice.
