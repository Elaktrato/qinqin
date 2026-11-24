# Project layout

Where things live in the repository ([github.com/Elaktrato/qinqin](https://github.com/Elaktrato/qinqin)). How to build and test: [Development](Development).

| Path | Contents |
|---|---|
| `server/` | The Go server: the `qinqin` command (`cmd/qinqin`: `serve`, `seed`, `adduser`, `recover`, `backup`) and its packages under `internal/` |
| `server/internal/api` | HTTP routes and handlers: they decode, authorise, call a domain package and answer (no SQL here); the route table is in `api.go` |
| `server/internal/workspaces`, `lang` | Workspaces (create, list, rename, delete with everything in them); the language rules and the language registry |
| `server/internal/db` | SQLite access and the embedded migrations |
| `server/internal/pack`, `dict`, `freq`, `packs`, `lexicon` | Pack manifests and the pack-type table, importers (dictionaries, frequency lists, the per-type dispatch), the lexicon store |
| `server/internal/lookup`, `segment` | The lookup engine and the tokenizer |
| `server/internal/datapkg`, `sync` | Data packages (ids, writers, builder, registry) and the paged sync pull |
| `server/internal/auth`, `ratelimit`, `secretbox`, `netguard` | Accounts, sessions, two-step sign-in and tokens; throttling; sealing with `QINQIN_SECRET`; the outbound address guard |
| `server/internal/ai`, `journal`, `mail`, `i18n` | AI providers, journal photos and OCR, the mail queue and its catalogue (`mail/messages/`), the Go message formatter |
| `server/internal/plugins` | The plugin manifest contract and the built-in manifests (`plugins/builtin/*.json`) |
| `server/internal/webdist` | The embedded web app |
| `apps/web/` | The SvelteKit web app (adapter-static, a single-page app); catalogue in `src/lib/i18n/messages/`, the service worker in `src/lib/pwa/sw/`, settings screens in `src/lib/settings/`, the rules of which pages need a sign-in in `src/lib/routeAccess.ts`, core features in `src/lib/features/` |
| `plugins/data/` | Bundled seed packs (dictionaries, the Jiten frequency list, the level lists, the KanjiVG component index, the demos) with their licences and attribution notices; `plugins/data/README.md` documents the formats |
| `plugins/data-local/` | Gitignored: local-only packs with unclear or restrictive licences |
| `plugins/data-strokes/`, `plugins/data-audio/`, `plugins/data-fonts/` | Gitignored: the built stroke pack, fetched audio packs and built font packs |
| `plugins/samples/` | Hand-written samples, not seeded by default: dictionaries `zh-mini` and `ja-mini`, level packs `hsk-mini` and `jlpt-mini` (`qinqin seed --packs plugins/samples`) |
| `docs/contracts/` | The client contracts with their JSON fixtures ([API overview](API-Overview#contracts-for-client-implementers)) |
| `docs/architecture/` | The [architecture records](https://github.com/Elaktrato/qinqin/tree/develop/docs/architecture): the rules of the code's structure and how each is enforced ([Development](Development#architecture-records)) |
| `docs/sources.md` | The data sources and licence decisions |
| `docs/wiki/` | The source of this wiki |
| `docs/releases/` | Release notes, used as the GitHub Release text of each tag |
| `docs/git-flow.md`, `docs/release-checklist.md`, `docs/ROADMAP.md` | Branching, the pre-release browser checklist, the roadmap |
| `docs/superpowers/` | Design specs, plans and handoffs of past work |
| `docker-compose.yml`, `Dockerfile` | The one compose file (plain compose and Portainer) and the image build |
| `.github/workflows/` | `build.yml` (tests, image, release), `audio-stage.yml` (the audio build stage) and `wiki.yml` (publishes `docs/wiki/` to the wiki) |

## Scripts

| Script | Use |
|---|---|
| `scripts/fetch-seeds.sh` | Refreshes the bundled upstream dictionaries (and, through `fetch-jiten-frequency.sh`, the Jiten list: a manual, licence-checked step) |
| `scripts/fetch-kanjivg-components.sh` | Rebuilds the bundled KanjiVG component index from the pinned KanjiVG tag (manual, licence-checked) |
| `scripts/prepare-ids-components.mjs` | Prepares a local-only Chinese components pack from an IDS file |
| `scripts/prepare-level-packs.mjs` | Rebuilds the approximate JLPT kanji pack from the pinned kanjiapi.dev file and the bundled KANJIDIC2 (`--calibrate` prints the evaluation of its gap-fill thresholds); `--jlpt-vocab` generates the optional local-only JLPT vocabulary pack |
| `scripts/prepare-standard-levels.mjs` | Regenerates `joyo-grades` and `tgh-chars` from the bundled KANJIDIC2 and Unihan (no network) |
| `scripts/prepare-local-levels.mjs` | Converts a TSV you prepared (TBCL, curriculum tables, any private list) into a local-only level pack under `plugins/data-local/`; writes no `LICENSE`, refuses other directories |
| `scripts/prepare-hsk-syllabus.mjs` | Rebuilds `hsk-words` and `hsk-chars` from the official syllabus PDF's `pdftotext -tsv` output (steps in its header; the inputs are never committed) |
| `scripts/prepare-strokes-pack.mjs` | Builds the stroke-order pack from the pinned `hanzi-writer-data` package |
| `scripts/prepare-font-pack.mjs` | Builds a hanzi/kanji font pack from a pinned upstream face (needs `npm --prefix scripts/fonts ci`) |
| `server/tools/tatoeba` | Builds the example sentence packs `zh-sentences-tatoeba` and `ja-sentences-tatoeba` from a pinned Tatoeba export (`go run ./tools/tatoeba pin`, then `build`, from `server/`; rules in `rules.json`; see [Data and licences](Data-and-licences#example-sentences-tatoeba)) |
| `scripts/fetch-audio-kanjialive.sh`, `prepare-audio-kanjialive.mjs`, `fetch-audio-commons.mjs` | The Kanji alive audio pack (used by the image build) and local-only Commons audio |
| `scripts/check-sources.mjs` | Checks that pack manifests (`license`, `attribution`, `notice`) and `docs/sources.md` agree; run in CI |
| `scripts/check-archives.sh` | Checks that the committed seed archives are readable and match the checksum manifest |
| `scripts/gen-api-docs.mjs` | Generates the wiki's [API routes](API-Routes) and [API errors](API-Errors) pages (`--check` fails when they are stale) |
| `scripts/smoke-embed.sh` | Builds the real binary with the real web app and checks it through HTTP (CI) |
| `scripts/smtp-sink.py` | A local mail sink for testing |
