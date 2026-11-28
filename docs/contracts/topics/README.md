# Topic labels (`topics/`)

Which themes (food, family, travel …) a word belongs to, so a course can fill its units by theme (#220; the course
pack and its fill rule are #221, design `docs/superpowers/specs/2026-11-24-courses-design.md` §6 and §9). Plan and
rulings: `docs/superpowers/plans/2026-11-27-220-topic-labels.md`.

Fixtures:

- `topics.json` — the topic list (rule `topics/list`). Go: `server/internal/topics/contract_test.go` (the server
  embeds a byte-for-byte copy, `server/internal/topics/topics.json`); web: `lib/languages/topics.test.ts`.
- `labels.json` — which labels files a server accepts (`files`) and the topics of a listed word (`lookup`)
  (rule `topics/labels`). Go: `server/internal/topics/contract_test.go`.

## The topic list (`topics.json`)

One list for every language, in display order: `{id, scope}`. An id is `[a-z][a-z0-9]{1,23}` (it is also a message-key
segment). The name a learner sees is the message `topics.name.<id>` (`apps/web/src/lib/i18n/messages/en.json`);
`scope` is English guidance for the people and agents who label words and is never shown. An id is **stable**: it is
never renamed or reused; a topic that goes is retired, and a client that meets an id it does not know (from a newer
list) ignores it. 49 topics today, including topics for words no theme owns: `function` (grammar words), `qualities`,
`actions`, `movement`, `thinking`, `communication`, `numbers`, `measures`.

## The labels file

One per language, `server/internal/topics/labels/<lang>.json`, embedded in the server, built by
`scripts/build-topic-labels.mjs` from committed inputs (never edited by hand: change an input and rebuild; `--check`
fails on drift). CC BY-SA 4.0: written for the project, and adapted from OpenMoji's groups and from CC-CEDICT and
JMdict, whose words key it (all CC BY-SA 4.0); the file's `attribution` credits them. One label per line, so a change is a one-line diff.

```json
{
 "version": 1, "language": "ja", "license": "CC-BY-SA-4.0", "attribution": "…", "humanReviewed": false,
 "reviewers": [{ "id": "ja-teacher-1", "kind": "agent", "stage": "review", "role": "…" }],
 "labels": [
  {"key":"j:1578850","form":"行く","reading":"いく","topics":["movement"],"confidence":0.95,"basis":"agent","review":"confirmed","by":["ja-teacher-1","ja-teacher-2"]}
 ]
}
```

A server accepts a file when: `version` is 1; `language` is `[a-z]{2,3}`; `license` is `CC-BY-SA-4.0`; `attribution`
is set; reviewer ids are `[a-z0-9][a-z0-9-]{0,39}` and distinct; there are 1–50,000 labels; and each label has:

- `key` — the dictionary entry key (zh: the simplified form; ja: `j:<ent_seq>`), and `form` — the word as a level list
  writes it, both 1–100 bytes; `reading` optional (the list's reading, ≤ 100 bytes; Chinese labels carry none, a label
  is the whole simplified-form entry with all its readings);
- `sense` — absent (0) for the whole word, else 1–99: the 1-based sense of the entry as the importer numbers it (one
  CC-CEDICT line per sense; JMdict senses with an English gloss). A sense row exists only where a common sense
  belongs to a different topic than the word;
- `topics` — 1 to 3 distinct ids of the list, best first;
- `confidence` — in (0, 1]: the outcome of the review (below), not a probability;
- `basis` — `agent` (suggested by an agent, reviewed by teacher agents), `picture` (the topic of the group of the
  word's OpenMoji picture, `scripts/topics/openmoji-topics.tsv`) or `owner`;
- `review` — `confirmed`, `changed`, `adjudicated` or `disputed` (agent labels), `picture`, `owner`;
- `by` — the reviewers who decided it, each listed in `reviewers`; required for `basis` `agent`;
- `note` — optional, ≤ 2,000 bytes: the reviewers' reasons where they changed something.

No two labels share `key`, `form`, `reading` and `sense`. `humanReviewed` is false until a person has read the file
(the Sources page says "reviewed by agents").

## Review and confidence

An agent suggests topics for every word of the lists; two teacher agents of that language review each word
independently (confirm, or give the complete corrected labels with a reason); where their versions differ a third
teacher agent decides, seeing both versions and reasons. `confidence`:

| review | when | confidence |
|---|---|---|
| `confirmed` | both teachers confirmed the suggestion | 0.95 |
| `changed` | both teachers made the same change | 0.90 |
| `adjudicated` | they differed; the third chose one teacher's version (0.80) or wrote its own (0.70) | 0.80 / 0.70 |
| `disputed` | they differed and no decision was recorded | 0.50 |
| `picture` | from the picture's group, no teacher review | 0.60 |
| `owner` | set by the owner | any |

## Looking up a word

The topics of a listed word `{form, reading?}` (a level-list entry): take the labels whose `form` equals the form and,
when both the word and the label have a reading, whose `reading` equals it. If there are none, the word has no reading
and its form is kana only, take the labels whose `reading` equals the form. Order them by `sense` (the word row first),
then list each topic once in that order. No label, no topics. The `lookup` cases pin this.

A fill rule may weigh labels by `basis` and `confidence` (#221 decides).
