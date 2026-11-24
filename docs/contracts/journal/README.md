# Journal documents (`/api/journal/*`)

Issues #103 and #199. The journal is a core feature with a per-user switch (`features/`). Its documents are
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
`journal:suggestions`, `journal:settings`; `backup/README.md`).

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

Fixtures win over code. The server is the only writer of `kind`; every client
reads it with the same fallback.
