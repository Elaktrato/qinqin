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

## Execution record

(filled in as the tasks land)

## Local follow-up

(filled in at the end)
