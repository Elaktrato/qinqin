# Mandarin recordings — plan (issue #237) — PARKED

> **Parked (owner, 2026-11-26): #237 is not in v0.9.0.** It moved to the milestone "After v1.0". This plan stays as
> written so the work can start later without redoing the audit. The owner's answer to the syllable question: the
> BY-SA 3.0 acceptance for KanjiVG does **not** extend to the Mandarin syllable recordings, so if the work is ever
> done it ships Lingua Libre **words** only (the plan's recommended scope) and no syllable playback.

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (stage A, independent; **decision 1: not in v0.9.0**,
parked after v1.0). Licence audit:
`docs/superpowers/specs/2026-11-26-v080-data-sources.md` (the #237 section) and the v0.8.0 handoff §4.4: Lingua Libre
**words** pass the owner's rule (2,976 CC BY-SA 4.0 and 1,132 CC0; about 55 % of HSK 1–4), the `Zh-<pinyin>`
**syllables** do not (mixed 3.0, 2.0 and 2.0-UK; only about 301 of 2,610 pass the rule) and stay local-only.
Existing pieces: `scripts/fetch-audio-commons.mjs` (local-only, allow-listed licences, one request per second),
`scripts/fetch-audio-kanjialive.sh` and the Docker `audio` stage (pinned, checksummed fetch at image build),
`server/internal/audio` (the `audio` pack type, `index.tsv`, credits). No contract change unless syllables
ship (decision 6 recommends no): then the playback order rule needs a fixture (expected contract 20).
Builder: one agent, branch `feature/v090-mandarin-audio` from `develop`. Test first; one commit per task.

## What ships (with the recommended decisions)

- An **`audio` pack for Mandarin words**: only clips whose Commons licence is **CC0, CC BY 4.0 or CC BY-SA 4.0**
  (the owner's rule), each with licence, author, file-page URL, revision timestamp and a SHA-256 in `index.tsv`.
  Delivered **as a pinned release asset fetched at image build** (like Kanji alive), **not committed to git**; the
  Docker stage takes `WITH_AUDIO_ZH=0` to skip it. Expected size: about 4,100 clips; the build measures and
  reports it (a clip is capped at 2 MiB by the tool).
- **Playback:** a word with its own recording plays that; otherwise the device voice, as today (no syllable
  chaining while decision 6 stays "no"). The existing credit line shows speaker and licence where the clip plays;
  the Sources page lists the pack's licences and links to the full list.
- **Coverage report** for HSK 1–4 words: whole word / device voice, per level, in `docs/sources.md`.

## Tasks

1. **Snapshot tool:** extend `fetch-audio-commons.mjs` with `--snapshot` (a deterministic, resumable run for words
   only; syllables excluded by default; the licence allow-list narrowed to CC0, CC BY 4.0, CC BY-SA 4.0 for the
   bundled build, the old wider list stays for local use) writing `snapshot.tsv` (file, licence, author, URL,
   revision timestamp, SHA-256, size). Tests with a mocked API (the existing test file): allow-list, an
   ambiguous licence template dropped, a missing author dropped, determinism, resume.
2. **Re-check each file's licence from its file page** at snapshot time (not only the API field): the tool
   stores both and a mismatch drops the clip; a report lists drops with the reason.
3. **Run the snapshot once** (throttled, over an hour, in the background); publish the audio pack as a release
   asset named `qinqin-audio-zh-<snapshot date>.zip` with its SHA-256; this publishing step is **the owner's or
   an explicitly authorised action** (a release upload is outward-facing), the agent prepares the file and the
   command.
4. **Image build stage:** a pinned fetch step like `fetch-audio-kanjialive.sh` (URL, SHA-256 and licence hash as
   build args with defaults; fails closed on a mismatch; `WITH_AUDIO_ZH=0` skips); `qinqin seed` installs it as an
   `audio` pack (existing importer); a Go test with a small fixture pack.
5. **Playback wiring:** confirm the word lookup uses the pack for `zh` words (the resolver in
   `server/internal/audio/resolve.go` already maps word and reading; add Chinese cases: a word with several
   readings, a word without a clip, a clip keyed by a different written form); web: the existing play button and
   credit line work for Chinese; jsdom test for the credit text.
6. **Coverage report and docs:** `docs/sources.md` (Lingua Libre, the licence reasoning per class, the snapshot
   date and counts, what was dropped and why), `LICENSING.md` (the pack is BY-SA 4.0 + CC0, bundled as an image
   asset, not in the repo), wiki Data-and-licences, ROADMAP.
7. **Regeneration doc:** `docs/wiki/Development.md` section: how to re-run the snapshot, the diff of added and
   removed files with licences (`scripts/diff-audio-snapshot.mjs`, small, tested).
8. **Verify:** `node --test scripts/*.test.mjs`, Go `audio` tests, a Docker build with `WITH_AUDIO_ZH=0` (the
   normal CI) and a local one with the asset (not CI).

## Rulings

- Ruling: **words only, no syllables** — the syllable licences fail the owner's rule (mixed 3.0/2.0/2.0-UK) and a
  partial set cannot be chained into a word — if wrong (the owner extends the BY-SA 3.0 acceptance, decision 6),
  syllable playback and a sequence rule are added later (cost: a follow-up plan; the snapshot tool already
  supports it).
- Ruling: the pack is a **pinned release asset fetched at image build**, not committed — the clip set is large and
  its licences are per file — if wrong, a build without network has no Chinese audio (cost: `WITH_AUDIO_ZH=0`
  builds work, the device voice is the fallback).
- Ruling: **drop anything ambiguous** (missing author, template mismatch) — the notice requirement is attribution
  per clip — if wrong, fewer clips (cost: coverage; the report shows the drops).
- Ruling: a clip's licence is re-read from its Commons file page at snapshot time — API fields and file pages
  can disagree — if wrong, a clip is mislabelled (cost: a takedown by re-running the snapshot without it).

## Needs human review

**Listening:** the owner (or a native speaker) spot-checks about 50 clips for correct pronunciation and the right
word (Lingua Libre recordings are user-made); wrong clips go on a deny list in the repository. The licence
snapshot itself is checked by script and a sample of 20 file pages by the agent. No native-speaker review is
claimed.

## Done when

Chinese entries and cards play real recordings for the HSK 1–4 words the pack covers, every bundled clip has a
checked licence and credit, the coverage numbers are in `docs/sources.md`, the image builds with and without
the asset, and CI is green. The issue is parked after v1.0 (decision 1), and this plan stays as written.
