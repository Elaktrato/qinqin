# Journal documents (`/api/journal/*`)

Issues #103, #185 and #199. The journal is a core feature with a per-user switch (`features/`). Its documents are
typed storage of the server (`server/internal/journal/store.go`, migration 044), each scoped to one workspace
of one user. None of them is in the paged pull; clients read and write them through these routes (every one
takes `?workspace=<id>` of the caller: missing or not an integer is 400 `bad_request`, an unknown or foreign
workspace 404 `workspace_not_found`; no route takes an access token):

| Document | Read | Write | Shape |
| --- | --- | --- | --- |
| entry | `GET /api/journal/entries` (all, newest `date` first, then newest `updatedAt`), `GET /api/journal/entries/{id}` (404 `not_found` when missing) | `PUT /api/journal/entries/{id}` `{date, title, text, source, createdAt?}` answers the stored entry; `DELETE` (204; the review goes too; 404 when missing) | `{id, date, title, text, source: "typed"\|"photo", createdAt, updatedAt}` |
| review | `GET /api/journal/entries/{id}/review` → `{review: … \| null}` | `POST /api/journal/review` (the AI review; stored only while the entry exists) | below |
| topic ideas | `GET /api/journal/suggestions` → `{suggestions: … \| null}` | `POST /api/journal/suggestions` | `{items: [{title, prompt, words}], model, provider?, createdAt}` |
| settings | `GET /api/journal/settings` (the defaults when none is stored) | `PUT /api/journal/settings` `{guidance, explanationLanguage}` answers the stored settings | `{guidance, explanationLanguage}` |

Entries ([`entries.json`](entries.json), decoded by `server/internal/journal/entries_contract_test.go` and
`apps/web/src/lib/features/journal/entries.contract.test.ts`): `id` matches `^[0-9A-Za-z_-]{1,64}$` (clients use
a ULID), `date` is a calendar date `YYYY-MM-DD` (the learner's day when it was started), `title` at most 200
and `text` at most 50000 code points of plain text (no control characters but line breaks and tabs),
`source` is `typed` or `photo`. `updatedAt` is the server's RFC 3339 stamp of the last write; `createdAt` is
the first write's (the client's when it sent one) and never changes. Anything else is 400 `bad_request`.

Settings: `explanationLanguage` is one of the fixture's `explanationLanguages` (a PUT of anything else is 400);
a stored value that is no longer listed reads as `en`, and `guidance` (at most 2000 code points) is cut to
that length when read.

A personal backup carries these documents in their keyed form (`journal:entry:<id>`, `journal:review:<entryId>`,
`journal:suggestions`, `journal:settings`, `journal:conversation:<id>`; `backup/README.md`).

## Conversations

Issue #185: the conversation partner, a draft of the journal (tables `journal_conversations` and
`journal_messages`, migration 048). Every route takes `?workspace=` as above and needs the learner's own AI key
for the AI turn (the journal's `no_key`, rate limit and provider errors apply):

| Route | Does |
| --- | --- |
| `GET /api/journal/conversations` | the workspace's conversations without messages, newest `updatedAt` first: `[{id, topic, level, messageCount, createdAt, updatedAt}]` |
| `POST /api/journal/conversations` `{topic, level}` | starts one, 201 with the conversation (no AI call); 400 `bad_request` for a level outside `levels` or a topic that is not plain text of at most `topicRunes`; 409 `conversation_limit` when the workspace has `conversations` open |
| `GET /api/journal/conversations/{id}` | the conversation with its messages; 404 `not_found` |
| `DELETE /api/journal/conversations/{id}` | discards it (204; 404 when missing) |
| `POST /api/journal/conversations/{id}/turn` `{text}` | one AI call; stores the learner's message with its corrections and the partner's reply and answers the conversation. A blank `text` is allowed only while the conversation has no message (the partner opens), else 422 `empty`; over `messageRunes` is 413 `too_long`; 409 `conversation_full` when two more messages would pass `messages`. A failed call stores nothing |
| `POST /api/journal/conversations/{id}/save` `{entryId, date}` | turns it into a journal entry and deletes it in one transaction; answers the entry. 422 `empty` without messages; 400 for an `entryId` or `date` an entry refuses or an existing entry's id |

A conversation is `{id, topic, level, createdAt, updatedAt, messages: [{seq, role: "learner" | "partner", text,
annotations, model?, provider?, createdAt}]}`. A learner message carries the corrections of its text in the review's
annotation shape (below), validated against that text like a review's; their ids are unique in the conversation
(`m<seq>a<n>`). A partner message has no annotations and names the `model` and `provider` that wrote it. The
partner's reply is plain text cut to `replyRunes`, and must be written in the workspace language's script (the
journal's script check, by the language profile); a reply that is not is refused as 422 `bad_reply`.

What a turn sends to the provider: the workspace language, the `level` with a CEFR-like description, the topic,
at most `wordSample` of the workspace's most recently reviewed studied words (never the whole deck), the last
`contextMessages` messages and the new message, the journal settings' explanation language and guidance.

A saved conversation becomes an entry with `title` = the topic, `source` `typed` and `text` = the transcript: one
paragraph per message (separated by a blank line), the partner's lines quoted with `> `. The caps keep the longest
transcript under an entry's 50000 code points.

A client reads a conversation leniently (`reads`): an unknown level reads as `beginner`, a message of another role
or without text is dropped, annotations that are not a list read as none, an annotation without a string `quote`
is dropped and an unknown `kind` is a mistake.

## Review documents

The review of an entry: `{entryId, textHash, annotations[], overall, model, provider?, fallbackFrom?, dropped,
createdAt}`, written by `POST /api/journal/review` or answered by it. This folder pins the document so every
client that shows a review shows the same corrections.

## Annotation

Every annotation is `{id, quote, prefix, suffix, correction, explanation, category, kind}`.
`prefix` and `suffix` are computed by the server from the entry text, never taken
from the model. `quote` and `correction` are the learner's language; `explanation`
is the explanation language; `category` is free text cut to 40 code points (the
schema asks for `grammar`, `word choice`, `spelling`, `style`, `other`).

`kind` is the closed set **`mistake` | `suggestion`**:

- The review schema requires it; the model is told: *"mistake" when the quote is
  wrong (grammar, spelling, a word that does not fit), "suggestion" when it is
  correct but could be more natural or clearer.*
- The server trims and case-folds the model's answer; **anything else** — absent,
  empty, unknown, another script, too long — is stored as `mistake`. The kind
  never drops an annotation and the model's text never reaches the stored value.
  Fixture: [`kind-resolve.json`](kind-resolve.json), decoded by
  `server/internal/journal/resolve_contract_test.go`.
- A client applies the same fallback to an older review (no `kind`) or a row
  written by another client: absent or unknown = `mistake`. The client does not
  trim (`"suggestion "` is a mistake) because the server already did.
  Fixture: [`review-docs.json`](review-docs.json), decoded by
  `apps/web/src/lib/features/journal/review.test.ts`.

## Untrusted text

The entry, the annotations and the overall review are plain text. Render every
model string as text (Svelte text nodes, no `{@html}`, no markdown, never in a
class name, attribute name, URL or style). `category` and `kind` are not model
text: `category` is a display label cut to 40 runes, `kind` is the closed set
above.

## Stored document

`textHash` is the hash of the text that was reviewed; a current entry's text
must still match it for the corrections to be placed. `dropped` counts the
annotations the server discarded (`notFound`, `wrongScript`, `noChange`,
`overlap`, `empty`, `tooMany`) and is shown only for diagnosis. `provider` and
`fallbackFrom` are optional. `createdAt` is the server's RFC 3339 stamp.

An annotation that cannot be placed in the current text, or whose quote is no
longer present, is still part of the document; the client shows it under the
list-only / missing sections rather than dropping it. An annotation whose
`quote` is not a string is malformed and is dropped by the client (`review-docs.json`).

## Fixtures

| File | Rule | Decoded by |
| --- | --- | --- |
| `kind-resolve.json` | model kind → stored kind (trim, case fold, closed set, default mistake) | `server/internal/journal/resolve_contract_test.go` |
| `review-docs.json` | stored document → what a client shows (kinds, legacy rows, bogus kinds, malformed fields, extra keys) | `apps/web/src/lib/features/journal/review.test.ts` |
| `entries.json` | what `PUT` of an entry and of the settings accepts, the limits, the settings defaults and lenient reads | `server/internal/journal/entries_contract_test.go`, `apps/web/src/lib/features/journal/entries.contract.test.ts` |
| `conversations.json` | the levels and limits of a conversation, what a start and a turn accept, the transcript of a saved one, lenient reads | `server/internal/journal/conversation_contract_test.go`, `apps/web/src/lib/features/journal/conversation/conversations.contract.test.ts` |

Fixtures win over code. The server is the only writer of `kind`; every client
reads it with the same fallback.
