# AI example sentences (#186)

A learner asks their own AI provider (Settings → AI, #87) for example sentences of a dictionary word. The server
checks each sentence and keeps the good ones as **drafts**; the learner keeps or deletes each draft, and can report a
bad one (delete it with a reason). A **kept** example is an own sentence of the entry (a user-owned row of the
sentences table, no source pack), marked as AI-written. It is never shared with another user and never part of a
sentences pack. Fixture: `examples.json` (Go: `server/internal/sentences/examples_contract_test.go`; web:
`apps/web/src/lib/entry/examples/examples.contract.test.ts`).

## Scope and storage

- Per user and entry, not per workspace (like every own sentence): a workspace delete keeps them; the account delete
  removes drafts, reports and kept examples; the deletion preview counts reports as `exampleReports` (kept examples
  count in `sentences`).
- Drafts (`example_drafts`): the undecided output of the latest generation for the entry that kept sentences; such a
  generation replaces them, one that kept none leaves them. Never in the pull, never in a backup (a restore drops them), never shown on a card.
- Kept examples: own sentences, so they reach the entry answer (`GET /api/entries/{id}`, after the pack sentences and
  the other own sentences), every card that shows a sentence, the offline copy of the entry, the paged pull
  (`sentences` collection) and the backup (`sentences/NNNNNN.jsonl` line with `ai: {provider, model, level}`). A restore holds such a line to the live rules: a
  provider (at most 64 bytes), a model (at most 200 bytes) and a level of `levels`, all required; a text of at most
  200 code points, a translation of 1 to 400 and a reading of at most 400; at most 10 AI examples per entry. An
  archive that breaks one is refused whole.
- Generation markers (`example_generations`): one per stored generation (request id, level, dropped count, provider,
  model), so a retry of a generation that kept nothing is answered too; kept a day, not in the pull or a backup.
- Reports (`example_reports`): the sentence, its reason, level, provider and model, at most 500 per user (the oldest
  goes first). They stay with the user (no administrator view); not in a backup (a restore keeps them).

## The mark

Every sentence (entry answer, pull row, keep answer) has `ai`: `{provider, model}` for a kept AI example, `null`
for any other. A client shows a sentence with a non-null `ai` as AI-written wherever it shows it (entry page, every
card kind, the cloze card); a malformed non-null value still marks it (`marks` cases).

## Routes (all signed-in users, no access tokens)

| Route | Answer |
| --- | --- |
| `GET /api/entries/{id}/examples` | `{drafts: [Draft], defaultLevel, lastRequest}`: the caller's drafts, oldest first; `defaultLevel` is the level of their latest generation (else latest kept example, else latest draft, else `beginner`); `lastRequest` is the entry's latest stored generation `{requestId, dropped, provider, model}` or `null` |
| `POST /api/entries/{id}/examples` `{level, requestId}` | one AI call with the caller's key, the journal's hourly limit and one call in flight (`in_flight`); 200 `{drafts, dropped, provider, model, requestId}`, where `drafts` are the entry's drafts after the generation (only those with this `requestId` are new). The sentences are checked and stored while the call still holds the user's AI slot. `requestId` (1–64 of `A-Z a-z 0-9 _ -`) makes it idempotent: a stored request id (its marker) is answered without a call, with its `dropped`. 409 `examples_full` at 10 kept examples |
| `POST /api/entries/{id}/examples/{draftId}/keep` | 201 with the kept sentence; 404 for a draft that is not the caller's on that entry; 409 `examples_full` |
| `DELETE /api/entries/{id}/examples/{draftId}[?reason=]` | 204; with a reason the draft is also reported |
| `DELETE /api/entries/{id}/sentences/{sentenceId}[?reason=]` | 204: the caller's kept AI example is deleted (a tombstone the pull ships); with a reason also reported. Any other sentence is 404 |

A reason is one of `reasons`; another value is 400 `bad_request`. The AI errors are the journal's
(`no_key`, `rate_limited`, `in_flight`, ...; `auth/errors.json`). An unknown entry is 404 `not_found`.

`Draft`: `{id, entryId, hanzi, pinyin, translation, level, provider, model, requestId, createdAt}` (the text is
`hanzi` and the reading `pinyin` in every language, as for sentences). `defaultLevel` and `level` are one of
`levels`.

## The server's checks (`checks` cases)

The model is asked for 5 sentences; each is checked in this order and dropped (counted in `dropped`) on the first
failure:

1. Cleaning: control characters go, every run of white space (line breaks included) becomes one space, the ends are
   trimmed (text, reading and translation).
2. `empty`: no text or no translation. `too_long`: a text over 200 or a translation over 400 code points.
3. `wrong_script`: less than half of the text's letters in the language's script (the language profile;
   `lang.MostlyInScript`, the journal's rule).
4. `missing_word`: the text does not contain the word by the cloze card's blank rule (`cards/cloze.json`): a
   segmenter match (`POST /api/segment`, with the lemmatizer, so 食べた counts for 食べる) that resolves to the entry
   (for a word written with Han, a kana-only match such as はし only when the entry is its first candidate, so 箸 is
   not 橋), else a literal occurrence of the written form or a form text that does not lie inside a strictly longer match.
   A language without dictionary segmentation and without a lemma table has the literal rule only, and the prompt
   asks for the exact form.
5. `duplicate`: the cleaned text equals a sentence of the entry the caller sees, or an earlier sentence of the same
   answer.

The reading is emptied (the sentence kept) when the language profile has no reading system, when it is over 400
code points, or when it holds anything but the reading system's letters, punctuation and spaces: for `kana`
hiragana, katakana and the long-vowel mark ー (so romaji is emptied); for `pinyin` Latin letters with or without
tone marks, the tone numbers 1–5 and the apostrophe (so kana is emptied). At most 5 drafts per generation. Every kept example is a cloze
candidate by construction.

## Client rules

- The entry page offers "Generate examples" while the entry has fewer than `limits.fewExamples` sentences with
  text, or has drafts.
- A client reads drafts leniently (`reads` cases): a draft without a numeric `id` or with an empty text is skipped;
  missing strings are empty; an unknown level reads as `beginner`.
- After a lost answer (a network error, 502 or 504) the client reloads `GET …/examples` until `lastRequest` (or a
  draft) carries its request id. After `in_flight` the client
  polls the same way.
