# Images pack: bundled pictures for words (#216)

Milestone v0.8.0 (the beginner experience). Issue #216. Branch `feature/images-216`, PR base `feature/v0.8.0`.
Licence audit: `docs/superpowers/specs/2026-11-26-v080-data-sources.md` (PR #256). Executed subagent-driven; pure
logic was written test first (matcher, readers, SVG check, resolution).

**Goal:** a new `images` pack type that carries SVG pictures and a per-language word -> picture mapping, the two
bundled sets (OpenMoji 17.0.0 black outline, Mulberry Symbols 3.6.1) built into packs at image build time, a route
that finds the picture of an entry, a Sources entry with the credits, and `entryPicture(entryId)` for the web client
(#212, #214, #215 call it; no picture UI here).

## Rulings

Format: `Ruling: <what> — <why> — <cost if wrong>`.

1. Ruling: **ShareAlike position (owner-unconfirmed, followed as instructed):** each BY-SA set is its own pack with
   its licence, notice and credit; the files are never `go:embed`ded and never bundled in the web build or the APK's
   web assets; the web app and APK fetch pictures from the server; the recoloured copy the web draws is stated to be
   covered by the same licence; the code stays MIT — it keeps the BY-SA data a collection next to the code, the
   position `LICENSING.md` already takes for CC-CEDICT and JMdict — if the owner or a lawyer disagrees, the pictures
   leave the image (`--build-arg WITH_IMAGES=0`, one stage) and the app shows no pictures; nothing else breaks.
   **Flagged for the owner.** A Dockerfile test (`scripts/dockerfile.test.mjs`) pins "not in the build stages, no
   `go:embed` of a picture".
2. Ruling: **One pack per picture set, pictures and mapping in the same pack, `languages` like a strokes pack** (type
   `images`, format `images-svg`) — the mapping is meaningless without its pictures, one install/uninstall unit, one
   licence per pack — a new language is a rebuild of the pack (the builder is a script), not a separate map pack to
   install.
3. Ruling: **Pictures are stored as text in the database** (`image_pictures.svg`), not as content-addressed files like
   audio — the sets are small (1.7 MB and 4.6 MB of SVG for the mapped subset), one transaction installs a pack, the
   backup and restore carry it, no store directory — the database grows by about 6.3 MB; a much larger set (Commons
   photos) would need the audio-style blob store.
4. Ruling: **The mapping names a word by entry key or written form plus a 1-based sense, never by entry id** (zh key =
   simplified form, ja key = `j:<ent_seq>`; at lookup the entry's key, written forms and, for a word with none, its
   kana readings) — ids change when a dictionary is re-imported, keys do not — the sense number is the position in the
   entry's sense list as the importer stores it (one dictionary per language; for CC-CEDICT one sense per line). Checked
   on a real seed: all 2,659 sense rows resolve to an entry, and in 97% the picture's label occurs in that very sense's
   glosses (the rest are tag matches). A second dictionary of a language would shift sense numbers: the sense then needs
   a dictionary column.
5. Ruling: **No data package for images packs** (`pack-types.json`: `package: null`) — the web installs no packages
   yet and a package needs its own `data.sqlite` schema, catalogue and writer — pictures work online only; an offline
   client has what it fetched, and the route is not cached by the service worker (the default). The issue's "delivered
   through data packages so pictures work offline" is therefore **not done**; a later change adds a package type.
6. Ruling: **`GET /api/images/entries/{id}[?sense=N]` answers 200 `{"picture": null}` when nothing maps** — most
   words have no picture, so "none" is the normal answer, not an error a console should log — a client that wants a
   404 must test `picture === null`. Signed-in users only; **not** open to access tokens (the v1 token table stays
   as it is). `GET /api/image-packs` is public for the Sources page, also not token-readable.
7. Ruling: **SVG vocabulary is checked, not sanitized, at install** (`images.CheckSVG`: drawing elements only, no
   DOCTYPE, no `on*`, links and `url()` only to `#id`, 256 KiB, depth 64; a client re-checks with `safeSvg`) — a
   refused pack is better than a silently changed picture, and the BY-SA file stays byte for byte — 346 of Mulberry's
   3,435 symbols use `<style>` and are left out of the map; a lenient vocabulary later would bring them back.
8. Ruling: **Matcher rules** (`scripts/picture-match.mjs`): an entry form equal to the emoji's CLDR short name
   scores 90; a first English gloss equal to the picture's label 80 (later gloss 60); name and gloss agreeing +10;
   CLDR keywords alone are never enough (60, review list); a keyword shared by two pictures, a homograph, a
   multi-sense entry whose gloss does not confirm, a gloss of a verb on a noun picture, proper names (a capital) and a
   name/gloss conflict all go to the review list; at most 12 words per picture; threshold 70 — precision over
   coverage, as the issue asks ("keep a match only when it's unambiguous") — about 90% of a 60-row sample was right at
   a glance, so roughly one automatic row in ten is wrong or doubtful; `manual.tsv` overrides replace automatic rows.
9. Ruling: **Mulberry only for words OpenMoji did not map, scored 5 lower; Chinese Mulberry rows only for HSK 3.0
   words, Japanese only for JMdict words with a priority marking** — one consistent style where there is a choice,
   fewer large coloured files, and Mulberry's abstract glosses ("below", "long") give noise on rare words — the HSK
   word list is used only as a gate at map build time (no list data is copied); the owner decided the HSK lists are
   bundled with attribution (CTI terms), but a mapping selected by them is a derived selection: **flagged**.
10. Ruling: **Only the black-outline OpenMoji SVGs; drawn from the theme by `themeSvg`** (black fill/stroke/stop
    colours become `currentColor`, the pack file is never modified); Mulberry keeps its colours — the issue's
    "one consistent style, recoloured from theme tokens"; no per-user colour set yet — Mulberry's coloured fills may
    look wrong on a dark theme; the colour OpenMoji set is a later per-user choice.
11. Ruling: **Excluded from the OpenMoji concepts:** skin-tone variants, flags, the font's helper glyphs, Unicode
    private-use extras (the Apple logo), brand logos, UI icons, queer-symbols (ambiguous as words), and any picture
    whose English name starts with a capital (zodiac signs, proper names) — they produced wrong or off-topic matches
    (林檎 -> the Apple logo, 癌 -> the zodiac sign Cancer) — a word for one of these gets no picture until a manual row
    is added.
12. Ruling: **The mapping (`scripts/images/<pack>/map.tsv`, 130 KB and 98 KB) is committed; the pictures are built in
    the Docker `images` stage** from pinned upstream files (SHA-256, sizes) like the audio pack — the mapping is
    reviewable data, the 56 MB upstream zips are not repository content — a moved upstream asset breaks the stage; a
    weekly workflow (`images-stage.yml`) and `WITH_IMAGES=0` are the fallbacks.
13. Ruling: **`images` is the last row of the pack-type table** — an appended type keeps every existing seed rank
    (ADR 0008) — the seed order of themes and fonts stays pinned. The Dockerfile's `QINQIN_PACKS` gains
    `/opt/qinqin/images`; a checkout builds into the gitignored `plugins/data-images/` (a default seed root).
14. Ruling: **Contract 8** (contract 7 is #215's, merged before this): the two routes, the pack type and the two
    fixtures `images/resolve.json` and `images/svg.json` — the base moved while this branch ran — if the lead merges
    another contract change first this one is renumbered above it (CHANGELOG heading, `version.json`,
    `api.ContractVersion`).
15. Ruling: **The 92 hand-checked rows (`scripts/images/openmoji/manual.tsv`, Chinese and Japanese) are a seed,
    not the Starter base sets** — the issue's 100-300 reviewed words per language need a human reading the
    dictionary — #214 must not rely on them for coverage.
16. Ruling: **No separate Sources page per-picture credit list**: the pack credit line is on the Sources page, each
    picture's designer is in `pictures.tsv` (served with the picture as `credit` and shown by
    `pictureCreditLine`) — OpenMoji asks for the project credit, which the pack carries — if a licence reading wants
    every designer listed on the Sources page, add a paged credits route like `/api/audio-packs/{id}/credits`.
17. Ruling: **CLDR 49.0.0 annotations, Unicode License v3** (pinned, with the licence file hash) are an input of the
    mapping only; the notice is carried in the OpenMoji pack's notice — the issue asks for CLDR annotations — none.

## Numbers (built 2026-11-25)

| | OpenMoji pack | Mulberry pack |
|---|---|---|
| Upstream | 17.0.0, `openmoji-svg-black.zip` 3,702,558 bytes, 4,495 entries in `openmoji.json` | v3.6.1, `mulberry-symbols.zip` 52,347,398 bytes, 3,435 symbols |
| Concepts usable after the filters | 1,844 | 2,825 (of 3,435; 346 refused for non-drawing elements) |
| Pictures in the pack | 962, 1,695,283 bytes of SVG | 711, 4,595,865 bytes of SVG |
| Mapping rows (committed) | 3,172 (zh 1,936, ja 1,236; 92 manual) | 2,570 (zh 541, ja 2,029) |
| Basis | gloss 1,598, name+gloss 1,061, name 421, manual 92 | gloss 2,570 |
| Committed `map.tsv` | 129,649 bytes | 98,423 bytes |
| Seeded | `qinqin seed`: 962 pictures, 3,172 mappings | 711 pictures, 2,570 mappings |

Dictionaries read: CC-CEDICT 121,635 words, JMdict 30,173 priority words (of 219,051).

## File map

- `scripts/picture-match.mjs` (+ test), `scripts/images-lib.mjs` (+ test): matcher, upstream readers, TSV formats, pack assembly.
- `scripts/build-picture-map.mjs`: maintainer step that writes `scripts/images/<pack>/map.tsv` (`--report` writes the review lists).
- `scripts/prepare-images-pack.mjs`, `scripts/images-io.mjs`, `scripts/images/pins.json`: the pack builder and its pinned inputs.
- `server/internal/db/migrations/053_images.sql`; `server/internal/images` (import, validation, resolution, `CheckSVG`);
  `server/internal/pack` (type, format), `server/internal/packs/handlers.go`, `server/internal/api/handlers_images.go`, `server/cmd/qinqin/seed.go`.
- `apps/web/src/lib/api/images.ts` (`entryPicture`, `imagePacks`, `safeSvg`, `themeSvg`, `pictureCreditLine`), `lib/sources/imagesSection.ts`, `routes/sources/+page.svelte`.
- `docs/contracts/images/`, `docs/sources.md` ("Pictures"), `LICENSING.md`, wiki (Data-pack-format, Admin-data-packs, API-Reference, Data-and-licences), ADR 0008 note.
- `Dockerfile` (`images` stage), `.github/workflows/images-stage.yml`, `.gitignore`.

## Tasks

- [x] 1. Matcher: `normalizeGloss`, `normalizeLabel`, `foldKana`, `matchEntries` (tests first: 17 cases).
- [x] 2. Readers (CEDICT, JMdict, OpenMoji + CLDR, Mulberry CSV), TSV formats, manual overrides, pack assembly (10 cases).
- [x] 3. Pins with SHA-256; `build-picture-map.mjs`; `prepare-images-pack.mjs`; both packs built and imported.
- [x] 4. Migration, `images` package (import/uninstall/resolve/`CheckSVG`), type and format rows, handler row, seed order, staged-upload check.
- [x] 5. Routes `GET /api/images/entries/{id}`, `GET /api/image-packs`; route fixtures; handler tests.
- [x] 6. Web: `PackType`, labels, `entryPicture`, `themeSvg`, `safeSvg`, Sources section, strings; tests.
- [x] 7. Contract 8: folder, fixtures (Go and web run them), CHANGELOG, `version.json`, README rows.
- [x] 8. Docs: `sources.md`, `LICENSING.md`, wiki, ADR 0008, ROADMAP, this plan.
- [x] 9. Docker `images` stage, `QINQIN_PACKS`, CI stage workflow, Dockerfile tests, `check-sources` rule h.
- [ ] 10. Owner: confirm the ShareAlike position; review the 10% of doubtful rows; hand-review the Starter base sets (#214).

## Open questions for the owner

1. **ShareAlike position** (ruling 1): pictures in their own packs, served by the server, never compiled in or in the
   web build, MIT code unchanged. Confirm, in particular for an APK that has no server-side pictures.
2. **The HSK word list as a gate** for Chinese Mulberry rows (ruling 9).
3. **Quality bar:** roughly 1 in 10 automatic rows is doubtful; accept, or raise the threshold (fewer pictures)?
4. **Offline pictures** need a data package (ruling 5): schedule it with the Android work?
5. **Mulberry's colours** on dark themes (ruling 10): keep, or only OpenMoji until a colour setting exists?
6. **Per-designer credits** on the Sources page (ruling 16): needed?

## Not verified

- Nothing was drawn in a browser (no local browser automation by the owner's rule): `themeSvg` and the picture view are
  covered by string tests only; a picture UI does not exist yet.
- The Docker `images` stage was built here (962 and 711 pictures, the same bytes as the local build); the full image and
  CI on the merged state were not, and nor was a running server's `GET /api/images/entries/{id}` in a browser (the
  route is covered by Go handler tests, and the packs were seeded into a real database).
- The web full test run had two failing files only because `fake-indexeddb` is missing from the shared `node_modules`
  used here (`outboxStore.test.ts`, `outboxDurability.test.ts`); CI installs it.
- The 90% precision figure is one person's glance at 60 rows, not a benchmark.
- Sense numbers were checked against a real seed of CC-CEDICT and JMdict (97% consistent, none unresolved) but not against a
  second dictionary of a language.

## Review fixes (v0.8.0)

Independent review: a stored XSS through a pack's SVG (`<svg xmlns="http://www.w3.org/2000/svg"><!--><img/src="x"/onerror="alert(1)">--></svg>`:
XML reads one comment, the HTML parser closes `<!-->` at once and builds an `<img onerror>`), plus CSS `image-set`,
`u\72l(...)`, exponential nested `<use>` and a regex `safeSvg` that `<p><img ...>`, a quote-less attribute and
`animateTransform` got past. Branch `fix/v080-svg-security`.

1. Ruling: **The server stores and serves a re-serialised canonical form (`images.CanonicalSVG`), not the pack's
   bytes** — a gate that checks tokens and then keeps the original bytes can always be out-voted by a second parser (XML
   vs HTML); rebuilding from the parsed tree (strict element and attribute allowlist, no comment/PI/DOCTYPE, escaped
   text) leaves nothing for a second parser to read differently — a legitimate picture with an attribute outside the
   allowlist is refused at install (the CI stage run below catches it before a release; widen `allowedAttrs` in Go and
   `ATTRS` in `svg.ts` together).
2. Ruling: **A `style` attribute is converted, not refused outright** (declarations of paint properties become the
   attributes of the same name; any other declaration, `!important`, a backslash or a `url(` outside `#id` refuses the
   picture) — the real Mulberry file `carpenter_1a.svg` carries `style="fill:#ffeec8;fill-opacity:1"`; refusing it drops a
   picture for no gain, the converted output holds no `style` — cost if wrong: a CSS property added to the list later
   must be proven inert first (the list is short and paint-only). `<style>` elements stay refused.
3. Ruling: **`<use>` is bounded by structure, not by a depth counter**: at most 64 `<use>`, unique ids, and a `<use>`
   may not target a `<use>` or an element that contains one — that makes the expanded cost linear (nesting and cycles
   are impossible) — a pack that legitimately nests `<use>` is refused (none of the 1673 real pictures has any).
4. Ruling: **The web client parses with `DOMParser('image/svg+xml')`, walks the same allowlist and draws created nodes
   (`svgElement`, a Svelte action in `EntryPicture.svelte`); `{@html}` is gone** — nothing parsed from markup means no
   parser differential; `safeSvg` stays as the canonical string producer (same bytes as Go, pinned by `svg.json`) for
   callers that need a string — jsdom/browser XML parser differences from Go on exotic whitespace (Unicode spaces) are
   not pinned by a fixture; the server's canonical form contains none of it.
5. Ruling: **The route re-canonicalises what it reads and answers `{"picture": null}` for a stored picture that no
   longer passes** — packs installed before this change hold the pack's raw bytes in `image_pictures.svg`, and the
   install hash (`Hash`) only changes when the pack is re-imported — a deployment shows no picture until its images packs
   are reinstalled if a stored one is hostile; a clean one is served at once, canonical.
6. Ruling: **No `Content-Security-Policy`/`nosniff` on an image route: there is none.** The picture travels inside a JSON
   answer (`application/json`, drawn from created nodes), no URL ever serves an SVG document, so there is no document
   for a CSP `sandbox` to apply to — adding the header to the JSON route would protect nothing; should a route that
   serves `image/svg+xml` directly be added, it must send `default-src 'none'; style-src 'unsafe-inline'; sandbox` and
   `nosniff`.
7. Ruling: **`GET /api/images/entries/{id}` stays `noTok`** — audio routes take read tokens because external players
   fetch files with them; only the web app and the APK draw pictures, and the picture carries a BY-SA credit that the
   app shows — a read-token client (an exporter) that wants pictures needs a one-line `tokReadGlobal` change plus a
   contract line; documented in `docs/contracts/images/README.md`.
8. Ruling: **No contract renumbering** (stays 10; a CHANGELOG amendment to #216, `svg.json` version 2) — none of
   contract 8-10 is released, and a bump would touch the Android verifier and every concurrent branch — if the lead wants a
   number per change, bump `api.ContractVersion` and the heading in one commit.
9. Ruling: **CI runs the Go gate on the real packs** (`images-stage.yml` copies `/out` of the stage image and runs
   `TestBuiltPacks`; the workflow also triggers on `server/internal/images/**`) — a tightened `CanonicalSVG` cannot break
   seeding in a release image unseen — adds a Go toolchain to a workflow that was docker-only (about a minute).
10. Ruling: **`.dockerignore` excludes `plugins/data-images` and `plugins/upstream`** (both are gitignored local
    downloads and were sent to the build context); every `COPY` of the Dockerfile reads `plugins/data`, `scripts/`,
    `server/`, `apps/web/`, none of the two — if a stage needs one later, remove the line.

Numbers (built locally from the pins, `scripts/prepare-images-pack.mjs`): OpenMoji 962 and Mulberry 711 pictures, **1673
kept, 0 dropped** by the Go `CanonicalSVG` (`TestBuiltPacks`) and by the web `sanitizeSvg` (temporary run over the same
files). Attributes in the real files: `d fill stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit id cx
cy r xmlns viewBox height width points overflow class y x rx ry version transform stroke-dasharray clip-rule paint-order
stop-color fill-rule` and one `style`; elements `svg g path circle line polyline rect polygon ellipse` — all inside the
allowlist, so the canonicaliser needed no widening.

Not verified here: nothing ran in a browser (rule), so `svgElement` is exercised by jsdom's XML parser only; the
workflow change itself runs on CI only; a database that already holds old image rows was simulated by a handler test
(rows rewritten by `UPDATE`), not by an upgrade from a real earlier build.
