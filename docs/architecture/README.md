# Architecture records

An architecture record pins one rule of **code structure**: where a kind of code lives, which layer may do
what, how a cross-cutting concern (errors, tests, features) is built. Each record says what was decided, why,
what it allows and forbids, and how the rule is enforced, by a test wherever one is practical. Read the records
before changing the structure they cover; a change that breaks a record changes the record in the same branch.

**Records and contracts.** [`docs/contracts/`](../contracts/README.md) pins the **data** rules that every
client (the server, the web app, Android) must implement identically: wire shapes, row keys, formats, error
codes, each with JSON fixtures the Go and web tests decode. A record pins how **this** code base is put
together; another client may be built differently and still follow every contract. Where a decision has both
parts (the error contract, unreadable rows), the contract holds the data rule and the record holds the code
that implements it, and the record links the contract instead of repeating it.

## The template

A record is `NNNN-short-name.md` in this folder, numbered in order (`0001`, `0002`, ...); a number is never
reused. The first line is `# NNNN. Title`, then these sections, in this order:

```md
## Status
One line, one of the status values below; then a line "Touched by: #N, #M." naming the open issues that
change the code the record describes, or "Touched by: none." when no open issue does.

## Context
What problem or drift made the decision necessary; the issue that decided it.

## Decision
The rule, stated so that a reviewer can check a change against it.

## Consequences
What follows from the rule: what becomes easier, what costs more, what other code must do.

## Allowed / Not allowed
Short lists of what the rule permits and what it forbids, with examples from the code.

## Enforcement
The test, lint or check that fails when the rule is broken (file and test name), and what review must still
catch by hand.

## Open questions
Optional: points the deciding issue leaves open. Each names who decides it (usually the implementing issue).
```

`architectureDocs.test.ts` (in `apps/web/tests/repo/`) checks every record against this template, checks its
status, its links and its row in the index below, and, for a record in force (`Accepted`), that every
repository path it names in backticks exists.

## Status values

- **Accepted**: in force. The code follows the record and the enforcement it names exists.
- **Accepted, being implemented by #N**: decided by the owner, not yet (fully) built. Issue #N builds it and,
  when it lands, updates the record (what was built, the real names and paths, the enforcement) and sets the
  status to `Accepted`. Until then the record states the decision and the planned enforcement; code that does
  not follow it yet is expected, new code follows it.
- **Superseded**, written `Superseded by [NNNN](NNNN-short-name.md)` with a link to the new record: replaced
  by a later record. The old record stays, unchanged except for its status line, so the history of the
  decision can be read.

## Index

| Record | Title | Status |
|---|---|---|
| [0001](0001-error-handling.md) | Error handling: one coded error answer, shown by code | Accepted |
| [0002](0002-sync-unreadable-rows.md) | Sync: an unreadable row is skipped, never the page | Accepted |
| [0003](0003-domain-packages-own-their-sql.md) | Server: domain packages own their SQL | Accepted |
| [0004](0004-web-folder-rules.md) | Web: folder rules | Accepted |
| [0005](0005-test-conventions.md) | Test conventions | Accepted |
| [0006](0006-core-features-instead-of-code-plugins.md) | Core features, feature switches, language profiles and data packs instead of code plugins | Accepted |
| [0007](0007-browser-end-to-end-tests.md) | Browser end-to-end tests | Accepted |
| [0008](0008-pack-types.md) | Server: one pack system and how to add a pack type | Accepted |
| [0009](0009-web-state-model.md) | Web: one state model (runes, contexts, no hidden singletons) | Accepted |
| [0010](0010-android-shell-and-native-bridge.md) | Android shell and native bridge | Accepted |
| [0011](0011-reminders-and-push.md) | Reminders, web push and the F-Droid-safe notification path | Accepted |

## Adding or changing a record

- A new decision gets the next number, a row in the index and the template's sections; run
  `cd apps/web && npx vitest run tests/repo/architectureDocs.test.ts`.
- The issue that implements a record updates it when it lands (status, names, enforcement), and so does
  every merge from an issue on a record's "Touched by" line that changes the code, paths or names the record
  describes. A new issue that will change such code is added to the line.
- A decision that replaces a record is a new record; the old one's status becomes
  `Superseded by [NNNN](NNNN-short-name.md)`.
