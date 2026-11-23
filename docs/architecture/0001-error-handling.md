# 0001. Error handling: one coded error answer, shown by code

## Status

Accepted

Touched by: #194, #195, #199. A merge from one of these issues that changes what this record names updates the record.

## Context

The contract (`docs/contracts/auth/errors.json`) said every error body is `{error, message}` and clients
translate the `error` code. The code did not follow it (#168): about 350 `http.Error` calls answered in
`text/plain`, three separate JSON writers had grown, and the web sniffed bodies and showed the server's English
`message` or developer `Error` text on about 35 screens. #168 (merged into `develop` in 72705c92) made the
server and the web follow one rule. Design: [the error contract spec](../superpowers/specs/2026-11-23-error-contract-design.md).

## Decision

**Server.** Every error answer of `server/internal/api` goes through one writer,
`writeError(w, status, code, message, extra...)` in `server/internal/api/errors.go`: JSON
`{"error": code, "message": message}` plus optional members beside the two fixed ones (`attemptsLeft`,
`existingId`, ...). `code` is a code of `docs/contracts/auth/errors.json` with the status the catalogue gives it, or a status its
catalogue entry documents (`documentedStatuses`: `code_invalid` and `challenge_expired` 401 on the anonymous
sign-in steps, `bad_request` 422 on the AI routes).
`message` is an English sentence for developers and logs; it never carries a path, SQL, a token, a stack or a
lower layer's error text (validation messages of our own packages may pass through). Request bodies are read
with `decodeBody` / `readBody` / `badBody` (413 `too_large`, 400 `bad_request`). Unmatched API paths
(`codedUnmatched`: 404 `not_found`, 405 `method_not_allowed`), `http.ServeContent` answers (`serveContent`:
416, 412) and panics before any byte (`recoverPanics`: 500 `internal`) are coded the same way.

**Web.** `ApiError` (`apps/web/src/lib/api/client.ts`) parses the body once into `code` and `body`. A screen
shows a failure only through `errorText(err, fallback)` (`apps/web/src/lib/api/apiErrors.ts`): the catalogue
text of a known code (`API_ERROR_KEYS`, `apiError.<code>` in `en.json`), the translated text of a `UserError`,
the text of a `ShownError` (already interface text), else the screen's own fallback. Errors the app raises for
the learner are `UserError` (a catalogue key and arguments, `apps/web/src/lib/api/userError.ts`); developer
errors stay plain `Error`s.

## Consequences

- A client branches on and translates the code; the English message is never interface text.
- A new error needs a catalogue code (with its status), an `apiError.<code>` key with text, a line in the
  contract changelog ([`docs/contracts/CHANGELOG.md`](../contracts/CHANGELOG.md); the catalogue's changes up
  to #168 are in [its own changelog](../contracts/auth/README.md#changelog)) and a regenerated API errors wiki
  page; status codes do not change when a body is reworded.
- Old web shells may show raw JSON on some screens until they reload (accepted in #168).

## Allowed / Not allowed

Allowed:

- `writeError` with a literal catalogue code and its catalogue status; a computed code only in the functions
  listed in `dynamicCodeWriters` (in `server/internal/api/errors_static_test.go`), each listed with every code it
  can produce: the AI error mapper (`writeAIError`), the mail settings validator and test mail
  (`writeSMTPInputError`, `handleTestSMTP`), the restricted-session gates (`requirePrincipal`,
  `requireAdminPrincipal`, `tokenGate`) and backup (`handleExportDownload`, `handleRestoreUpload`). The pack
  error mapper (`writePackError`) writes literal codes.
- `writeClientGone` (499 without a body) for a request whose client is gone.
- One server sentence shown in the interface: `packErrorDetail`, the pack validator's reason under the
  translated `pack_invalid` text, marked as English detail for the administrator.

Not allowed:

- `http.Error`, `http.NotFound`, or `writeJSON` with an `"error"` member in `server/internal/api`.
- A new local error writer or body decoder beside the ones above.
- On the web: `err.message`, `String(err)` or the server's `message` reaching visible state; a user-facing
  `throw new Error('…')`; a local `message(err)` helper.

## Enforcement

- `TestEveryErrorGoesThroughWriteError` (`server/internal/api/errors_static_test.go`): an AST scan of every
  non-test file of the package for the forbidden calls, unknown codes and wrong statuses.
- `TestEveryErrorAnswerIsCodedJSON` (`server/internal/api/errors_walk_test.go`): walks every route of
  `routes()` as anonymous, user and admin with empty, malformed and unknown inputs, plus unmatched paths and
  wrong methods; every answer of status 400 and above must be JSON with a catalogue code and a message.
- `server/internal/api/errors_test.go` (the writer and decoder) and `TestAuthErrorCatalogueIsCoherent`
  (`server/internal/api/contract_auth_test.go`).
- Web: `apps/web/src/lib/api/apiErrors.test.ts` fails on a catalogue code without an `apiError.*` key; the i18n
  lint's `errmsg` rule (`errMessageFindings` in `apps/web/src/lib/i18n/lint.ts`, run by
  `apps/web/src/lib/i18n/hardcoded.test.ts`) flags a caught error's own text under `lib/` and `routes/`, with
  exceptions only in `apps/web/src/lib/i18n/allowlist.json`, each with a reason.
- `node scripts/gen-api-docs.mjs --check` keeps the API errors wiki page equal to the catalogue.
- Review, since no check sees these: a new local error writer or body decoder, a user-facing
  `throw new Error('…')`, a local `message(err)` helper, an error-status `http.Redirect`; whether a validation
  message of our own package quotes internal state; a renamed caught variable, which slips past the regex lint.
