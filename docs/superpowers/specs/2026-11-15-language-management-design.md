# Language and Workspace Management — Design

Date: 2026-11-15
Status: written autonomously (decision rule: licensing first, then best UX even at higher
development cost); not yet reviewed by the owner. Issue: #41.
Depends on: `2026-11-15-pack-management-design.md` (#40) — its Data tab, its
`GET /api/admin/packs` list and migration 027 (`dictionaries.language`).

## Intent and why

qinqin is meant to teach more than Chinese and Japanese: any language can be added
as data only (a dictionary pack with no code pack). Today that works only by
accident — a pack import or a workspace creation silently inserts a `languages`
row — and nothing tells a learner why a workspace finds no words. The admin wants
to see which languages exist and where their data comes from, add a language on
purpose, and the learner wants to tune a workspace (which dictionaries it shows)
and be told plainly when a language has no dictionary or level lists. The
Spanish–English demo pack (`plugins/data/es-demo`, CC0, hand-written) must work
end to end as the proof.

## What exists today (develop @ 9667b2d)

- Code packs `zh`, `ja` live in `internal/lang` (`Register`, `Registered`, `For`);
  every other code uses `lang.Generic`. Data-only codes get a `languages` row
  (`code, name, updated_at`) on dictionary import (name = the pack's name, e.g.
  "Spanish–English demo dictionary") or on `POST /api/workspaces` by **any** user,
  with **no validation** of the code.
- `GET /api/languages` (public) returns only languages with live dictionary data,
  `{code, name, installed: true}`. The web labels languages from the code via
  `Intl.DisplayNames` (`languageLabel`) and never shows `name`.
- `WorkspaceCreateForm` offers installed languages plus the user's existing ones.
- Workspaces have a `settings` JSON object; `PUT /api/workspaces/{id}` merges it
  (RFC 7396, 64 KiB cap). The web stores nothing there yet.
- Settings → Workspaces: list, rename, delete, create (done: 872e497, a4fc932).
- Senses carry `dictionaryId` everywhere: entry page (`Senses.svelte`), reader
  lookup (`lib/plugins/reader/entryDisplay.ts`, `EntryCard.svelte`).
- `GET /api/lookup` rejects languages without a code pack (400 "unsupported
  language"), so the reader popup cannot work for `es`; search and entry pages do.

## Goals

1. **Languages** section in Settings → Data (admin): every known language —
   code packs and data-only — with code, label, kind ("built-in" / "data only"),
   the packs that provide it (from `GET /api/admin/packs`), and workspace use.
2. **Explicit registration** of a data-only language by code, and removal of an
   unused one (no packs, no entries, no workspace).
3. **Per-workspace dictionary visibility:** in Settings → Workspaces, each
   workspace can hide dictionaries of its language from entry pages and lookups.
4. **Coverage hints:** a workspace whose language has no dictionary, or no level
   lists, says so in Settings and on the Search page, with the next step (admin:
   "Install one in Settings → Data"; others: "Ask the administrator").
5. The **Spanish–English demo** works from the UI: install `es-demo` → Spanish
   listed with its pack → create a Spanish workspace → search `hola` → entry with
   "hello, hi" → hide/show the dictionary → uninstall → hint appears.

## Non-goals

- Reader lookup, segmentation, readings or romanization for data-only languages
  (`/api/lookup` stays code-pack-only; recorded as a risk).
- Gloss-language selection (es-demo glosses are English; every pack has one).
- Other per-workspace defaults beyond dictionary visibility; feature plugins keep
  their own settings in plugin data.
- Renaming a language or storing a display name: labels stay `Intl`-derived.

## Anti-goals

- A workspace whose entries render empty because every dictionary is hidden.
- Registering garbage codes (`"  Hello!"`, 200-character strings) by any user.
- A hint that blames the learner or links a non-admin to a page they cannot open.

## Approaches considered

- **Dictionary visibility, server-side filter:** lookup, search and entry reads
  take the workspace's hidden list and drop senses; correct ranking, but touches
  the lookup service, search and entry view and every client.
- **Client-side filter (chosen):** settings store `hiddenDictionaries` (dictionary
  ids); the web collapses hidden senses behind "N more from hidden dictionaries"
  in the two places senses render. No server change, reversible per view.
- **Global per-user toggle** (the existing no-op Plugins toggle): not per
  workspace, and two zh workspaces may want different sets.

Ruling: client-side filter with a disclosure — no server change, entries never
vanish, matches "per workspace" — cost if wrong: hidden senses still affect
lookup ranking; a server filter can be added later behind the same setting.

## Design

### Server

- `lang.Codes() []string` (sorted code-pack codes) and `lang.ValidCode(s) (code
  string, ok bool)`: trim, lowercase, `_`→`-`, must match
  `^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$`. `POST /api/workspaces` answers `422`
  "language must be a code like es or pt-br" for invalid codes. A **non-admin**
  may only create a workspace for a known code (code pack, `languages` row,
  installed, or any live level, frequency, sentence, grammar or audio pack). A
  request code that exactly matches (lowercased, before the `_`→`-` rewrite) a
  stored row or installed code keeps its spelling, so a legacy `pt_br` is not
  split into `pt-br`. Manifest languages must be normalized codes at import; an unknown valid code is `422` "unknown language — ask the
  administrator to add it". Only an admin's workspace creation still
  auto-registers a new code (as today), so registration is admin-only in fact.
- Existing rows are left as stored (no migration). The Languages view lists a
  stored code that `ValidCode` rejects with "not a valid code" and offers Remove
  when unused; `DELETE` matches the stored code exactly (lowercased path value, no
  `_`→`-` rewriting) so such rows stay removable.
- `GET /api/languages` (still public) returns the union of code packs, `languages`
  rows and installed languages: `{code, name, installed, kind: "code"|"data"}`,
  sorted by code. `installed` keeps its meaning (live dictionary data).
  `ensureDefaultWorkspaces` keeps using installed languages only.
- `GET /api/dictionaries` rows gain `packId` and `language` (from migration 027).
- `POST /api/admin/languages {code}`: invalid `422`; a code pack `409` "zh is
  built in"; existing row `200`; new row `201` (name = code). Body cap 4 KiB.
- `DELETE /api/admin/languages/{code}`: code pack `409`; unknown `404`; `409`
  "still used by: <kinds>" (for example "2 workspaces, a sentence pack"; kinds
  only, never users) when the language is *installed* (a live sense in a live
  dictionary on a live entry — entries orphaned by an uninstall do not count), or
  a live scheme (level list), frequency, sentence, grammar or audio pack has it,
  or a legacy pack's live sentence sits on an entry of that language, or any
  user's workspace uses it; else `204`. The row is deleted by one statement that
  re-checks all of these, and the stored code is matched by the exact path value
  first, then lowercased. Entries left behind by uninstalled packs stay (they carry no
  glosses and are invisible without senses).
- `GET /api/admin/languages/usage` → `[{code, workspaces}]` (count of workspaces of
  all users per language) for the Languages view; admin-only.

### Web

- `Language` type gains `kind`; `languageOptions` (today: installed and the
  user's own codes, merged and sorted by label) gains a `hasDictionary` flag per
  option, and the create form appends " (no dictionary installed)" to those
  without one. The sort stays by label.
- `lib/workspaces.ts`: `updateSettings(id, patch)` (PUT, updates the store).
- `lib/dictionaryVisibility.ts` (pure, tested): `hiddenDictionaries(ws):
  Set<number>` (ignores malformed values), `partitionSenses<T extends
  {dictionaryId: number}>(senses: T[], hidden) → {shown, hidden, allHidden}` over
  a **flat** sense list, order kept; when every sense would be hidden, `shown` is
  all of them and `allHidden` is true (note: "Shown although its dictionaries are
  hidden in this workspace").
- `Senses.svelte` (entry page, current workspace) partitions before grouping. The
  reader `EntryCard.svelte` gets a new prop `hidden: Set<number>` from
  `PopupFrameView`, computed from the **book's** workspace (`study.workspaceId`,
  looked up in the workspaces store; the current workspace when absent), and
  partitions before `shownSenses` and the "N more senses" cap. Both show a
  "Show N from hidden dictionaries" button that reveals them in place.
  Flashcard faces are not filtered (the card is the learner's own content).
- `lib/coverage.ts` (pure, tested): `coverage(language, dictionaries, schemes) →
  {dictionaries: n, levels: n}` and `coverageHint(cov, label, admin)` strings.
- Settings → Workspaces row: chips "No dictionary" / "No level lists" when zero,
  and a **Dictionaries** button opening an inline panel: one checkbox per
  dictionary of the workspace's language ("Show in entries and lookups"), name,
  version, Save / Cancel, the hint when there are none.
- Search page: a `role="status"` hint above results when the current workspace's
  language has no installed dictionary.
- `lib/settings/LanguageManager.svelte` in Settings → Data under Packs: table of
  languages (label, code, kind, packs as "name (type)", workspaces count,
  Remove for removable data-only rows), and a form "Add a language" (code input
  with pattern help and a live `languageLabel` preview, e.g. `pt-br` → "Brazilian
  Portuguese"). Registration explains: "Adds the language to the workspace
  list. It has no dictionary until you install a pack for it."

```
Workspaces
 [ES] Spanish   current   No level lists   [Dictionaries] [Rename] [Delete]
   Dictionaries shown in this workspace
   [x] Spanish–English demo dictionary 1.0                [Save] [Cancel]
```

## Constraints

- Builds on the #40 branch (migration 027, Data tab, packs list); no migration of
  its own. Go 1.26, no new deps; Svelte 5 runes, no new npm deps.
- `hiddenDictionaries` lives in workspace settings, so it syncs with the workspace
  row; the Android client may ignore it.

## Rulings

- Ruling: store dictionary **ids** in `hiddenDictionaries` — every sense (entry and
  lookup) carries `dictionaryId`, and a reinstall revives the same row by pack id —
  cost if wrong: a pack id would need a server change to lookup senses.
- Ruling: validate language codes on workspace creation too — any user can
  currently create global `languages` rows with arbitrary text — cost if wrong: an
  exotic but valid tag longer than the pattern is refused (extend the pattern).
- Ruling: `GET /api/languages` lists non-installed known languages with
  `installed: false` instead of a new endpoint — the field exists for this and the
  create form needs it — cost if wrong: on a server without data the create form
  offers Chinese/Japanese marked "(no dictionary installed)".
- Ruling: removal only when nothing uses the code — registering by mistake must be
  undoable, but deleting a language under live data would orphan it — cost if
  wrong: an admin must uninstall packs first.
- Ruling: no stored language names — labels come from `Intl.DisplayNames`, the
  stored name is often a pack title — cost if wrong: a rare code shows as the code.
- Ruling: the reader stays code-pack-only for data-only languages — generic
  segmentation is its own project — cost if wrong: the demo shows search and
  entries and flashcards but no reading (the reader's upload already offers only
  zh and ja, `lib/plugins/reader/uploadLanguage.ts`).
- Ruling: non-admins create workspaces only for known codes — otherwise
  "explicit registration" is admin-only in name — cost if wrong: an API or
  Android client creating a new language as a learner gets a 422.
- Ruling: "still used" means installed data, live packs or workspaces, not
  orphaned entries — uninstalling a pack must make the language removable —
  cost if wrong: glossless entries of a removed code linger in the database.
- Ruling: the reader filters by the book's workspace — a book belongs to one
  workspace, which may differ from the header's — cost if wrong: none.
- Ruling: Languages view lives in the admin Data tab — registration is global —
  cost if wrong: non-admins see languages only through the create form.

## Left to the builder

Copy beyond the quoted strings, CSS, the exact chip style, the table vs. card
layout on phones, and whether usage counts come from one query or several.
