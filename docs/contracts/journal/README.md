# Journal review documents (`qinqin-journal` / `review:<entryId>`)

Issue #103. The journal stores each entry's review as a workspace-scoped
plugin-data row of the built-in plugin `qinqin-journal`:

| Key | Scope | Shape |
| --- | --- | --- |
| `review:<entryId>` | workspace | `{entryId, textHash, annotations[], overall, model, provider?, fallbackFrom?, dropped, createdAt}` |

The row is written by `POST /api/journal/review`; clients read it through the
plugin-data list route (`GET /api/plugins/qinqin-journal/data?workspace=<id>&prefix=review:<entryId>`)
or receive it as the answer of the review route. The journal is **not** in
Android's first plugin set; this folder pins the document so any client that
shows a review (web, the Android plugin later) shows the same corrections.

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
  `apps/web/src/lib/plugins/journal/review.test.ts`.

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
| `review-docs.json` | stored document → what a client shows (kinds, legacy rows, bogus kinds, malformed fields, extra keys) | `apps/web/src/lib/plugins/journal/review.test.ts` |

Fixtures win over code. The server is the only writer of `kind`; every client
reads it with the same fallback.
