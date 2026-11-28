# #274 — pictures offline, and a review of doubtful pictures (2026-11-28)

Issue #274 (follow-up to #216 and #214). No owner-decision comment on the issue; the v0.9.0 plan lists it under
"Data for courses". Brief: `brief-v090.md` (orchestrator).

## What

1. **Pictures offline.** Images packs get a data package (`images.<packId>`), built by the server like every other
   pack's. The web app (browser, installed app, Android shell) downloads it during offline preparation, checks it by
   the package contract, keeps it on the device and answers a picture from it when the server cannot be reached.
2. **The doubtful pictures.** A word-by-word review list of the automatic, ambiguous mappings (Starter base sets,
   HSK 1–2, ≈ N5–N4), in batches; a teacher review (agents) of the batches, applied to the committed maps; clear
   mistakes fixed from the data; and a **Report picture** action on cards and entry pages.

## Tasks

1. Plan (this file).
2. Server: the `images` package type (`datapkg`), its schema, the contract rows and fixtures; a Go-built package
   fixture the web decodes.
3. Server: `pictureTargets` in the entry answer; picture reports (migration, store, routes, account delete, preview);
   a reported picture is no longer answered to its reporter.
4. Web: zip and package database reader, package store, offline picture lookup, offline preparation, worker allowlist,
   the Report picture action.
5. e2e: a picture with the network off at phone width (360 px guard), and the report action.
6. Review batches (script + files), teacher review with agents, applied to the maps; clear fixes.
7. Docs: contracts, CHANGELOG (contract 23), wiki, release notes, sources.

## Rulings

1. Ruling: **package shape** — `images.<packId>`, format 1, the pack's languages, no `requires`, not optional;
   `data.sqlite` holds `pictures (concept, label, credit, svg)` — only the pictures a map row uses, in canonical
   form — and `map (language, target, sense, concept, score, basis)` — the same rows the server resolves, keyed by
   the word targets, not by entry ids — why: one file kind like every other package, the content hash covers the
   pictures with no new machinery, and target keys need no rebuild when a dictionary changes — cost if wrong: a
   client that wants files per picture needs a format 2.
2. Ruling: **the web reads the package database itself** with a small read-only SQLite reader (table b-trees,
   overflow pages, records; UTF-8 databases only) after the zip is checked by the contract's four steps — why: the web
   has no SQLite and a JSON copy beside `data.sqlite` would make two shapes of one package; the reader is tested on a
   package the Go builder wrote — cost if wrong: a file the reader cannot read means no offline pictures (online
   pictures are unaffected); the reader then needs the missing case.
3. Ruling: **storage** — the checked zip is kept in Cache Storage `qinqin-packages-v1` under its package URL, with
   the catalogue row's id, revision, content hash, format version and instance id in its headers; sign-out and
   "Clear offline data" delete it like the API partitions — why: the download needs a signed-in user, a zip is a
   blob, and Cache Storage is what the offline data already uses — cost if wrong: one more download after a sign-in.
4. Ruling: **lazy download** — only offline preparation downloads, only when the workspace's Pictures aid is on, only
   the images packages of the workspace language, after the study data, following `packageAction` (the contract's
   client rule; a package already kept at the same revision is not fetched again). Measured: OpenMoji 962 pictures,
   1.70 MB of SVG; Mulberry 711 pictures, 4.60 MB of SVG (packages measured in the Execution record) — why: the
   packages are megabytes, so they are fetched once in the background on a connection without data saver, never on
   a page view — cost if wrong: a learner who never lets the app prepare has no offline pictures.
5. Ruling: **online first** — the picture route answers while the server is reachable; a network failure answers
   from the kept packages with the same resolution rule (`resolve.json`, now decoded by the web too) — why: online
   behaviour stays exactly #216's, and the server keeps the say on reports and live packs — cost if wrong: a slow
   network waits for the route's timeout before the kept answer.
6. Ruling: **targets come from the server** — the entry answer gains `pictureTargets` (the entry key, its written
   forms, its kana readings when it has none: `pictureTargets` of the picture route), so the offline lookup asks
   the same strings as the server; the offline copy of the entry carries them — why: the web does not know entry
   keys (`j:<seq>`), and one rule in one place cannot drift — cost if wrong: none beyond a few bytes per entry.
7. Ruling: **picture reports** follow the AI example reports (#186): `POST /api/images/reports {entryId, packId,
   concept, reason}`, reasons `wrong`, `unclear`, `offensive`, `other`; table `picture_reports`, per user, at most
   500 (the oldest goes), removed by the account delete, counted in the deletion preview (`pictureReports`), not in
   a backup (a restore keeps them), no administrator view (the #186 pattern has none) — why: the pattern exists and
   is reviewed — cost if wrong: maintainers learn of wrong pictures only through the review files; an admin view is
   a follow-up.
8. Ruling: **what a report does** — the reported picture of that entry is not answered to the reporter again (the
   route skips it and the next mapping may show); `GET /api/images/reports` lists the caller's reported pictures and
   is kept for offline use, so the kept packages skip them too — why: a learner who reports a wrong picture should
   not keep seeing it — cost if wrong: a mistaken report hides a good picture for that learner (no undo in this
   issue).
9. Ruling: **the review scope and the doubt rule** — every automatic row (basis other than `manual`) of a word in
   the Starter sets, HSK 1–2 or ≈ N5–N4 is listed when it is doubtful: a `gloss`/`keyword` match (one English word
   standing for the word), a word with several senses where the row maps the whole entry or a sense other than the
   first, a picture shared by more than three words of the language, or a single-character word. Batches of 150–300
   rows per language; the reason is in each row.
10. Ruling: **the teacher review** — two native-language teacher agents per language (Chinese, Japanese) and an
    adjudicator on disagreements, with the `claude` command line (`claude -p --effort high`, no tools), as #220 did;
    decisions `accept`, `remove`, `change` (another picture of the same pack, named by its concept);
    `remove` rows are kept out of the map by `scripts/images/<pack>/removed.tsv`, `change` rows become `manual.tsv`
    rows; the batches keep every answer and reason — why: the owner's content rule (§2 of the v0.9.0 plan) —
    cost if wrong: the agents may remove good pictures; the owner reviews later from the batch files.

## Review notes (the doubtful pictures)

Who: per language two teacher agents and an adjudicator (`scripts/images/review/reviewers.json`): zh — a Beijing HSK
teacher, a Taipei university course writer, a department head (adjudicates); ja — a Tokyo JLPT teacher, an Osaka
日本語学校 teacher, a curriculum lead (adjudicates). All agents, run with the `claude` command line
(`claude -p --effort high`, no tools, `scripts/picture-review.mjs run`), one call per batch and stage; not reviewed by a
person yet. Every answer and its reason is kept in the batch file (`a`, `b`, `c`; `decision` on each item).

Batches (word, reading, the sense the picture is for, the dictionary senses, pack, concept, the picture's English name,
score, basis, why it is doubtful):

- `scripts/images/review/zh-batch-01.json` — 116 items (every doubtful Chinese mapping of the Starter set and HSK 1–2;
  fewer than 150 because that is all of them)
- `scripts/images/review/ja-batch-01.json` — 208 items
- `scripts/images/review/ja-batch-02.json` — 208 items (the Starter set and ≈ N5–N4 of the bundled `jlpt-words`)

| | Chinese | Japanese |
|---|---|---|
| doubtful mappings reviewed | 116 | 416 |
| both teachers gave the same verdict | 112 | 398 |
| adjudicated | 4 | 18 |
| accepted | 88 | 168 |
| removed | 28 (27 Mulberry, 1 OpenMoji) | 234 (215 Mulberry, 19 OpenMoji) |
| changed to another picture | 0 | 14 (13 were Mulberry rows) |
| of which Starter words | 11 accepted | 35 accepted, 9 removed, 1 changed |

What the teachers removed, by their reasons: the wrong sense of a polysemous word (左 "leftist", 土 → planet Earth, 吐く
"vomit" for つく, 先生 → teacher, 跟 → heel, 太 → highest, 吗 → what), abstract words a symbol cannot teach (答え, 先, 哪个,
以外 → outside), ambiguous symbols (デート → calendar date, 字 → a mail letter) and pictures of a figurative sense (耳
"an ear for music"). The changes give a clearer OpenMoji picture (茶/お茶 → teacup, 右/左 → arrows, 少し/僅か/多少/少々/稍 →
pinching hand, 手紙 → envelope, 電気 → light bulb, 正しい → hollow red circle, 美味しい → face savouring food, 人 → person).
Every change named an existing OpenMoji picture (0 unknown names). The decisions are rows of
`scripts/images/<pack>/removed.tsv` (276) and `manual.tsv` (14); `scripts/build-picture-map.mjs` rebuilt the maps:
OpenMoji 3,172 → 3,165 rows, Mulberry 2,570 → 2,315.

Builder's own fixes (before the review, recorded in `removed.tsv` with the note `#274 builder`): 吗 → "what", 太 →
"highest", 跟 → "heel" (Mulberry) and 先生 → the teacher emoji (OpenMoji): each the wrong sense of a polysemous word for a
learner. Both teachers removed all four independently too.

A change becomes a manual row, which replaces every automatic row of that word in the pack (the builder's rule): 茶's
"brown" row (sense 4) went with it — the teachers had removed it as well.

The topic labels of #220 read the OpenMoji map for their picture-only labels: `node scripts/build-topic-labels.mjs`
rebuilt them from the reviewed map (2 Japanese picture-only labels fewer), no format change.

## Execution record

1. Plan — `6eda54b0`.
2. The images package — `8fb61da5`. Test first: `TestBuildImagesCarriesMappedPictures` written and the table row set,
   seen failing (`undefined: datapkg.TypeImages`, and the pack-types contract), then the type. The package fixture
   test (`TestImagesPackageFixture`) was written with the code. Real packs measured (`TestBuiltImagesPackages`,
   `QINQIN_IMAGES_PACKS`, packs built here from the pinned releases): `images.images-openmoji` 510,702 bytes,
   `images.images-mulberry` 1,569,231 bytes; budget 4 MiB each.
3. Reports and `pictureTargets` — `acfeb4bf`. Tests first (handler, store, entry answer), seen failing (404s, no
   package), then the code; regenerated the routes fixture and the domain pins (the entry answer's new key).
4. Web — `aa3e89de`. The zip, package-database, check and resolve tests were written with the code and passed at
   once; their power was checked by breaking the reader twice (the overflow rule, the interior-page child): both runs
   failed. The prepare, clear and report tests were seen failing first. The web reader also read the two real
   packages (`imagesPackage.real.test.ts`, `QINQIN_IMAGES_PACKAGE_FILES`).
5. e2e — `768f0bc4`. Written after the code (passed at once).
6. Review — the batches, script and builder fixes in `f58522d9` (the library's tests seen failing first, module
   missing); the agent review and its application in the next commit.

## Local follow-up

1. **A picture offline on a phone and in the installed app** (#274): on an https server with the images packs
   installed, open the app online with the Pictures aid on, wait for Settings → Account → App to say "Offline: ready",
   turn the network off and open a saved word's page and a card's answer: the picture shows with its credit. In the
   Android shell the same (`apps/android`, an emulator or phone). Look for: the picture, no sideways scroll, the
   Report picture button reachable with the keyboard closed. If it fails: Cache Storage `qinqin-packages-v1` should
   hold `/api/packages/images.<packId>`; if it is empty, the catalogue row may still have been building.
2. **A full Docker build** with the images stage (`WITH_IMAGES=1`, the default): the reviewed `map.tsv` files build
   the packs, and the server builds `images.images-openmoji` and `images.images-mulberry` at start (`GET
   /api/packages?languages=all` lists them `ready`, about 0.5 MB and 1.6 MB).
3. **A person's look at the review** (`scripts/images/review/*.json`): the agents removed 262 pictures, most of them
   Mulberry symbols of abstract Japanese words; a teacher may want some back (delete the row from `removed.tsv` and
   rerun `node scripts/build-picture-map.mjs --cache <dir>`).
