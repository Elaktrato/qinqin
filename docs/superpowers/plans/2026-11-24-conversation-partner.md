# Plan — AI conversation partner (#185)

Issue #185 (phase 3 of #190), built as a core feature after #199 retired the code plugins (record
[0006](../../architecture/0006-core-features-instead-of-code-plugins.md)). Branch `feature/185-conversation` from
`develop` at 42b690ec, worktree `.claude/worktrees/185-conv`. Server side: record
[0003](../../architecture/0003-domain-packages-own-their-sql.md) (the journal package owns the SQL), errors by
record [0001](../../architecture/0001-error-handling.md); web side: record
[0009](../../architecture/0009-web-state-model.md) (state through the session), folders by record
[0004](../../architecture/0004-web-folder-rules.md). Owner direction (2026-11-24): no backwards compatibility,
stored data need not survive; everything works inside the Android shell's WebView
(`docs/superpowers/specs/2026-11-23-android-shell-design.md`). #186 (AI example sentences) shares the AI service
and is not built here; nothing below is specific to the journal where #186 would need it (the new `Converse`
task sits beside `Review`/`Suggest` in `internal/ai`, and `runAI` stays the one gate for every AI route).

## What the issue wants

A chat partner in the workspace language at the learner's level, with the journal's corrections on the learner's
messages (margin on a wide screen, the shared bottom sheet on a phone), the reader's lookup popup with "+" on the
partner's replies, save as a journal entry or discard, the journal's rate limits, provider and model shown, nothing
sent without the learner's own key, conversations stored like journal data (typed storage, backup, workspace and
account delete with its preview), and the partner kept in the workspace language.

## Design

### AI task `converse` (`server/internal/ai`)

`Provider` gains `Converse(ctx, Credentials, ConverseRequest) (ConverseReply, error)`, implemented by the Anthropic
adapter (structured output), the OpenAI-compatible adapter and Gemini (the shared `run` with one repair retry) and
the deterministic `Fake`; `aitest.CannedText` answers the new system prompt for the adapter tests.

- `ConverseRequest{Language, ExplanationLanguage, Guidance, Level, Topic, Words, History, Text}`; `History` is the
  last turns (`{Role: "learner"|"partner", Text}`), `Text` the learner's new message, empty when the partner opens.
- One structured reply `{"reply": string, "annotations": [...]}`: the partner's next message and the corrections of
  the learner's new message in the review's annotation shape (quote, context_before, correction, explanation,
  category, kind). The server validates the annotations with the journal's `ResolveAnnotations` against the
  learner's text, so they are the journal's corrections, not a second kind.
- The system prompt is a constant (cacheable prefix); everything per request is data in one user message inside
  nonce tags (`<topic_N>`, `<words_N>`, `<history_N>`, `<message_N>`, `<preferences_N>`), like the review.

### Storage (`server/internal/journal/conversation.go`, migration 048)

```
journal_conversations (user_id, workspace_id, id, topic, level, created_at, updated_at,
                       PRIMARY KEY (user_id, workspace_id, id))
journal_messages      (user_id, workspace_id, conversation_id, seq, role CHECK IN ('learner','partner'),
                       text, annotations JSON array, model, provider, created_at,
                       PRIMARY KEY (user_id, workspace_id, conversation_id, seq))
```

Both join `journal.Tables()`, so the workspace delete, the restore's counts and the schema guards pick them up; the
account deletion registry lists both and the deletion preview counts `journalConversations`. A backup carries one
document per conversation in keyed form, `journal:conversation:<id>` = the conversation as `GET` answers it (with
its messages); a restore writes it back through the same validation.

### Routes (all `?workspace=<id>`, `accUser`, `noTok`)

| Route | Does |
| --- | --- |
| `GET /api/journal/conversations` | the workspace's conversations without messages, newest `updatedAt` first: `[{id, topic, level, messageCount, createdAt, updatedAt}]` |
| `POST /api/journal/conversations` `{topic, level}` | starts one (no AI call), 201 with the conversation |
| `GET /api/journal/conversations/{id}` | one conversation with its messages |
| `DELETE /api/journal/conversations/{id}` | discards it (204) |
| `POST /api/journal/conversations/{id}/turn` `{text}` | one AI call: stores the learner's message (with its corrections) and the partner's reply, answers the conversation; `text` may be empty only while the conversation has no message (the partner opens) |
| `POST /api/journal/conversations/{id}/save` `{entryId, date}` | turns it into a journal entry (title = topic, text = transcript) and removes it in one transaction; answers the entry |

New error codes: `conversation_full` (409, the message cap is reached) and `conversation_limit` (409, the
workspace has the maximum of open conversations).

### Web (`apps/web/src/lib/features/journal/conversation/`)

Routes `/journal/talk` (the list and the start form) and `/journal/talk/<id>` (a conversation) inside the journal
feature. The start form takes an optional topic (free text, or one of the journal's topic ideas through the existing
`IdeasPanel`) and a level. The conversation view shows the messages; a learner message is drawn by the journal's
`ReviewText` with its placed annotations, the corrections of every learner message are one list in the journal's
`JournalMargin` (wide) or `CorrectionSheet` (phone), and the partner's replies are lookup paragraphs of the reader's
`LookupController` with `PopupStackView` (the "+" adds the word to a deck of the workspace). The provider and model
of the last reply are shown with the journal's `answeredBy`. Save and Discard sit under the conversation. The logic
(the joined correction list with ids unique across messages, the default level, the composer gate, decoding) is in
tested modules; the components stay thin.

### Contract

`docs/contracts/journal/conversations.json` (+ the journal README): levels, limits, a valid conversation, the start
bodies and turn texts the server refuses, the transcript of a saved conversation, and lenient reads for the client.
Decoded by `server/internal/journal/conversation_contract_test.go` and
`apps/web/src/lib/features/journal/conversation/conversations.contract.test.ts`.

## Tasks

1. **This plan.**
2. **AI task `converse`** (test-first): request and reply types, the prompt and schema, the four adapters, the
   canned fake servers; prompt tests for the level, the word sample, the history and the nonce tags.
3. **Conversation storage** (test-first): migration 048, the store (create, list, get, delete, append a turn, save
   as entry, the caps), the keyed form and its restore, workspace and account delete (preview
   `journalConversations`), the contract fixture and its Go test.
4. **Routes** (test-first): the six routes with their access and token rule, the two error codes (catalogue,
   `apiError.*` keys, changelog), 401 and two-user isolation tests, the AI path with the fake provider (no key, rate
   limit, workspace language, a conversation deleted while the AI answered), the regenerated route and PWA fixtures
   and API wiki pages.
5. **Web** (test-first): the decoder with the contract test, the API module, the logic modules, the list, start and
   conversation views wired into `/journal/talk`, the deletion preview line, every string in `en.json`.
6. **End-to-end:** the e2e servers run the fake provider with a throw-away secret; one spec holds a conversation and
   saves it as an entry.
7. **Docs:** the wiki journal and AI pages (a user section), Your data, record 0006's table, record 0007's AI line,
   contracts overview, README and CHANGELOG, `docs/releases/NEXT.md`, this plan's Execution record.

## Rulings

- Ruling: the conversation partner is part of the journal feature (its switch, its page, its settings) and not a
  feature of its own — the issue files it under the journal, it reuses the journal's keys, settings (explanation
  language, guidance), corrections and entries, and saving makes a journal entry; a fifth switch would show a
  partner whose save target can be switched off — cost if wrong: a later switch is a features-list row and a route
  move.
- Ruling: it lives inside the journal page at `/journal/talk` with a "Talk" link next to "New entry" in the
  journal's entries column, not in the navigation or the bottom bar — the bottom bar holds the four features and is
  full on a phone; one more item for a sub-view of the journal would crowd it — cost if wrong: a nav entry later.
- Ruling: two tables (`journal_conversations`, `journal_messages`), one row per message — a turn appends two rows
  without rewriting the conversation, and the caps are a count; a single JSON column would rewrite up to 45 KB per
  turn — cost if wrong: none found; the keyed backup form is one document either way.
- Ruling: no streaming — the reply is one structured JSON object (the reply and the corrections), the adapters'
  structured outputs and repair retry are not streamable, a short chat reply takes seconds, and the Android WebView
  and the service worker need nothing new — cost if wrong: a slow model feels slow; streaming the `reply` alone
  would be a new adapter path per provider.
- Ruling: one provider call per turn returns both the reply and the corrections of the learner's message — two
  calls (a review plus a reply) would halve how long a learner can talk within the 30 calls per hour — cost if
  wrong: corrections of slightly lower quality than a dedicated review; the learner can still review the saved
  entry.
- Ruling: caps — a learner message is at most 1,000 code points (`too_long`), the partner's reply is cut to 800, a
  conversation holds at most 50 messages (`conversation_full`), a workspace at most 20 open conversations
  (`conversation_limit`), a topic at most 200 code points (it becomes the entry title) — 25 × 1,000 + 25 × 800
  plus the transcript's separators stays under the entry's 50,000 code points, so a saved conversation always
  fits; 20 drafts is plenty for a feature whose end state is save or discard — cost if wrong: a learner who wants
  a longer chat starts a second one.
- Ruling: the prompt context keeps the last 12 messages (6 turns) and the topic; older messages stay stored and
  shown but are not sent — it bounds the input tokens of a long chat and what of the learner's writing leaves the
  server per call — cost if wrong: the partner forgets what was said more than six turns ago.
- Ruling: the word sample is at most 40 words: the workspace's most recently reviewed studied words (the journal's
  topic-ideas query, newest first, deduplicated), never the whole deck — "a sample of known words" by the issue,
  bounded like the ideas' 60 — cost if wrong: a learner who studies other words than the recent ones gets a less
  targeted partner.
- Ruling: the level is a closed set `beginner`, `elementary`, `intermediate`, `advanced`, each sent with a
  CEFR-like description (A1, A2, B1, B2+) — the levels packs are per-language word lists (HSK, JLPT) that say
  nothing about grammar and do not exist for every language; a closed set cannot become an injection channel —
  cost if wrong: a learner between two levels picks the nearer one.
- Ruling: the history is sent as data in one user message, not as alternating chat turns — one prompt shape for the
  three adapter families, the learner's and the model's earlier text stay inside nonce tags (never instructions),
  and the system prompt stays byte-stable for caching — cost if wrong: a model may follow a role-structured chat
  slightly better.
- Ruling: the workspace-language rule is the journal's: the prompt names the workspace language and forbids
  switching, and the server checks the reply with `journal.CorrectionFitsLanguage` (the language profile decides
  the script); a reply in another script is refused as `bad_reply`, nothing is stored and the call counts —
  storing a reply the learner cannot use would be worse than asking again — cost if wrong: a reply that mixes in a
  translation is refused although it was usable (the prompt forbids translations).
- Ruling: a failed turn stores nothing, not even the learner's message; the web keeps the text in the composer —
  a stored message without a reply would need a "reply pending" state — cost if wrong: none.
- Ruling: saving turns the conversation into a journal entry (title = topic, `source` "typed", text = the
  transcript: one paragraph per message, the partner's lines quoted with "> ") and removes the conversation in the
  same transaction; discarding removes it — the issue's "save or discard" is the end of a conversation, and keeping
  a second copy would double what backups and deletes carry — cost if wrong: the corrections of the chat are not
  kept with the entry (a review of the entry gives new ones).
- Ruling: the saved entry's `source` stays "typed" — a new value would change the entries contract and the
  `journal_entries` CHECK constraint for a label — cost if wrong: an entry from a conversation is not marked as one
  in the list.
- Ruling: annotation ids are unique across a conversation (`m<seq>a<n>`) — the journal's margin, sheet and marks use
  the id in DOM ids, and every learner message has its own `a1` — cost if wrong: none.
- Ruling: every route takes `?workspace=` like the journal's document routes and refuses access tokens (`noTok`;
  the token design forbids `/api/journal/`, `TestTokenRuleConsistency`) — cost if wrong: none; a script has no use
  for a chat.
- Ruling: the service worker caches none of the conversation routes (default no) — they are online AI pages — cost
  if wrong: a conversation is not readable offline.
- Ruling: the conversation documents are not in the paged pull, like the rest of the journal — cost if wrong: an
  offline journal would add a pull collection.
- Ruling: the contract is `journal/conversations.json`, decoded by a Go and a web test — fixtures win over code —
  cost if wrong: none.
- Ruling: the e2e servers run with `QINQIN_AI_PROVIDER=fake` and a random throw-away `QINQIN_SECRET` generated per
  run, and one spec holds a conversation — the fake never touches the network and the setup is two environment
  variables; learners without a stored key still see the journal's "no key" state — cost if wrong: an e2e test that
  wants the no-secret state needs a server of its own.
- Ruling: a saved conversation records the journal's daily study event for the new entry, as the editor does for a
  changed entry — the heatmap counts journal days — cost if wrong: none.
- Ruling: the default level of a new conversation is the level of the most recently updated one, else
  `beginner` — no new setting — cost if wrong: one more tap.
- Ruling: a lookup in a partner reply is recorded in the lookup history with the source `reader` (the reader's
  popup) — a new known source would change the lookups contract's key cap (`lookups/README.md`, at most 16 source
  members of which the known ones are reserved) for one label — cost if wrong: the history counts conversation
  lookups as reader lookups.
- Ruling: a turn whose answer was lost on the way (network or proxy, the journal's "poll" errors) reloads the
  conversation once; when it grew, the turn counts as answered — the server finishes a paid call even when the
  client is gone, like the review — cost if wrong: one extra GET after such a failure.
- Ruling: the fake provider's Japanese and Chinese replies mention 学校, a word of the e2e dictionaries — the e2e
  spec checks the lookup popup on a reply without a new fixture pack — cost if wrong: none.
- Ruling: the Settings → AI privacy line now names conversation messages ("Your journal text, conversation
  messages, guidance and the photos …") — what is sent must be said where the key is typed — cost if wrong: none.
- Ruling (fix wave): a turn is idempotent by a client turn id (`turnId`, required, stored on both messages,
  unique per conversation and role) — a retry after a lost answer then answers the stored turn and never pays a
  second reply; the alternative (refusing a duplicate by text) would also refuse a learner who repeats themselves
  — cost if wrong: a client that sends a new id per retry is charged twice (the web reuses its id).
- Ruling (fix wave): migration 048 is changed in place (the `turn_id` column and its index) — it never reached
  develop or a release — cost if wrong: a developer database migrated from an earlier state of this branch needs
  a fresh start.
- Ruling (fix wave): the turn reads the conversation again inside the provider call's closure, while it holds
  the user's one AI slot, and the store numbers the annotation ids from the stored seq — every turn of a user needs
  that slot, so no other turn can land between that read and the write; a turn that finds its conversation changed
  there (gone, the turn already stored, now full or opened) ends without a provider call and records none — cost
  if wrong: none found. The history race itself cannot be timed in a test without a hook in the handler; the id
  numbering is tested at the store (`TestAppendTurnNumbersAnnotationsFromTheStoredSeq`).
- Ruling (fix wave): every write transaction of the journal store that reads first takes the write lock first
  (`beginWrite`, the `pack.BeginWrite` pattern of #192): `AppendTurn` and `SaveConversation` read first and were
  exposed; `DeleteConversation` and `DeleteEntry` wrote first and are converted for one rule. The other journal
  and grammar writes of #199 are single statements (upserts, `INSERT … SELECT … WHERE EXISTS`, the grammar
  progress upsert), and the workspace delete writes first; the restore writes in the backup's own transaction —
  cost if wrong: a writer that waits up to the busy timeout instead of failing.
- Ruling (fix wave): the transcript quotes every line of a partner message ("> ", an empty line ">") and escapes a
  learner line starting with ">" with a backslash (Markdown's escape) — the entry stays plain text and a reader
  tells the speakers apart; a learner line that starts with "\>" itself stays ambiguous (rare) — cost if wrong:
  none. A transcript over 50,000 code points, reachable only with hundreds of one-character lines, is cut rather
  than refused.
- Ruling (fix wave): a reply needs at least half of its letters in the workspace script (on top of the journal's
  one-letter rule) and is refused as the new code `wrong_language` (422) — "Sure! 你好" passed the journal's rule;
  for Latin-script languages the check cannot tell English from Spanish and passes as before — cost if wrong: a
  reply that legitimately quotes a long foreign name is refused once.
- Ruling (fix wave): the restore applies the live rules (turn order 1..n partner first, caps, annotation ids and
  fields, model and provider, the open-conversation cap) and drops a duplicate id as a refused document — the
  archive came from a server with the same rules; anything else is a hand-edited archive — cost if wrong: an
  archive of a future server with looser rules loses conversations on restore (counted).
- Ruling (fix wave): the web reuses one turn id for a message until its turn is answered, and polls (every 5 s, up
  to 180 s, as the review does) after a lost answer or `in_flight`, counting only a conversation that holds this
  turn id — another tab's growth never clears the text — cost if wrong: a learner who edits the text after a lost
  answer and resends gets the stored earlier turn.
- Ruling (fix wave): the message field is read-only (not disabled) while a turn runs, so it keeps the focus and
  the Android keyboard; the live region reads "Partner: <reply>" — cost if wrong: none.
- Ruling: no data is wiped by this branch (new tables only); `docs/releases/NEXT.md` gets a "What's new" line, no
  upgrade line — cost if wrong: none.
- Ruling: CHANGELOG line: new routes, the two error codes, the fixture, the keyed backup family
  `journal:conversation:<id>`, the deletion preview's `journalConversations` — cost if wrong: none.

## Execution record

Commits on `feature/185-conversation` (from develop 42b690ec):

1. `197a59db` this plan.
2. `f451f26a` the AI task `converse` (types, prompt, schema, Anthropic, OpenAI-compatible, Gemini, the fake, the
   canned fake servers).
3. `53f25907` conversation storage (migration 048, `journal/conversation.go`), the keyed backup form, workspace and
   account delete with the preview, the contract `journal/conversations.json`.
4. `02febed9` the six routes, the two error codes, regenerated route and PWA fixtures and API wiki pages.
5. `8a92e7b1` the web: `/journal/talk`, the conversation view, logic modules, the deletion preview line.
6. `b6c2ea79` the e2e spec with the fake provider (servers run with `QINQIN_AI_PROVIDER=fake`).
7. the docs commit (wiki, records 0006 and 0007, contracts overview and README, NEXT.md, this record).

Test-first, honestly:

- Red seen first: the `internal/ai` converse tests (build failure), the journal store and contract tests (build
  failure), the workspace and account delete guards (`TestDeleteEmptiesEveryWorkspaceTable`,
  `TestSchemaGuardEveryUserTableIsListed`), the API route tests (all six failed, 404 for unmounted routes), the
  route fixture test, the web error catalogue test (two codes without `apiError.*` keys), the web contract, API
  and logic tests (missing modules), the route parser tests, the deletion preview line.
- Written after the code (red not seen first): the backup round trip `TestExportAndRestoreConversations` (checked
  afterwards: it fails when the export skips conversations), `TestWordSample`, the `runTurn`/`saveAsEntry` part of
  `talk.test.ts` (it failed only as "not a function" before those functions existed), the two DOM tests
  (`TalkPage.dom.test.ts`, `ConversationView.dom.test.ts`; written after the components, they failed first on two
  wrong expectations of mine, then passed), and the e2e spec (passed on its first run).
- Test bugs fixed on the way, not code: a case-sensitive phrase and JSON HTML escaping in the converse tests; the
  rate-limit API test could not reach the limit with one conversation (it fills at 50 messages), so it opens and
  discards conversations; a reused `Response` body in a web test.

Not verified:

- No real provider: every AI call ran against the deterministic fake or the canned `aitest` servers; whether real
  models keep replies in the workspace language and the corrections well placed is the owner's real-key check.
- No phone or Android WebView run; the phone layout (bottom sheet, one column) is covered by the DOM tests and the
  shared components only. The e2e spec runs on a desktop viewport.
- The Gemini and OpenAI request bodies for `converse` are checked only through the fake servers (the schema is the
  same mechanism as the review's).
- Under Node 22 (local) five reader/settings DOM tests fail on the untouched base as well; under Node 26 (CI)
  the whole suite passes.

### Fix wave (review)

Commits after merging develop (`e8e1c240`, brings c04f6514: `startPackages` takes `prepare`; this branch had no
caller of it):

1. `ec18373d` server: idempotent turns (`turnId`), the history read under the AI slot, annotation ids from the
   stored seq, `beginWrite` for the journal's read-then-write transactions, the quoted transcript, the
   majority-script reply check (`wrong_language`), the strict restore, `StudiedWords` for a turn.
2. `81658102` web: turn ids and polling for this turn ("Still waiting…"), read-only field and the reply in the
   live region, turn-specific texts and the limit as a parameter, the privacy line names the topic and guidance, a
   picked level is kept, `pollUntil`, the contract cases through `startBody`/`turnGate`, the e2e comment.
3. the docs commit (contracts README and CHANGELOG, wiki, these Rulings and this record).

Review items: 1 (lost answer, double charge) — server idempotency plus client polling; 2 (stale seq/history) —
re-read under the slot and ids in `AppendTurn`; 3 (transcript) — fixed with fixture cases; 4 (focus) — read-only;
5 (busy snapshot) — `beginWrite` (cases listed in the Ruling); nits 6–10 done; 10c (history spoofing inside the
nonce) left as is, as the review said.

Test-first: red seen for the store tests (build failure on the new signatures), the write-lock test (written with
the hook before `beginWrite` existed), the transcript and reply-script tests, the strict restore test, the API
retry and `wrong_language` tests (build failure, then the access test needed a turn id), the web `pollUntil`,
`runTurn`, `turnErrorText`, `startBody` and contract cases (13 failures). The Go marshal comparison and the two new
DOM tests (focus kept, picked level kept) were checked to fail with the old code or a mutated fixture after they
passed. Not verified: the history race end to end (see the Ruling); a real Android WebView keyboard.
