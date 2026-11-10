# Chinese Learning Platform ("qinqin") — Design

Date: 2026-11-10
Status: agreed in conversation, builder check done; awaiting owner approval.

## Intent and why

A personal, self-hostable Chinese learning platform that the owner can reshape
themselves. Three deliverables: a Go backend, a SvelteKit web frontend, and a
Flutter mobile app (Android + iOS). Pluggability is the core value: dictionaries
and other content arrive as user-installable **data plugins**, while widgets,
views, and behaviors are **feature plugins** the owner maintains personally.
The owner studies on mobile without reliable connectivity, so the mobile app is
offline-first. Success = the owner actually uses it daily (the home heatmap
proves it) and can add a dictionary or a widget without touching core code.

## Goals

- **Hanzi view**: simplified + traditional forms (linked), all readings in
  pinyin, bopomofo, radical(s) with links to a radical page, stroke count,
  stroke-order animation, example words (linked), meanings with per-dictionary
  source tags, level badges.
- **Word view**: simplified + traditional, pinyin + bopomofo, per-dictionary
  tagged meanings, example sentences (from packs or user-added), level badges,
  per-character links into hanzi views.
- **Radical page**: a hanzi-view variant listing all characters under a radical.
- **Dictionaries as data plugins**: import from JSON (canonical) and CC-CEDICT
  native format; user-editable; multiple active dictionaries with meanings
  tagged by source in every list.
- **Level schemes as data plugins**: independent namespaces ("HSK 3.0 (2021)",
  "HSK (2012)", "义务教育 Middle School Grade 1", "TOCFL"); entries can carry
  tags from any number of schemes; browse/search filters by scheme + level.
  Word-based schemes (HSK) derive a character list at import (a character
  gets the lowest level whose words contain it), so hanzi carry HSK badges —
  computed at import, never silently at query time.
- **Feature plugins**: home widgets, full views, behaviors. First plugin: the
  home-screen consistency heatmap. Second (follow-up design round): flashcards
  + hanzi map.
- **Offline-first mobile**: full local database, sync when connectivity
  returns.
- **Small-scale multi-user**: a handful of accounts; instance-wide content,
  per-user edits and study data.
- **Self-hostable**: one deployable artifact.

## Non-goals (this phase)

- Flashcards / SRS and the hanzi map — separate design round after core
  ships. (The study-event schema is designed so the SRS engine can consume it.)
- Plugin marketplace / online registry. Plugins install from local files.
- PWA. Roles/permissions machinery beyond admin vs user.
- Audio pronunciation (candidate for a future data pack).

## Anti-goals

- Mobile plugin system requiring runtime-downloaded native code (impossible on
  iOS anyway — see Approaches).
- A plugin architecture that only works on one client (web-only plugins would
  gut the point).
- Hosted/metered cloud dependency; the server must run on a Raspberry Pi.

## Constraints

- Backend: Go. Single binary + SQLite, serves the web UI itself
  (go:embed of the SvelteKit SPA build).
- Deployment target: Docker image + docker-compose stack for a Portainer
  instance (single service, no external database).
- Web: SvelteKit in SPA (adapter-static) mode; no SSR/SEO needs.
- Mobile: Flutter, Android + iOS, SQLite (drift) local store.
- Open data for seeding:
  - CC-CEDICT (~120k word entries, CC BY-SA 4.0) — dictionary seed.
  - Make Me a Hanzi (stroke graphics + medians for ~9k simplified and
    traditional characters, Arphic Public License) — stroke-order animation
    data; rendered natively on web (Hanzi Writer) and Flutter (CustomPainter
    or a port).
  - Unihan (kRSUnicode, kTraditionalVariant/kSimplifiedVariant, kDefinition)
    — radical and simp/trad mappings, plus per-character English glosses via
    kDefinition as the built-in character dictionary (CC-CEDICT
    single-character entries supplement it).
  - HSK 2012 and HSK 3.0 (2021) word lists as level-scheme packs; mainland
    curriculum character tables; TOCFL if data is at hand. New editions
    (e.g. a 2026 HSK revision) are just new packs — no code change.
  - Example-sentence packs (e.g. Tatoeba-derived, keyed to words), plus
    user-added sentences.
- Licenses require attribution: the app must surface source + license per
  dictionary/scheme (the per-source tagging UI does double duty here).

## Approaches

### Client stack

- **A. React Native + React web** — one TS plugin SDK, one language; rejected:
  the owner wants best-of-breed native apps.
- **B. Flutter for mobile *and* web** — one Dart plugin SDK; rejected: Flutter
  web is permanently a second-class web app.
- **C. Flutter mobile + SvelteKit web (CHOSEN)** — native-grade on both
  surfaces; feature plugins are implemented twice (Svelte + Dart), accepted by
  the owner: AI assistance makes dual maintenance cheap for a small
  personally-maintained plugin set. Mitigation: the plugin **contract** —
  manifest format, API surface, data schemas — is defined once in the backend;
  only rendering code is duplicated.

### Frontend framework

Astro considered and dropped before the choice above: flashcards (and the
dictionary's interactive views) make this an app, not a content site; islands
would mean building an SPA inside a static-site shell. SvelteKit over Next:
fits best-of-breed philosophy, superior built-in transition/animation
primitives (flashcard flips, stroke animations), lighter for a non-SEO app.

### Mobile feature-plugin loading

- **Runtime-downloaded native code** — impossible: Apple App Store rule
  2.5.2 forbids executing downloaded code; Flutter AOT has no dynamic loading.
- **Embedded JS engine with a native bridge** — possible (flutter_qjs) but a
  large complexity driver and a second plugin language; rejected for now.
- **Compile-time plugin registry (CHOSEN)** — plugins are real modules
  (packages/components) following the plugin contract; a registry file lists
  them; adding one = rebuild. Acceptable for personally-maintained plugins.
  Data plugins remain fully runtime-installable. Web runtime-serving can be
  added later without changing the contract.

### Sync model

- Full offline-first with append-only study events (CHOSEN) vs
  cache-last-viewed online app — owner confirmed offline use is real.
- Study events: append-only, client-generated ids (ULID + device id), merged
  trivially, idempotent by event id. Never conflict.
- User edits (per-user overlays on entries/sentences): last-write-wins per
  entity on `updated_at`; acceptable at household scale. Mobile entry-editing
  is deferred to a later phase: phase-3 mobile pushes study events and
  plugin-owned data only; entry-edit push from mobile arrives with the future
  editing phase.
- Pull: delta cursors (`updated-since`) for entries, plugin data, scheme
  membership; plugin data versioned by plugin version. First sync replicates
  the full database (~100–200 MB with CC-CEDICT) — acceptable for a personal
  device; a pack-subscription model can come later if it ever matters.
- Deletions propagate: soft-deletes/tombstones from day one, so uninstalling
  a dictionary or a changed re-import removes its senses/level tags across
  all clients, and views degrade gracefully (a badge or sense disappears,
  the entry stays).

## Decided design

### Backend (Go)

- SQLite via a thin data layer. Tables (indicative): users, sessions,
  dictionaries (source registry), entries (hanzi + words unified with a kind
  field), senses (per dictionary, per entry), entry_links (radical/word
  cross-links precomputed at import), level_schemes, levels, level_members,
  sentences, sentence_links, user_edits (overlay, per user, per entity),
  study_events (append-only), plugin_registry, plugin_states (per-user
  enable/disable + ordering), plugin_data (per-plugin, per-user owned data,
  versioned, tombstoned).
- **Entry identity**: one entry per written form. Simplified and traditional
  are separate entries linked as variants (Unihan variant mappings are
  many-to-many, and stroke data differs per form). Views pair the forms for
  display; IDs, links, level tags, and overlays attach to the concrete form.
- JSON REST API, token auth. Admin vs user role only.
- Bopomofo derived from pinyin at import/serve time (deterministic
  transliteration incl. tone marks), cached on the entry.
- Import pipeline: parse pack → validate manifest → upsert entries/senses →
  precompute links (radical via Unihan, words-containing-character) → derive
  bopomofo → version the pack.

### Data plugins

A directory or zip with `manifest.json`:
`{ id, name, version, type: dictionary|levels|sentences, license, attribution, format }`
plus data files (JSON/JSONL canonical; CC-CEDICT-format importer for the
seed). Installed via upload (admin) or a watched directory. Instance-wide.
Re-import on version bump; user edits are overlays so re-imports never
destroy user work.

### Feature plugins

Manifest: `{ id, name, version, surfaces: [home-widget | view | behavior],
permissions: [read:entries | read:study-events | ...] }` plus a rendering
module per platform (Svelte component; Dart package implementing the plugin
interface). Plugins may declare **owned data** (`owns-data`): the backend
hosts a generic per-plugin, per-user data store with versioned, tombstoned
sync — in the contract from phase 1, because the flashcard plugin's
decks/cards will live there, and retrofitting it later would be the design's
most painful change. Host apps expose a **Plugin SDK**: data queries scoped by declared
permissions, navigation into core views (open hanzi/word by id), and slot
registration (home widget grid, view routes, behavior hooks such as
`on-study-event` for the future SRS). First plugin: **heatmap** — aggregates
study events (session/view/lookup now, review events later) into a
GitHub-style consistency grid on home, identical data logic on both clients,
two rendering layers.

### Study events (designed for the future SRS)

Generic append-only log: `{ id (ULID), user, device, ts, type, payload }`.
Initial types: `session`, `view`, `lookup`. The flashcard round adds `review`
events; the SRS scheduler will live in the backend, plugins provide card
faces/deck behaviors — not the scheduling itself.

### Plugin management

The backend registry is the source of truth. Feature-plugin manifests are
installed web/backend-side (admin). Each user enables/disables plugins and
orders their home slots (per-user plugin state, synced to all clients). The
mobile app reconciles against the registry on start: enabled and contained in
the build → rendered; in the registry but not in the build → hidden from
home, shown as "needs app update" in plugin settings. Adding *new
feature-plugin code* to mobile still requires the owner to add the module and
rebuild — the registry governs state, not code. Data plugins install at
runtime, no rebuild ever.

### Clients

- Web (SvelteKit SPA): search (hanzi, pinyin with/without tones, zhuyin,
  meaning, level filters), hanzi/word/radical views, entry editing UI,
  plugin slots on home. Served by the Go binary.
- Mobile (Flutter): same views, offline-first SQLite store, background sync
  (push study events + plugin-owned data, pull deltas; entry-edit push
  arrives with a later phase), plugin slots on home + per-user plugin
  enable/disable/ordering honored. State management and DI approach =
  builder's call.

### Repo layout

```
server/            Go backend (API + web host)
apps/web/          SvelteKit SPA
apps/mobile/       Flutter app
plugins/data/      seed packs (cedict, mmah, hsk-2012, hsk-3.0, curriculum)
plugins/feature/   heatmap (+ future: flashcards)
docs/
```

### Deployment

Docker-first for Portainer: a `docker-compose.yml` stack — one service, no
external database — with a volume for `/data` (SQLite file, plugin pack
directory, uploaded packs). Multi-stage Dockerfile builds the SvelteKit SPA
and the Go binary (web UI embedded via go:embed) into a single minimal final
image (distroless or alpine). A healthcheck endpoint for Portainer; image
published to GHCR with version tags so Portainer/Watchtower can pull updates.
TLS is left to the user's reverse proxy (NGINX/Traefik, whatever the Portainer
setup already uses); the app speaks plain HTTP behind it.
### Build order (each phase usable on its own)

1. **Backend**: schema, auth, REST API, data-plugin ingestion, seed imports,
   edit overlays, event log. Done = seeded API, curl-able.
2. **Web**: core views, search, editing, plugin host + heatmap.
3. **Mobile**: offline store, sync, core views, plugin host + heatmap.
4. **Flashcards + hanzi map**: new design round before implementation.

## My calls (made without asking; reject any)

- Small-scale multi-user, admin/user roles only.
- SQLite on both ends; single binary + go:embed web hosting.
- Docker + compose stack (Portainer) as the deployment target; GHCR
  publishing, `/data` volume, TLS via the user's reverse proxy.
- Compile-time feature-plugin registry on mobile (and web, initially);
  plugin *state* managed backend-side, mobile reconciles on start.
- Mobile entry-editing deferred to a later phase (web-only initially).
- LWW edits + append-only events for sync.
- Generic plugin-owned data store in the phase-1 contract.
- Unihan kDefinition as the built-in character-gloss dictionary.
- One entry per written form; variants linked, views pair them.
- Tombstones/soft-deletes for deletions across sync, day one.
- Full replication on first mobile sync.
- Word-based level schemes derive character lists at import.
- Bopomofo derived from pinyin, cached.
- TOCFL supported as just another scheme pack.
- SvelteKit (not Next) for web.

## Left to the builder

- Exact DB schema, migration strategy, and API endpoint list.
- Manifest JSON Schemas (data + feature) and the Plugin SDK method surface.
- Heatmap visual design and its metric definition (what counts as a "day
  studied").
- Flutter architecture details (state management, sync queue implementation).
- Stroke-order renderer choice on Flutter (CustomPainter vs existing port).
- Test strategy: TDD for sync, import pipeline, and overlay logic; lighter
  UI coverage.
