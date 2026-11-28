# Sentence sources: a saved book sentence keeps its book, chapter and position (#280, 2026-11-28)

Milestone v0.9.0, phase 5 ("#279 → #280 → #184, sentences from reading"). Branch `feature/v090-280-reading-sentences`
from `feature/v0.9.0` (567af767, ContractVersion 40; this branch uses 43 as told, the orchestrator renumbers).

## What (issue)

- **Store the source with the sentence:** the library item (a book), the chapter and the position (code points),
  plus the title for display. Optional fields of the learner's own sentences; pack sentences keep their credit.
- **Show it:** the entry's sentence list and the card's answer side show "From *title*, chapter n" in place of the
  user number (`#3`). It links to the reader at that position, with the word highlighted.
- **Gone or private sources:** a removed book keeps its title as text without a link. The source is only shown to
  the sentence's owner.
- **API and contract:** `POST /api/entries/{id}/sentences` accepts the source; the sentence answers carry it. Backups
  carry it.
- **Fits #279** (more sentences per word, the same `sentences` rows) and **#184** later ("Read the sentence" cards
  planned from the same saved rows, with the source on the back). Nothing of #184 is built.

No "Owner decisions" comment on #280; #184's comment (a separate opt-in kind) needs nothing from this issue beyond the
source being on the sentence row and a component that can show it with or without a link.

## The design

- **Stored (migration 059, columns on `sentences`):** `source_kind` (`''` none, `'book'`), `source_book_id` (NULL
  when there is none or the book is gone), `source_title` (the book's title when saved), `source_chapter`,
  `source_paragraph`, `source_start`, `source_end`. The position follows the highlights' model (`library_highlights`):
  chapter, paragraph, and the word's code-point range `[start, end)` in the paragraph's plain text (ruby excluded).
- **The answer:** `source` on a sentence (`omitempty`, own sentences only):
  `{kind: "book", bookId: 5 | null, title, chapter, paragraph, start, end}`. `GET /api/entries/{id}`, the POST, and
  the sync pull's `sentences` rows carry it. Own sentences are private already (`ForEntry` shows only the viewer's
  own), so the source is too.
- **The request:** `POST /api/entries/{id}/sentences` takes an optional `source: {bookId, chapter, paragraph, start,
  end}`. The server checks it (contract `check`): one of the caller's books, of the entry's language, chapter below
  the book's chapter count, paragraph 0 … 100000, `0 ≤ start < end ≤ 100000`; anything else is 422 (another user's
  book is the same 422 as a missing one). The title is the server's copy of the book's title, not the client's.
- **The same text** (#279's 200 answer): an own sentence with no source takes the source of the new save (its
  `updated_at` moves, so the pull ships it); one that has a source keeps it; a pack sentence is answered unchanged.
- **A deleted book** (a book delete, a workspace delete): its sentences keep `kind`, title, chapter and position,
  `bookId` becomes null and `updated_at` moves (contract `detach`). The entry page then shows the title as text.
- **The link:** `/reader/book/{bookId}/{chapter}?at={paragraph}:{start}-{end}` (web `sourceHref`, contract `link`);
  null without a book. The reader reads `at` (`parseAt`, contract `at`): it scrolls to that paragraph instead of the
  saved position, marks the word with a CSS highlight (`reader-source`, until the chapter changes or another word is
  looked up) and saves the position from there, like a bookmark jump. A malformed `at` is ignored (the normal
  restore runs).
- **The label:** "From *title*, chapter n" (n one-based), "From an untitled book, chapter n" for an empty title. The
  entry page links it; review cards show it as text (no link, see Rulings).
- **Where the popup gets it:** `StackInfo` gains the paragraph index `p`; `PopupStackView` takes an optional
  `source` (`{bookId, chapter}`) that only `BookView` passes; the root popup's results then give `paragraph`, `start`,
  `end`. Grammar lessons and conversations pass nothing: their sentences stay sourceless.
- **Both save paths carry it:** "Add to deck" (`resolveBookSentence`) and "Save this sentence" / the automatic mode
  (`saveBookSentence`).
- **Backup:** `sentences.jsonl` lines take `source` (`bookId` must be a book of the archive, or null); a restore maps
  `bookId` to the restored book's new id.

## Tasks

1. This plan.
2. Contract `reader/sentence-sources.json` and the server: migration 059, `model.SentenceSource`, `CheckSource`, the
   POST with a source, the fill rule on the same text, `DetachBooks` from the library's deletes, the sync pull (test
   first, Go decodes `check`, `merge`, `detach`).
3. Backup: export, archive check, restore with the book remap, the sample archive and its README (test first).
4. Web logic: types, `sourceHref`/`parseAt`, `sourceLabel`, `addSentence` with a source, both save paths (test first,
   web decodes `link`, `at`, `label`).
5. Web UI: the popup passes the source; the entry page and cards show it; the reader opens at `at` with the word
   marked.
6. Contract version, CHANGELOG, wiki, release notes, e2e at phone width (the link, the reader, the back button).

## Rulings

- Ruling: the position is chapter + paragraph + the word's code-point range, the highlights' model, not one book-wide
  offset — the reader's positions, bookmarks and highlights all address (chapter, paragraph), and the range lets the
  reader mark the word — a later client that wants one offset has to add the paragraph lengths.
- Ruling: the source is a set of columns on `sentences`, not a new table — one source per sentence, and the row
  already has the delete, backup and sync paths — a sentence met in two books keeps only the first.
- Ruling: `source_kind` `'book'` is the only kind now — graded readers (#231) and course texts can add their own kind
  without a migration of the meaning of the other columns — none.
- Ruling: the server takes the title from the book row, the client sends only ids and offsets — a client cannot label
  a sentence with a title the book does not have — a book renamed later keeps the old title on its sentences (books
  have no rename today).
- Ruling: when a book is deleted, its sentences keep title, chapter and position and lose only `bookId` (set null in
  the delete's transaction, `updated_at` moved) — the issue keeps the title as text; book ids are never reused
  (AUTOINCREMENT), but a null id is what tells every client, also a pulled copy, that there is nothing to open — none.
- Ruling: the library's deletes call `sentences.DetachBooks` in their transaction (library imports sentences) — the
  sentences package owns its SQL (record 0003) and a book delete must never leave a link to a gone book — none.
- Ruling: an invalid source (not the caller's book, another language, a chapter out of range, a bad range) is 422 and
  stores nothing, rather than storing the sentence without a source — a client that sends a source means it; the
  reader sends only ids it has open — a stale tab whose book was deleted cannot save its sentence (the error line
  shows, as for any failed save).
- Ruling: the paragraph is bounded (0 … 100000) but not checked against the chapter's paragraphs — the highlights do
  the same and it saves reading the book file on every save — a crafted source links to the chapter's top.
- Ruling: on the same text, an own sentence without a source takes the new one; one with a source keeps it — a
  sentence saved before #280 (or from a grammar lesson) gains its book the next time it is met in one; the first
  book wins — none.
- Ruling: review cards (Word Salad answer, the vocab card's sentence) show the source as text, not as a link — a link
  in a running review leaves the session with the card ungraded; the word's page (and #184's card, which can pass
  `link`) have the link — a learner who wants to jump from a card goes through the word's page.
- Ruling: following a source link moves the saved reading position there, as a bookmark jump does — the reader then
  continues from where the learner went — the place they were reading before is replaced.
- Ruling: the word is marked with a CSS custom highlight (`reader-source`), not a stored highlight — it is a pointer,
  not the learner's highlight; browsers without the Highlight API still scroll there — those browsers show no mark.
- Ruling: chapter numbers in the label are one-based ("chapter 1" is the first) — the reader's own chapter labels
  are one-based (`reader.chapter`) — none.
- Ruling: the sync pull ships the source on own sentence rows — sentences are pulled, and a client that shows them
  needs the same label — none.
- Ruling: no new table, no workspace delete rule: the sentence is the user's, the account delete and its preview
  already cover own sentences (`sentences`), a workspace delete detaches its books' sentences — none.
- Ruling: the backup's `bookId` must be a book of the archive (or null), like bookmarks; a restore maps it to the new
  book id — an archive pointing at a missing book is refused as malformed — none (the export never writes one).

## Pending review

Nothing: this issue adds UI strings only. The `de`/`ja` catalogues do not exist yet on the integration branch.

## Local follow-up

- **#280, Android WebView:** in the APK (`apps/android`, a debug build on an emulator or phone), open a book, tap a word
  that has a card and press **Save this sentence**; open the word's page (the sheet's "Open entry"), tap
  **From *title*, chapter n**: the reader opens with the sentence's paragraph at the top and the word underlined; the
  hardware back button returns to the word's page (not to the library or out of the app). Not checked here (no
  Android SDK or emulator); the same flow passed in headless Chromium at 360 × 740 with touch, `page.goBack()` as the
  back button (`e2e/tests/sentence-sources.spec.ts`). The Android System WebView must support the CSS Custom
  Highlight API (Chromium 105+) for the mark; without it the reader still scrolls there.

## Execution record

- Task 1 (plan): b0349c16.
- Task 2 (server, d46fc60b): test first for the rules. `source_contract_test.go` (`check`, `merge`, `detach`, limits)
  failed on the missing types, then `source.go`, migration 059 and the scan/insert changes made it pass.
  `library/sources_test.go` (a book delete and a workspace delete detach) failed ("still links to book 1"), then the
  `DetachBooks` calls made it pass. `TestSentenceSourceRoutes` (201 with the book's title, 422 for another user's
  book, another language, a missing chapter, an unknown book, an empty range and a deleted book; 401; adoption on the
  same text; a pack sentence unchanged; the owner alone sees it; the delete keeps the title) was written after the
  handler, then seen failing with the handler change stashed (`POST with a source = 201 <nil>`) and passing with it.
  **Not test first:** the sync pull's `source` (`sentence_source_test.go` written after `encodeSentence`; it passed
  at once) and the web `rows.ts` shape.
- Task 3 (backup, 1e6f9178): test first. The sample archive's sentence got a source and two reject cases were added
  (`sentence_source_unlisted_book`, `sentence_source_malformed`); `TestOpenAcceptsTheSampleArchive` and
  `TestRestoreMapsTheSentenceSourceToTheRestoredBook` failed ("sentences holds a malformed line"), then the format,
  check, export and restore changes made them pass. A first full run of the package hung in
  `TestServerBackupPicturesMatchTheSnapshot` (the decode slots, after the sample-based tests failed); with the change
  in, the package runs in about 7 s.
- Task 4 (web logic, 334ab8e8): test first. `sentenceSource.test.ts`, the `route.test.ts` link/at cases and the new
  `sentence.test.ts` and `savedSentences.test.ts` cases failed on the missing functions and arguments, then passed.
- Task 5 (web UI, adf44c79): **not test first.** `SentenceSource.dom.test.ts` (link, deleted book, card text, entry
  page) and the `AddToStudyButtons` case (the source is posted) were written after the components; two failed first
  (a missing space before "·"; the forced-colours lint wants the `reader-lookup` rule in its own block) and were fixed.
  The reader's `at` jump and word mark have no DOM test; the e2e covers them.
- E2E (dfd1fa97): `sentence-sources.spec.ts` at 360 × 740 with touch: save from the sheet, the API `source`, the entry
  link, the reader at `?at=` with the paragraph in view and `CSS.highlights.has('reader-source')`, no sideways scroll
  on both pages, `page.goBack()` back to the word's page, and the deleted book's text. `phone-width.spec.ts` adds
  `/reader/book/{id}/0?at=1:0-1`.
- Docs (fdf0e3cd): contract 43, CHANGELOG, `reader/README.md`, sync and backup READMEs, wiki Reader, API reference,
  Your data, Searching and entries, release notes.
- Merge of `feature/v0.9.0` (#227 contract 41, #231 contract 42): conflicts in the contract version (kept 43), the
  CHANGELOG, NEXT.md and `phone-width.spec.ts` (kept both). Graded readers (#231) are imported as one-chapter
  library books, so their sentences get a source like any book's. No other migration 059 on the branch.
- Hidden romanisation: no new reading is shown; the guard passes.
- Gates after the merge: Go `./...` 67 packages ok (including `cmd/qinqin`), the only failure is the known
  `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6); gofmt clean; vitest 816 files, 16262
  passed, 3 skipped; `check` 0 errors; `build` ok; e2e 91 passed (the whole suite); `node --test scripts/*.test.mjs`
  243 passed, 1 skipped; `gen-api-docs --check` clean (no route row changed).
