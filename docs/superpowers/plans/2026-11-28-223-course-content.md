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

(Filled in while building; see below.)

## Execution record

(Filled in while building.)
