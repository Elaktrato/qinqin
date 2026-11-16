# Personal notes and mnemonics on entries — design (issue #77)

Status: Draft (2026-11-16), v0.3.0 stretch item 3. Written unattended; every non-obvious call is a
**Ruling** (`what — why — cost if wrong`). Nothing is built. Owner direction: "#77 personal notes and
mnemonics on entries (per user, per workspace; included in the backup export, item 5)". The issue has no
comments; #13 (closed) was read for the overlay revert history.

## Intent and why

A learner wants to keep a mnemonic ("马 looks like a horse with four legs"), a usage warning or a
memory hook next to a word, and see it again when the card's answer is shown. Today the only per-user
text on an entry is the edit overlay (written form and readings), which is the wrong place: it replaces
dictionary data, while a note adds to it.

## Goals

- One free-text note per (user, workspace, entry): add, edit, delete on the entry page.
- Shown on the flashcard answer side (every card kind, after the answer is revealed), with a
  per-workspace switch to hide it there.
- Synced to other devices (web tabs today, Android later) with the existing last-write-wins rules.
- Exported in the personal backup and restored with the entry id remapped, on the same or another server.
- Safe rendering: a note can never inject markup or script.

## Non-goals (v1)

Markdown or rich text, links, images or attachments (the row shape leaves room), search over notes, a
"all my notes" list page, notes on sentences or books, sharing notes between users, notes shown on the
card's front side, a server-side note API. Decks get no per-deck switch.

## Questions answered

**1. Overlay field or plugin data?** Plugin data.

- Ruling: notes are plugin data rows of the built-in `qinqin-core` plugin, key `note:<entryId>`,
  workspace-scoped — the overlay is the wrong container: `overlay.Put` replaces the whole `user_edits`
  row on every editor save (an editor save or a revert-to-shared, #13, would erase or have to carry the
  note), the overlay is per (user, entry) with no workspace (the owner asked for per workspace), it has
  no tombstone (a revert is an all-NULL row kept forever), and its LWW is per row, so a note edited on one
  device and a reading edited on another would overwrite each other. Plugin data already has per-key
  LWW with the client's edit time (`modified_at`), tombstones, the 256 KiB value cap, the sync
  pull/push collections Android will implement, generic export, and generic routes with user and
  workspace isolation — cost if wrong: a later move to a table is a one-off migration of rows.
- Ruling: plugin `qinqin-core`, not `qinqin-flashcards` — notes belong to the entry page, which works
  with the flashcards plugin switched off; `qinqin-core` declares `owns-data` and cannot be switched off
  — cost: the backup remap gains a second plugin id it inspects.
- Ruling: no new HTTP route; the web app uses `GET/PUT/DELETE /api/plugins/qinqin-core/data/note:<id>`
  and `GET /api/plugins/qinqin-core/data?prefix=note:` with `?workspace=` (all existing, all tested for
  user isolation) — no route fixture, PWA classification or API wiki change — cost: no server-side
  validation of the text (see 4).

**2. How is a note keyed so that restore and Android sync stay correct?** Entry ids are server-local.
Sync is always against one server, so the id is stable there, exactly like `card:*` rows (`entryId`) —
a pack re-import keeps entry ids for the same reasons cards rely on. Restore is the only place ids
change. Today `backup.Maps.PluginRow` rewrites only `qinqin-flashcards` `card:*` and `vacation:*`; any
other row keeps its key and data byte for byte. A `note:1201` row restored onto another server would
silently annotate whatever entry has id 1201 there. So:

- Ruling: the row holds the id twice: key `note:<entryId>` (decimal, no leading zero) and
  `data.entryId`; a reader ignores a row whose two ids differ — the key gives one row per entry (no
  duplicates by construction, per-key LWW), the data field lets the remap and Android parse without
  string games — cost: one redundant integer.
- Ruling: export records `data.entryId` of every live `note:*` row in `refs/entries.json` (like cards),
  restore maps the entry, rewrites key and `entryId` together, and drops the note when the entry is
  unresolved (never guessed, like cards); the dry-run report counts it per unresolved entry (`notes`) —
  cost: a note on a word the target server lacks is lost, which the report says before applying.
- Ruling: two archive notes whose entries map to the SAME target entry (possible through the
  written-form fallback) do not block the restore (cards do): the note with the newest
  `modifiedAt ?? updatedAt` wins, ties by the smaller source key; the loser counts as dropped — a
  blocked restore for two notes would be worse than losing the older one — cost: one note lost in a
  rare case, visible in the report's dropped count.

**3. Shape of the row.**

```json
key  "note:1201"                 plugin "qinqin-core", workspaceId <ws>
data {"version": 1, "entryId": 1201, "text": "Horse: four dots are the legs.\nNot 吗."}
```

- Ruling: a note is absent when the row is missing, tombstoned, not an object, `version !== 1`,
  `entryId` is not a positive integer equal to the key's number, or `text` is not a non-empty string
  after trimming — one strict rule all clients share (fixture `notes/note-rows.json`) — cost: a future
  `version: 2` note is invisible to this build (a v2 bump would come with a reader update first).
- Ruling: on save, members other than `version`, `entryId`, `text` that the row already holds are kept
  verbatim (like `deckcfg:*`) — leaves room for images later without an old client erasing them — cost:
  none.
- Ruling: no `updatedAt` inside `data`; the row's own `updatedAt`/`modifiedAt` are the times — cost:
  the UI shows no "edited on" date in v1.

**4. Plain text or limited markdown? Length cap?**

- Ruling: plain text with line breaks — rendered by Svelte text interpolation (`{text}`) in an element
  with `white-space: pre-wrap; overflow-wrap: anywhere`, never `{@html}`, no autolinking — markdown needs
  a sanitizer on every client (Android too) and is a must-fix XSS area; the user's own text is the
  only input, but a restored or synced row is still untrusted bytes — cost: no bold or lists (line
  breaks and "- " typed by hand cover mnemonics).
- Ruling: cap 2,000 characters (Unicode code points, `Array.from(text).length`), checked by the
  editor (counter, Save disabled above it); no server check — one cap rule for every client in the
  fixture; the server cap stays the generic 256 KiB, and an oversized note only ever reaches its own
  author — cost: a script can store a longer note; readers show it whole and the editor asks to shorten
  it before saving.
- Ruling: normalising on save: `\r\n` and `\r` become `\n`, trailing whitespace of the whole text is
  trimmed (inner spaces and blank lines kept); text that is empty after this deletes the note — cost:
  none.

**5. Delete semantics.** Ruling: Delete is `DELETE .../data/note:<id>` (the server tombstones the row,
so other devices learn it by pull); saving empty text is the same delete; a later save revives the key
(server behaviour of PUT) — one path, no special "empty note" state — cost: none. The entry page asks
inline ("Delete this note? Delete / Keep"), no undo.

**6. Where the note is shown.**

- Entry page (`/entry/[id]`): a "Your note" section under the senses for the current workspace. No note:
  an "Add a note" button. With a note: the text, Edit and Delete. Editing: a textarea (prefilled), a
  `n / 2000` counter, Save, Cancel. Esc cancels; save errors show inline and keep the draft. Hidden
  while the entry editor is open and when there is no current workspace.
- Ruling: the note is read and written in the CURRENT workspace even when the entry's language differs
  from the workspace's — the same rule as Add to study (cards go to the current workspace) — cost: a
  note added to a Japanese word while in a Chinese workspace lives in the Chinese workspace.
- Flashcard answer side: when the card is revealed (`done`), every kind (vocab, sentence, writing,
  tone, reverse, cloze), level sessions included, a "Your note" box below the card content and above
  the grade buttons. Never before the answer is revealed (a mnemonic often gives the answer away).
- Ruling: the session loads the workspace's notes once at start with one list request
  (`prefix=note:`) and looks them up by the card's `entryId`; a failed load shows no notes and never
  blocks the session; offline sessions show no notes — notes are optional help, the session must not
  depend on them — cost: a note edited in another tab during a session appears next session.

**7. The answer-side switch.**

- Ruling: one switch per workspace, "Show my notes on the answer side", default ON, stored as
  `qinqin-core` workspace row `notecfg` = `{"version": 1, "onAnswer": boolean}`; missing or unreadable
  reads as ON; unknown members kept on save — a learner who writes a mnemonic wants to see it while
  studying; per deck is YAGNI (a card can be in several decks, which would need a precedence rule) —
  cost: someone who wants notes only for some decks cannot.
- The switch lives in Settings → Study (workspace part, beside daily limits).

**8. Search.** Ruling: no search over notes in v1 — entry search is a server SQL search over shared
tables, and notes are per-user JSON in plugin data; adding them is not trivial — cost: a learner cannot
find "the word with the horse mnemonic" by its note.

**9. Images later.** Not in v1. A later version would add a member (for example `attachments`) to the
same row, kept verbatim by v1 clients (Ruling in 3), with uploads like journal photos. Nothing in v1
blocks it.

## Data flow

```
entry page ──GET note:<id>──▶ plugin data (qinqin-core, ws) ◀──PUT/DELETE── note editor
session start ──GET ?prefix=note:──▶ Map<entryId, text> ──▶ answer box (if notecfg.onAnswer)
sync pull/push (Android) ── pluginData collection, unchanged
backup export ── plugin-data/*.jsonl (generic) + refs/entries.json gets note entryIds (new)
backup restore ── Maps.PluginRow: note:<old> → note:<new> | drop; newest wins on a shared target (new)
```

## Code layout

- `apps/web/src/lib/notes/notes.ts` (pure): `NOTE_PREFIX`, `NOTE_CFG_KEY`, `NOTE_MAX_CHARS`,
  `noteKey(entryId)`, `parseNote(key, data)`, `normalizeNoteText(raw)` → `{kind:'put', text} |
  {kind:'delete'} | {kind:'tooLong', chars}`, `serializeNote(entryId, text, previous)`,
  `parseNoteCfg(data)`, `serializeNoteCfg(onAnswer, previous)`, `notesByEntry(rows)`, `noteChars(text)`.
- `apps/web/src/lib/notes/store.ts`: thin I/O over `createPluginSdk(coreManifest).data.workspace(ws)`:
  `loadNote`, `saveNote`, `deleteNote`, `loadNotes`, `loadNoteCfg`, `saveNoteCfg`.
- `apps/web/src/lib/notes/EntryNote.svelte` (entry page section) and `NoteAnswer.svelte` (answer box):
  thin; logic in `notes.ts` and a small `noteEditor.ts` state helper.
- Server: `server/internal/backup/remap.go` (`RegisterNote`, note branch in `PluginRow`), `export.go`
  (refs from note rows), `plan.go` (report `notes`, no collision for notes), `format.go`
  (`CorePlugin = "qinqin-core"`, `noteKeyPrefix`).

## Security and isolation

- No `{@html}` in any note component or the pages that host them; a guard test reads the sources (as
  the journal manifest test does), and DOM tests render `<img src=x onerror=alert(1)>` and
  `<script>` notes as literal text.
- Isolation is the plugin data routes' (user from the session, `?workspace=` must be owned, else 404).
  New tests still prove it for `note:*`: user B cannot read, overwrite or delete A's note, and A's note
  in workspace 1 is not visible in workspace 2.
- The backup never exports tombstoned notes (generic rule) and never another user's rows.

## Contracts

- New folder `docs/contracts/notes/`: `README.md` (key, shape, absent rule, cap, normalising, `notecfg`,
  current-workspace rule, remap), `note-rows.json` (parse cases, decoded by `lib/notes/notes.test.ts`),
  `note-text.json` (normalise and cap cases, same test).
- `docs/contracts/backup/remap.json`: `pluginRow` cases for `note:*` (shifted, unresolved, identity,
  non-matching key left as is, `qinqin-flashcards` key named `note:*` untouched); `README.md` remap
  paragraph; `sample-v1/plugin-data/000001.jsonl` gets a note row (manifest counts and SHA-256 updated).
- `docs/contracts/overview.md`: row-key table rows `note:<entryId>` and `notecfg` (plugin
  `qinqin-core`; the table's "all rows belong to qinqin-flashcards" sentence corrected);
  `docs/contracts/README.md` folder table row.

## Testing

Web unit (fixtures), DOM tests for the entry section (add, edit, cap, delete confirm, error keeps
draft, XSS literal) and the answer box (hidden before reveal, hidden when switched off, shown for
reverse and cloze), session-page test that a failed notes load does not block. Go: remap fixture cases,
export refs, plan report and newest-wins, a restore round trip on another id space, two-user isolation
on `note:*` through the API. Real app: note written, pulled by sync, exported, restored onto a server
with shifted entry ids, still on the same word.

## Risks

- Restore onto a server lacking the word drops the note (reported).
- Last write wins per note: two devices editing the same note at once keep the later one.
- Two workspaces of the same language keep separate notes (per-workspace by direction).
