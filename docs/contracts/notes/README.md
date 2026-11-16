# Personal notes on entries

One plain-text note per (user, workspace, entry), shown on the entry page and on the flashcard answer
side. Spec: `docs/superpowers/specs/2026-11-16-v030s-notes-design.md` (issue #77). Web:
`apps/web/src/lib/notes/notes.ts` (rules), `store.ts` (I/O). Fixtures: `note-rows.json` (parse rules),
`note-text.json` (normalising and the cap), decoded by `apps/web/src/lib/notes/notes.test.ts`.

## Rows

Plugin data of the built-in plugin **`qinqin-core`** (not `qinqin-flashcards`: the entry page works with
the flashcards plugin switched off). Workspace-scoped: always read and written with
`?workspace=<current workspace>` through the generic plugin data routes and the `pluginData` sync
collection. There is no note-specific route and the server never parses note text.

| Key | JSON shape |
| --- | --- |
| `note:<entryId>` | `{"version": 1, "entryId": <same id>, "text": "<plain text>", ...unknown kept}` |
| `notecfg` | `{"version": 1, "onAnswer": <bool>, ...unknown kept}` |

- `<entryId>` is the decimal entry id of the server the row lives on: positive, no sign, no leading zero.
  The id is held twice (key and `data.entryId`) so a restore and Android can read it without string games.
- **Scope:** the note lives in the CURRENT workspace, even for an entry of another language (the same
  rule as Add to study). Two workspaces keep separate notes.

## Absent rule (`note-rows.json`, op `note`)

A note is present only when all hold; otherwise the entry has no note:

1. the row exists and is live (`deletedAt` is null);
2. `data` is a JSON object (a string holding JSON text of an object is decoded first, as the web SDK
   does for every row);
3. `data.version === 1` (a future version is invisible to this reader);
4. the key is `note:` followed by a canonical positive decimal integer, and `data.entryId` is a JSON
   integer equal to it;
5. `data.text` is a string that is non-empty after trimming whitespace.

The parsed note is `{entryId, text, extra}`; `extra` holds every member other than `version`, `entryId`
and `text`, verbatim.

## `notecfg` (`note-rows.json`, op `cfg`)

"Show my notes on the answer side", per workspace. `onAnswer` is `false` only when the row is a live
version 1 object whose `onAnswer` is the boolean `false`; a missing, deleted, unreadable or other-version
row, or a non-boolean `onAnswer`, reads as `true` (the default is ON).

## Text (`note-text.json`)

- Plain text with line breaks. No markdown, no links, no markup: clients render it as text (on the web:
  text interpolation in an element with `white-space: pre-wrap; overflow-wrap: anywhere`, never raw
  HTML). The stored text is never escaped; `<script>` is kept verbatim and shown literally.
- Normalising on save: `\r\n` and `\r` become `\n`; trailing whitespace of the whole text is trimmed
  (leading whitespace, inner spaces and blank lines are kept). Whitespace means what JavaScript's
  `trim`/`trimEnd` remove (Unicode `White_Space` and line terminators, so U+3000 too); the same
  definition applies to "non-empty after trimming" in the absent rule.
- Empty after normalising: the save is a delete.
- Cap: at most **2000 characters** counted in Unicode code points (`Array.from(text).length`; an astral
  character such as 😀 counts 1) after normalising. Longer text is refused by the editor (`tooLong` with
  the count); readers still show a longer stored note whole. The server enforces only the generic
  256 KiB value cap.

## Saving and deleting

- Save = `PUT .../data/note:<id>?workspace=<ws>` with the object above; members of the stored row other
  than `version`, `entryId`, `text` are kept verbatim (room for attachments later). Last write wins per
  key with the client's edit time, like every plugin data row.
- Delete = `DELETE .../data/note:<id>?workspace=<ws>`: the server tombstones the row and other devices
  learn it by pull; a later save revives the key.

## Backup and restore

Live note rows are exported with the other plugin data rows, and each note's `data.entryId` is listed in
`refs/entries.json`. On restore the key and `entryId` are rewritten together to the target server's entry
id; a note whose entry cannot be resolved is dropped and counted under `notes` of the unresolved entry in
the dry-run report; when two archive notes map to the same target entry the newest
(`modifiedAt ?? updatedAt`, ties: the smaller source entry id) wins and the other counts as dropped.
Invalid note rows are dropped on restore: any `note:` row whose key is not canonical or whose `data` is not
an object holding the same id as a JSON integer `entryId` (fixture field `restoreKeeps`; a version 2 note
or one with blank text is still remapped, so a newer client's rows survive). See
[`../backup/README.md`](../backup/README.md) and the `note:*` cases of `../backup/remap.json`.
