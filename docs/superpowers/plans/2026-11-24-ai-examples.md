# Plan — AI example sentences on demand (#186)

Issue #186 (phase 3 of #190), built as a core capability on the shared AI service after #199 retired the code
plugins (record [0006](../../architecture/0006-core-features-instead-of-code-plugins.md)) and after #185 (the
conversation partner, plan `2026-11-24-conversation-partner.md`) added the `converse` task beside the journal's.
Branch `feature/186-ai-examples` from `develop` at ef0dc8c3, worktree `.claude/worktrees/186-examples`. Server side:
record [0003](../../architecture/0003-domain-packages-own-their-sql.md) (the sentences package owns the SQL), errors
by record [0001](../../architecture/0001-error-handling.md); web side: record
[0009](../../architecture/0009-web-state-model.md) (state through the session), folders by record
[0004](../../architecture/0004-web-folder-rules.md); tests by record [0005](../../architecture/0005-test-conventions.md)
and [0007](../../architecture/0007-browser-end-to-end-tests.md). Owner direction (2026-11-24): no backwards
compatibility; everything works inside the Android shell's WebView
(`docs/superpowers/specs/2026-11-23-android-shell-design.md`).

## What the issue wants

On the entry page, when a word has few or no example sentences, "Generate examples": 3–5 sentences at the
learner's level, each with a reading and a translation, written by the learner's own AI provider and key (#87) with
the journal's rate limits and the provider and model shown. They are marked as AI-written wherever they appear
(entry page, cards, cloze), stored per user, never shared and never mixed into a sentences pack. The learner keeps
or deletes each one and can report a bad one (delete it with a reason, stored so the prompt can improve). Kept
sentences feed that learner's cloze and build-the-sentence cards, so each must contain the word itself, checked by
the server.

## How cards get sentences today (and why kept examples are own sentences)

`GET /api/entries/{id}` answers the entry with `sentences`: the pack sentences first, then the viewer's own
(`sentences.ForEntry`, user-owned rows of the `sentences` table: the reader's saved book sentences and
`POST /api/entries/{id}/sentences`). The study session reads `entry.sentences` for sentence (build-the-sentence),
cloze and vocab cards; a sentence card stores the `sentenceId` it shows. Offline, the service worker serves the
cached `/api/entries/{id}` answers that "Prepare offline" fetched (`apps/web/src/lib/pwa/prepareOffline.ts`), so a
card studies offline with exactly the sentences of that answer. Own sentences also ship in the paged pull
(`sentences` collection, the round's languages) and are in the backup (`sentences/NNNNNN.jsonl`).

A kept AI example therefore becomes an own sentence row (user-owned, no source pack) marked with the provider and
model that wrote it. It takes an id from the same id space as every other sentence, so a sentence card can point
at it, and it reaches the entry page, every card kind, the offline copy, the pull and the backup through the paths
that exist.

## Design

### AI task `examples` (`server/internal/ai/examples.go`)

`Provider` gains `Examples(ctx, Credentials, ExamplesRequest) (ExamplesReply, error)`, implemented by the
Anthropic adapter (structured output), the OpenAI-compatible adapter and Gemini (the shared `run` with one repair
retry) and the deterministic `Fake`; `aitest.CannedText` answers the new system prompt.

- `ExamplesRequest{Language, Level, Word, Reading, ReadingSystem, Glosses, Existing, ExactForm}`: the entry's
  language, the learner's level (the closed level set of #185, shared as `ai.Levels`), the word as written, its
  first reading, the reading system of the language profile (`pinyin`, `kana` or empty), up to 5 glosses (which
  sense), up to 10 existing sentences of the entry (not to repeat) and whether the word must appear exactly as
  written (a language without dictionary segmentation, where the server can only match the literal form).
- One structured reply `{"sentences": [{"text", "reading", "translation"}]}`.
- The system prompt is a constant; everything per request is data in one user message inside nonce tags
  (`<word_N>`, `<meanings_N>`, `<existing_N>`).

### Storage (`server/internal/sentences/examples.go`, migration 049)

```
sentences           + ai_provider TEXT NOT NULL DEFAULT '', ai_model TEXT NOT NULL DEFAULT '',
                      ai_level TEXT NOT NULL DEFAULT ''   -- set on a kept AI example only
example_drafts      (id INTEGER PRIMARY KEY, user_id, entry_id, request_id, hanzi, pinyin, translation,
                     level, provider, model, created_at)
example_reports     (id INTEGER PRIMARY KEY, user_id, entry_id, language, hanzi, pinyin, translation,
                     reason CHECK IN (...), level, provider, model, created_at)
```

A sentence's JSON (entry answer, pull row, keep answer) gains `ai`: `{provider, model}` for an AI example, `null`
for every other sentence. Drafts are the undecided output of the last generation for an entry; keeping one moves it
into `sentences` in one write transaction. Deleting a draft or a kept example with a reason stores a report row.

### Validation (`server/internal/sentences/examples.go`, the server's rule)

Each generated sentence is cleaned (plain text, one line, trimmed) and kept as a draft only when:

1. its text has 1..200 code points and its translation 1..400 (its reading at most 400);
2. it is mostly written in the language's script (the journal's majority rule, moved to `lang.MostlyInScript`);
3. it contains the word: the server segments it (`POST /api/segment`'s service, with the lemmatizer, for a language
   with dictionary segmentation or a lemma table) and finds the entry among the matches, else a literal
   occurrence of the written form or a form text that does not lie inside a strictly longer match. This is the
   cloze card's blank rule (`docs/contracts/cards/cloze.json`), so every kept example can be a cloze card;
4. it repeats no sentence of the entry and no other draft of the same answer.

A reading with a Han character, or any reading for a language whose profile has no reading system, is emptied
(not the sentence). At most 5 drafts per generation.

### Routes (all `accUser`, `noTok`)

| Route | Does |
| --- | --- |
| `GET /api/entries/{id}/examples` | `{drafts, defaultLevel}`: the caller's drafts of the entry and the level of their latest generation (else `beginner`) |
| `POST /api/entries/{id}/examples` `{level, requestId}` | one AI call with the caller's key: replaces the entry's drafts with the new ones; `{drafts, dropped, provider, model}` |
| `POST /api/entries/{id}/examples/{draftId}/keep` | the draft becomes an AI example (an own sentence); 201 with the sentence |
| `DELETE /api/entries/{id}/examples/{draftId}[?reason=]` | discards a draft; with a reason it is also reported (204) |
| `DELETE /api/entries/{id}/sentences/{sentenceId}[?reason=]` | deletes a kept AI example (a tombstone, so the pull ships it); with a reason it is also reported (204) |

New error code: `examples_full` (409, the entry has the maximum of kept AI examples).

### Web (`apps/web/src/lib/entry/examples/`)

`AiExamples.svelte` sits under the examples on the entry page: when the entry has fewer than 3 sentences, or has
drafts, it offers the level and "Generate examples"; the drafts show with Keep, Delete and Report (a reason picker).
`Sentences.svelte` marks a kept AI example ("AI-written · model · provider") and gives it Delete and Report. The
cards that show a sentence (build-the-sentence, cloze, vocab) mark an AI example with an "AI-written" tag. Logic
(decoding, the gate, the reason list, the label, the generate flow with its poll after a lost answer) lives in
`examples.ts` with tests; the API calls in `apps/web/src/lib/api/examples.ts`.

### Contract

`docs/contracts/examples/` (README + `examples.json`): levels, limits, report reasons, a valid draft and sentence,
the validation cases (contains the word, script, lengths, readings), the request bodies the server refuses and the
lenient reads of the client. Decoded by `server/internal/sentences/examples_contract_test.go` and
`apps/web/src/lib/entry/examples/examples.contract.test.ts`; the Go word check is also run over
`docs/contracts/cards/cloze.json`.

## Tasks

1. **This plan.**
2. **AI task `examples`** (test-first): request and reply types, prompt and schema, the four adapters, the canned
   fake servers, the shared level set; prompt tests for the nonce tags, the caps and the exact-form line.
3. **Storage and validation** (test-first): migration 049, the `ai` member of a sentence (entry answer, pull row,
   backup line), the script rule moved to `lang`, the word check and the sentence rules, drafts, keep, delete,
   report and the caps with `pack.BeginWrite`, account delete (registry, preview `exampleReports`), the contract
   fixture with its Go test.
4. **Routes** (test-first): the five routes with their access and token rule, `examples_full` (catalogue,
   `apiError.*` key, changelog), 401 and two-user isolation tests, the AI path with a spy over the fake (no key,
   rate limit, idempotent request id, validation drops, an inflected Japanese verb through the real segmenter),
   the regenerated route and PWA fixtures and API wiki pages.
5. **Web** (test-first): the types, the API module, the logic module with the contract test, the panel, the marks on
   the entry page and the cards, the deletion preview line, every string in `en.json`.
6. **End-to-end:** one spec generates examples against the fake provider and keeps one.
7. **Docs:** the wiki dictionary, entry, cards and AI pages, Your data, record 0006's table, contracts overview,
   README and CHANGELOG, `docs/releases/NEXT.md`, this plan's Execution record.

## Rulings

- Ruling: a kept AI example is an own sentence row of the `sentences` table (user-owned, `source_pack` empty)
  marked by `ai_provider`/`ai_model`, not a table of its own — it takes an id from the one sentence id space (a
  sentence card stores `sentenceId`; a second table would collide), and it reaches the entry answer, the cards, the
  offline copy, the pull, the backup and the account delete through paths that exist. It is never in a pack: pack
  rows carry a source pack and no user, imports and uninstalls touch only those — cost if wrong: a later split
  needs an id remap of sentence cards.
- Ruling: AI examples are per user and entry, not per workspace — the user's own sentences and overlays are per
  user and entry (entries are per language already), the entry answer has no workspace, and a workspace scope
  would show different examples on the same entry page by the current workspace and key the offline entry cache by
  workspace. A workspace delete therefore keeps them (like a saved book sentence); the account delete, the
  per-sentence delete and a backup restore remove them — cost if wrong: a learner with two workspaces of one
  language sees the same examples in both; a later scope is a column and a filter.
- Ruling: drafts live in their own table `example_drafts` (one generation's undecided output per entry); a new
  generation that kept sentences replaces them, one that kept none leaves them (fix wave) — a draft must never feed a card, the pull or the backup, and a separate table keeps
  every existing reader of `sentences` untouched; a replaced draft was never kept — cost if wrong: a learner who
  generates again loses the undecided drafts of the previous call (the panel says so next to the button).
- Ruling: no feature switch — the panel is a button that does nothing until pressed, sends nothing without the
  learner's own key and is not one of the four features; a switch for it would sit beside the journal's and govern
  a part of the dictionary — cost if wrong: one switch row and a contract line later.
- Ruling: caps — at most 5 drafts per generation (the issue's 3–5; the prompt asks for 5 because some fail the
  checks), at most 10 kept AI examples per entry (`examples_full`, 409, refused before the call and at keep), a
  sentence of at most 200 code points, a reading and a translation of at most 400; at most 500 reports per user, the
  oldest dropped when a new one comes (a report is a side effect of a delete, which must never fail on it). No cap
  on the total per user: the per-entry cap and the hourly AI limit (30 calls, 150 sentences) bound it — cost if
  wrong: a determined learner stores ten examples on many entries.
- Ruling: the "few examples" threshold is fewer than 3 sentences with text (pack, own and AI together); the panel
  also shows while drafts exist — 3 is the low end of the issue's 3–5 and the cloze rotates through what there is
  — cost if wrong: a word with exactly 3 weak examples offers no button (the learner can still delete one).
- Ruling (fix wave): for a word whose written form has a Han character, a segmenter match whose text has none
  (はし) counts only when the entry is its first candidate (`entries[0]`): a later candidate is a homophone (箸 before
  橋). The rule is the same in the server's check and in the cloze card's blanks (`cards/cloze.json` gains two cases,
  `cloze.ts` changed), so a kept example and a cloze blank never disagree — cost if wrong: a learner of a word that
  is usually written in kana but has a kanji headword gets fewer kept sentences when a homophone ranks first.
- Ruling: the word check is the cloze card's blank rule (`docs/contracts/cards/cloze.json`): the server segmenter's
  matches that resolve to the entry, else a literal occurrence of the written form or a form text outside a strictly
  longer match — inflected Japanese (食べた for 食べる) resolves through the lemmatizer as it does in the reader and
  the cloze card, so a kept example is always a cloze candidate; the Go rule is checked against the cloze fixture
  as well as its own — cost if wrong: an inflection the lemmatizer does not know is dropped although it was a good
  sentence (counted in `dropped`).
- Ruling: for a language without dictionary segmentation and without a lemma table the check is literal only, and
  the prompt says so ("use the word exactly as written") — the server cannot recognise an inflected form there —
  cost if wrong: such a learner gets fewer sentences with natural inflection.
- Ruling: a sentence must be mostly in the language's script (the journal's majority rule of the #185 fix wave,
  moved from `journal` to `lang.FitsScript`/`lang.MostlyInScript` because two domains now use it); a failing one
  is dropped, the rest kept — cost if wrong: none found; a Latin-script language passes as before.
- Ruling (fix wave): a reading is kept only when it holds the reading system's letters (kana: hiragana, katakana,
  ー; pinyin: Latin letters with or without tone marks, the tone numbers 1–5, the apostrophe), punctuation and
  spaces; otherwise (romaji for Japanese, kana for Chinese, a Han character, no reading system) it is emptied
  rather than the sentence dropped — the reading is optional everywhere (pack sentences leave it out rather
  than guess); the reading of a kept example is AI-written and marked as such with the sentence — cost if wrong: a
  wrong pinyin or kana reading slips through (the learner can report `wrong_reading`).
- Ruling: translations are in English — the bundled sentences, the dictionaries' glosses and the interface are
  English — cost if wrong: a learner with another first language reads English translations.
- Ruling: the learner's level is the closed level set of #185 (`beginner`, `elementary`, `intermediate`,
  `advanced` with a CEFR-like description), chosen in the panel; its default is the level of the caller's latest
  draft or kept example, else `beginner` (no new setting) — the levels packs (HSK, JLPT) say nothing about grammar
  and a closed set is no injection channel — cost if wrong: one more choice.
- Ruling: the prompt sends the word, its first reading, up to 5 glosses (which sense) and up to 10 existing
  sentences of the entry (not to repeat; the learner's own saved sentences among them, which the panel and Settings
  → AI say since the fix wave), never the learner's studied words or anything else — the least that gives
  good sentences; what leaves the server is the dictionary's own data — cost if wrong: sentences use words the
  learner has not studied (the level keeps them simple).
- Ruling (fix wave): a generation is idempotent by a client request id (`requestId`, required): every stored
  generation leaves a marker in `example_generations` (request id, level, dropped count, provider, model), so a
  retry is answered from it, also when every sentence was dropped, with its real `dropped`; `GET …/examples`
  reports the entry's `lastRequest`, which the web's poll after a lost answer accepts — cost if wrong: a retry with
  a new id pays again.
- Ruling (fix wave): markers are kept a day (pruned at the next generation of the user) — the web polls for at
  most 180 s, a day covers a laptop closed mid-request — cost if wrong: a retry the next day pays again.
- Ruling (fix wave): a generation that kept nothing leaves the earlier undecided drafts — they were not refused by
  the learner, and deleting them under an open panel made its Keep answer 404 — cost if wrong: an old draft
  lingers until the next generation that keeps something replaces it (Delete still removes it).
- Ruling (fix wave): migration 049 is changed in place (the `example_generations` table) — it never reached
  develop or a release — cost if wrong: a developer database of this branch needs a fresh start.
- Ruling (fix wave): `in_flight` is a refusal, not a lost answer: the request never ran. The web sends the same id
  again after 2, 4, 8 and 16 s and then gives up, and polls `GET` only after a network error, 502 or 504; the
  journal's conversation turn does the same (`sendRetryingInFlight` in `reviewPoll.ts`) — cost if wrong: a learner
  with a long-running review in another tab waits half a minute and then sees "Another AI request is still
  running".
- Ruling (fix wave): the handler reads the marker and the kept count again, calls the provider, checks the
  sentences and stores the generation all inside the provider call's closure, while it holds the user's one AI
  slot, so a retry with the same id can never land between the call and the store; the conversation turn of #185
  now validates and stores its reply the same way. A store failure there is a 500, the call is still recorded as
  made. Writes are write-lock-first transactions (`pack.BeginWrite`); keep, delete and report read then write and
  take the write lock first too — cost if wrong:
  a writer waits up to the busy timeout instead of failing.
- Ruling: an answer where every sentence failed the checks is 200 with `drafts: []` and `dropped: n` (the call
  counts against the limit) — a 422 would hide what happened; the panel says none contained the word — cost if
  wrong: none.
- Ruling: report reasons are a closed set (`missing_word`, `wrong_translation`, `wrong_reading`, `unnatural`,
  `too_hard`, `inappropriate`, `other`) with no free text — no keyboard on a phone, nothing personal in the
  report, no injection channel when a later prompt reads them — cost if wrong: a learner cannot say exactly what
  was wrong.
- Ruling: reports stay with the user and are not shown to an administrator in this build — they are the user's
  data (like the journal); a report row keeps the sentence, its reason, level, provider and model, so a later
  aggregate (counts by reason, provider and model) or a prompt hint can read them — cost if wrong: the owner sees
  no report until such a view exists (they can query the table on their own server).
- Ruling: reports and drafts are not in the backup (drafts: undecided output; reports: feedback on the AI, not
  learning data); a restore drops the drafts and keeps the reports; both go with the account delete, whose preview
  counts reports (`exampleReports`); kept examples are counted in `sentences` — cost if wrong: a restore on
  another server loses the reports.
- Ruling (fix wave): a kept AI example travels in the backup's own sentences part with `ai: {provider, model,
  level}`, and the restore applies the live rules: provider (at most 64 bytes), model (at most 200) and level all
  required, a text of at most 200 code points, a translation of 1 to 400, a reading of at most 400, at most 10 AI
  examples per entry; an archive that breaks one is refused whole — the mark must survive a restore, a hand-edited
  archive is refused — cost if wrong: an archive from a future server with looser rules does not restore.
- Ruling: kept examples sync through the pull: they are own sentences, so the `sentences` collection ships them
  (with `ai`) for the round's languages; cards study them offline through the cached entry answers, like every
  other sentence — cost if wrong: none; nothing new is cached.
- Ruling (fix wave): after a keep or a delete the entry page fetches the entry again in the background, so the
  service worker's network-first copy of `/api/entries/{id}` follows (one GET) — cost if wrong: offline, a copy
  saved on another device before the keep still lacks the example until that device opens the word online.
- Ruling: a kept AI example comes after the pack sentences and the other own sentences in the entry answer (the
  existing `ForEntry` order: pack first, then own by id) — the curated sentences stay the cloze card's first
  candidates — cost if wrong: an AI example on a word with eight pack sentences never becomes a cloze sentence.
- Ruling: only AI examples can be deleted through `DELETE /api/entries/{id}/sentences/{sentenceId}` (another own
  sentence or a pack sentence is 404) — the other own sentences had no delete before and the issue asks for none —
  cost if wrong: a later general delete widens one WHERE clause.
- Ruling: every route is `accUser` and refuses access tokens (`noTok`): it spends the learner's AI key or changes
  what a card shows — cost if wrong: none; a script has no use for it. The service worker caches none of them
  (default no); the kept examples are offline through the cached entry answer.
- Ruling: the contract is `docs/contracts/examples/` (new folder), decoded by a Go and a web test; the sentence
  shape's new `ai` member is recorded in the pull-page fixture and the CHANGELOG — fixtures win over code — cost if
  wrong: none.
- Ruling: the web reuses the journal's AI error texts and provider names (`$lib/features/journal/aiErrors`,
  `providerNames`), as Settings → AI does — a move to a shared folder would touch every journal import for no
  behaviour — cost if wrong: a later move when a third AI feature arrives.
- Ruling: the fake provider's examples are fixed sentences built around the word plus one sentence without it
  (`一二三。`, `あいうえお。`, `Lorem ipsum.`), so every fake generation also exercises the word check — cost if
  wrong: none.
- Ruling: no data is wiped by this branch (new columns with defaults and new tables only); `docs/releases/NEXT.md`
  gets a "What's new" line, no upgrade line — cost if wrong: none.

## Execution record

Commits on `feature/186-ai-examples` (from develop ef0dc8c3):

1. `e3ab6b94` this plan.
2. `702fd0f9` the AI task `examples` (types, prompt, schema, Anthropic, OpenAI-compatible, Gemini, the fake, the
   canned fake servers); `ai.ConverseLevels` renamed `ai.Levels` (shared).
3. `bb4365a7` storage and checks: migration 049, the `ai` member of a sentence (entry answer, pull row, backup
   line), the script rule moved from `journal` to `lang` (`FitsScript`, `MostlyInScript`, `LatinLanguage`), the word
   check, drafts, keep, delete, report and the caps, account delete (registry, preview `exampleReports`), the
   contract `docs/contracts/examples/` with its Go test; the web pull-row decoder and the preview line so the web
   suite stays green.
4. `4c27ca71` the five routes, `examples_full`, regenerated route and PWA fixtures and API wiki pages, the
   CHANGELOG.
5. `73766c6a` the web: the API module, the logic module, the panel, the marks on the entry page and the cards,
   the strings.
6. `13b827aa` the e2e spec, and the panel fix it found.
7. the docs commit (wiki, record 0006, contracts overview and README, NEXT.md, README, this record).

Test-first, honestly:

- Red seen first: the `internal/ai` examples tests (build failure), the `lang` script tests after the move (build
  failure), the sentences store and contract tests (build failure), the backup round trip and malformed-mark tests
  (build failure, then the drafts were still restored until the registry said `RestoreDrop`), the account schema
  guard and export-decision test (no seed rows, the drafts' decision), the API route tests (all seven failed, 404
  for unmounted routes), the web contract test and the API module test (missing modules), the logic tests (missing
  keys), the deletion preview line, and the panel's "new entry object" DOM test (written after the e2e spec found
  the bug, failing on the old panel).
- Written after the code (red not seen first): the panel's other DOM tests (`AiExamples.dom.test.ts`), the
  `Sentences` and card mark tests (the cloze mark test was checked to fail with the tag removed), the
  `errors_nocall_test.go` mapper test (it passes with the old mapper too; the fixed line in the conversation turn
  is verified by reading only), the e2e spec (failed twice on its own locators and once on the panel bug before it
  passed).
- Test bugs fixed on the way, not code: `TestExampleFlow` expected three drafts after the second generation where the
  duplicate rule (rightly) leaves two; the `MostlyInScript` case "我喜欢 Python 和 Go。" has a Latin majority; a
  plural message with text outside the plural; the e2e region name "Examples" also matched "AI examples".
- Found on the way in #185's code: a turn that ended before the provider call (its conversation changed while the
  turn waited for the AI slot) answered 500, because `errors.Unwrap` of a two-`%w` error is nil; it now answers the
  cause (404, 409). Fixed in commit 4.
- A careless `cat >` overwrote the existing `Sentences.dom.test.ts` in commit 5; restored with the new cases
  appended before the commit was final (the three #104 tests are back).

Gates (final):

- Go: the touched packages per task; one full `./...` (vet and tests, `-p 2`): 53 packages ok, the only failure the
  known `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 sockets here); `gofmt -l` prints
  nothing.
- Web: `npm run check` 0 errors, 0 warnings (1742 files); `npm run build` passes; full vitest under Node 26: 607
  files, 12,807 tests passed, 2 skipped (under Node 22 the five known reader/settings DOM tests fail, as on the
  base).
- e2e (`npm run e2e -- --trace off`): 16 passed, three runs in a row.
- Script tests (`node --test scripts/*.test.mjs`): 157 tests, 156 passed, 1 skipped, 0 failed.
- `node scripts/gen-api-docs.mjs --check`: clean.

Not verified:

- No real provider: every AI call ran against the deterministic fake or the canned `aitest` servers; whether real
  models write sentences that contain the word, at the asked level, with correct pinyin or kana, is the owner's
  real-key check. The Gemini and OpenAI request bodies for `examples` are checked only through the fake servers.
- The Japanese inflection rule is checked through the server's real segmenter with a small JMdict (`食べた`,
  `食べています` for 食べる) and the contract cases; other inflection classes rely on the lemmatizer's own tests.
- The handler's re-read under the AI slot (another generation of the same user landing between the first check
  and the call) cannot be timed without a hook; the in-flight limiter answers a parallel call `in_flight` first.
- No phone or Android WebView run: the panel's phone layout (wrapping rows, a reason picker instead of a text
  field, buttons that stay enabled with `aria-disabled` so the focus stays) is covered by DOM tests only; the e2e
  spec runs on a desktop viewport.
- Offline: kept examples reach offline study through the cached entry answer like every sentence; no new offline
  test was written for them.

### Fix wave (review)

The review found no blocker (privacy and authorization hold on every read path of `sentences`); four should-fix
items and nits, all fixed:

1. `aa4a4013` server: generation markers (`example_generations`, migration 049 changed in place) make a generation
   that kept nothing idempotent and leave the earlier drafts; `lastRequest` on `GET …/examples`, `requestId` on the
   answer; the examples and #185's turn check and store inside the `runAI` closure; a test hook on the AI slot
   (`WithAISlotHook`, `export_test.go`) for handler-level tests of the under-the-slot paths. The web decoder and
   poll accept the marker.
2. `c3d77802` readings in their system, kana homophones (server and cloze card), strict restore with the level.
3. `f41a5d44` web: `in_flight` resends (examples and the turn), focus after Keep, Delete and Report (panel and
   kept examples), the AI-status gate, a new request id per level, the poll aborted on unmount, the offline copy
   refreshed after a keep or delete, the privacy lines, a VocabCard mark test.
4. the docs commit (wiki, contract README and CHANGELOG lines, these Rulings and this record).

Review items: 1 (empty generation) — markers; 2 (`in_flight`) — resend with backoff, both features; 3 (focus) —
next button or heading; 4 (the #185 `errors.Unwrap` line) — `TestConversationTurnUnderTheSlot` deletes the
conversation from the slot hook: it answered 500 with the old line (seen, with the line restored for the run) and
404 now; 5 (slot released before the store) — store in the closure, `TestExamplesAreStoredBeforeTheSlotIsReleased`
and the turn's half of `TestConversationTurnUnderTheSlot` check the stored rows from the "releasing" hook (both
failed before the move); 6 (readings) — reading-system letters; 7 (homophones) — first candidate; 8 (restore) —
the Ruling, contract and code agree; 9 (nits) — all done.

Test-first: red seen for the store tests (build failure on `StoreGeneration`), the schema guard (the marker table),
the slot-hook API tests (store before release: 10 instead of 11; the turn's 404 with the old line), the contract
checks (romaji and kana readings, the homophone) and both cloze implementations on the new cloze cases, the
backup tests (build failure on `Level`), the web poll and `generatedText` tests, `sendRetryingInFlight` and the
`in_flight` cases of the examples and the turn, the focus tests (panel and entry page), the AI-status gate, the
request-id and abort tests, the offline-copy refetch and the privacy strings. `TestAnEmptyGenerationRetryIsFree`
was written after the markers (the reviewer's probe had shown two calls before). The VocabCard mark test was
written after the tag existed and checked to fail with it removed. Old tests changed on purpose:
`TestExampleRequestIsIdempotent` (a retry now reports the stored `dropped`), `TestExampleChecksDropSentences` (an
empty generation keeps the earlier drafts), the turn's "polls on `in_flight`" test (now resends).

Gates after the fix wave: Go full `./...` 53 packages ok, only the known `internal/ai` IPv6 test failing; `gofmt -l`
empty; web check 0 errors, 0 warnings (1743 files); build passes; vitest under Node 26 608 files, 12,820 passed,
2 skipped; e2e 16 passed, three runs; script tests 157 (156 passed, 1 skipped); `gen-api-docs --check` clean.

Mistake on the way: a second careless `cat >` overwrote the existing `VocabCard.dom.test.ts`; restored from HEAD
with the new case appended before the commit.

Not verified in the fix wave: the "releasing" hook proves the store happens before the slot is released, not
that no real-world retry can slip in elsewhere; the Android keyboard and focus on a real device; a homophone rule
for languages other than Japanese (only a Han word with a kana-only match is affected).
