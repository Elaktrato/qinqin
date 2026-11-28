# The conjugation trainer: a Japanese drill for verbs and adjectives (#178, 2026-11-28)

Milestone v0.9.0, phase 5 (plan §3 "Drills framework", §4). The first Japanese drill on the drills framework
(`docs/superpowers/plans/2026-11-28-drills-framework.md`, `docs/contracts/drills/`). Branch
`feature/v090-178-conjugation` from `feature/v0.9.0` (3834cc8f, ContractVersion 28).

## What (issue and owner decisions)

- **A drill** (`conjugation`) in the Practice area: an item is **word × form family**, with its own FSRS schedule
  replayed from its `drill.conjugation` events, outside the flashcard queue; it joins "Practise weakest" and counts
  in the heatmap, the weekly summary, goals, EXP and the streak (the framework does all of that once registered).
- **Two directions:** produce the form ("食べる → polite past: ＿＿", typed through the IME, with a multiple-choice
  fallback) and recognise it ("食べられなかった → which form?").
- **Words** come from the learner's decks: Japanese vocabulary cards, verbs and adjectives only, by JMdict's parts
  of speech (v5*, v1, vk, vs-i, vs-s, adj-i, adj-ix, adj-na; the irregulars 来る, する, 行く, ある, 問う and the
  honorific v5aru verbs).
- **Learners choose the form families** they practise.
- **One rules table, shared:** the conjugation engine and the reader's lemmatizer (#165) understand the same forms;
  the engine's fixtures are checked against the lemmatizer's table.
- **Phone first:** 360 px, no sideways scroll, hidden romaji respected, the Android WebView keyboard kept up between
  items and IME composition handled (Enter while composing never submits).
- **Content review:** the generated forms are reviewed by two Japanese teacher agents; findings applied, notes below.

## The design

### The engine (server, `internal/conjugation`; contract `docs/contracts/conjugation/`)

- **Class** of an entry: the first part-of-speech tag, sense by sense in order, that is one of the engine's classes
  (`v1`, `v1-s`, `v5u`, `v5u-s`, `v5k`, `v5k-s`, `v5g`, `v5s`, `v5t`, `v5n`, `v5b`, `v5m`, `v5r`, `v5r-i`, `v5aru`,
  `vk`, `vs-i`, `vs-s`, `adj-i`, `adj-ix`, `adj-na`). No such tag: not eligible.
- **Forms** (`classes.json`, `forms.json`): per class, the dictionary ending and per form the suffixes that replace
  it (first one canonical, the others accepted). A form is computed on the written form and on the kana reading;
  for the two-kana endings of 来る and いい a written form with a kanji (来る, 良い) keeps the kanji.
- **Form families** (`families.json`, after the content review): `polite` (polite, polite negative, polite let's
  ましょう), `polite-past` (polite past, polite past negative), `negative`, `past` (past, past negative), `te-form`,
  `potential`, `volitional` (plain), `conditional` (ば/なら, たら), `passive`, `causative`. On by default: the first
  five (beginner); off: the rest.
- **Item key** `<entryId>:<family>` (`1234:te-form`), as the drills README planned.

### The route

`POST /api/drills/conjugation/words {"ids": [...]}` (1 to 500 entry ids): for each eligible entry its class, written
form, kana reading, readings (romaji included, for the romanisation switch), the families it has and every form
with its accepted answers and their romaji. The caller's own entry patch applies as for `POST /api/entries/bases`.

### The web drill (`lib/features/practice/conjugation/`)

- Candidates: the workspace's Japanese vocabulary cards that have a review, in the order of their first review,
  through the route; then word × enabled family.
- A question picks the form inside the family by the item's answer count (it rotates) and the direction by its
  history (recognise first and after an Again, then produce).
- Produce: a text field (IME composition aware), Check; "Show choices" swaps the field for four choices. Right
  typed = Good, right from the choices = Hard, wrong = Again. Recognise: four form names; right = Good.
- Settings → Study → Conjugation (Japanese workspaces): one switch per family, the workspace-settings key
  `conjugation: {families: {<family>: boolean}}`, merge patch per switch.

## Tasks

1. This plan.
2. Contract and engine (Go, test first): `docs/contracts/conjugation/` (README, `families.json`, `classes.json`,
   `forms.json`), `internal/conjugation` (Classify, Conjugate, Families), the lemmatizer round trip.
3. Content review of the generated forms by two Japanese teacher agents; findings applied (fixtures and engine).
4. Server: the route, the registry (`drills.IDs`, contract `registry`, `events/activity.json`), ContractVersion 29.
5. Web core: the settings key (`lib/exercises/conjugationSettings.ts`), the registry `DRILL_IDS`, activity words.
6. Web drill: the words client, the items, the answer check, the question component, the drill definition, Settings
   → Study → Conjugation; DOM tests first.
7. e2e: a spec with a small JMdict pack seeded on its own server: a round at 360 px through typed and chosen
   answers, the events on the server, the paths in `phone-width.spec.ts`.
8. Docs: contracts README index and CHANGELOG, settings README row, drills README, wiki, `docs/releases/NEXT.md`.

## Rulings

The contract rulings (class only from the tags, `vs` nouns not drilled, the `vs-s` allowlist, beginner defaults,
ましょう in polite, no compound forms, later families, two tables held together by a test) are in
`docs/contracts/conjugation/README.md`. The others:

- Ruling: **the server conjugates**, the web only shows and checks (`POST /api/drills/conjugation/words`) — the engine
  lives next to the lemmatizer it is checked against, the server has the parts of speech and derives the romaji, and
  an Android client needs only the route — cost if wrong: the drill needs the network to load its words (no offline
  round; the answers are still written through the outbox).
- Ruling: the route is **its own** (not more members on `POST /api/entries/bases`), `noTok`, POST is never cached by
  the service worker — the bases are shared by the deck lists and stay small; no token use is known — cost: one route.
- Ruling: the route applies the caller's **own entry patch** (written form and readings) like the bases, and conjugates
  the headword and the first kana reading; the entry's other spellings (not search-only) are accepted after it — what
  the learner sees on the card is what is conjugated — cost if wrong: a patched reading that no longer ends in the
  ending drops the word from the drill.
- Ruling: **words** are the workspace's word cards (any kind, not character entries) with at least one review, first
  reviewed first — "words they know"; a card never reviewed is not known yet — cost if wrong: a new deck's words join
  the drill after their first review.
- Ruling: **direction**: an item with no answer, or whose last answer was Again, is recognised; otherwise produced —
  seeing a form before producing it, and back to recognition after a miss — cost if wrong: one recognise question more
  per new item.
- Ruling: the **form inside a family** rotates with the item's answer count (answers mod the forms the word has) — one
  schedule per family covers all its forms in turn — cost if wrong: a weak form is not asked more often than the
  others (the review suggested splitting the polite family; done for polite past).
- Ruling: grades: typed right (canonical or accepted) **Good**, right from **Show choices** **Hard**, a recognised form
  right **Good**, wrong **Again**; never Easy — the framework's "right after a hint" — cost: none.
- Ruling: **typed answers** are compared after NFKC, without white space, katakana as hiragana and without a final 。
  or . — the IME gives full-width or katakana text — cost if wrong: none known.
- Ruling: the **produce field keeps its focus** after an answer (read-only, Enter moves on), so the phone keyboard stays
  up between produce questions; a recognise question has no field, so the keyboard goes down there — a hidden field
  to hold the keyboard would trap screen readers — cost: the keyboard reopens after a recognise question.
- Ruling: **Enter** checks only when `isComposing` is false, keyCode is not 229 and no composition is open
  (`compositionstart`/`compositionend`) — the Android WebView sends 229 — cost: none.
- Ruling: the **kana reading is shown** next to every kanji form, the romaji of the dictionary form and of an answer
  only through `useRomanisation()` — the teacher reviews asked for the reading (来ない【こない】) — cost: none.
- Ruling: the setting is a **workspace-settings key** `conjugation.families` with one boolean per family, written by
  merge patch per switch, in Settings → Study → Conjugation (Japanese workspaces) — the same pattern as `tones`
  (#300) — cost if wrong: none; every family off empties the drill ("Nothing to practise in this drill yet").
- Ruling: the e2e spec runs on its **own server with a small JMdict-format pack** (`fixtures/conjugation`) — the
  shared e2e pack is JSON without parts of speech, and adding a pack to every server would change other specs'
  search results — cost: one more server start in the suite.
- Ruling: the framework's e2e and DOM tests that assumed "no drill applies" in Japanese now use **Chinese** or Korean
  — the conjugation drill applies to Japanese — cost: #180 (tone pairs, Chinese) must move them again (see the
  report).
- Ruling: ContractVersion **29** (28 on the base; the orchestrator renumbers).

## Content review (teacher agents)

Two Japanese teacher agents (`claude -p --effort high`, prompted as teachers with 15+ years from beginners to N2), two
rounds each, on the hand-typed expected forms that the engine must reproduce (53 words, every form, `forms.json`).

**Round 1** (both): no wrong form in the sample. Findings applied:

- MUST: potential = passive (食べられる, 来られる) in recognition and choices → every matching form is right, none
  is a wrong choice (`check.ts`). `vs-s` must not follow 愛する everywhere (察しない, 達しない) → split. ござる only its
  polite forms. 有る's negative in kana (ない).
- SHOULD: defaults → beginner families only; ましょう → polite family; exclusions per form, with a class or reading;
  causative excluded for 見える/聞こえる/要る; the non-volitional and intransitive-pair verbs, humble verbs (参りましょう
  kept), 関する/対する/反する dropped, ない without double negatives, 死ぬ/殺す without volitional, 来る read きたる out;
  いれる refused for いる; いらして/いらした accepted; 出来る, 勉強出来る, よいです and other spellings accepted; ゆく gives
  いった/いって; labels say "plain" and carry kana hints, "ば (〜ば / 〜なら)"; regression words added (入る, 切る/着る,
  要る/居る, 行う, 言う, 請う, おっしゃる, 持って来る, 出て行く, かわいい, きれい, 出来る, ない); the reading shown with kanji.
- Not applied (later families, recorded in the contract): 〜たい, 〜ている, 〜ないで/〜なくて, imperative, causative-passive,
  adverbial forms; targeted feedback for typical errors (高いでした); `vz` verbs (skipped explicitly).

**Round 2** (both, on the engine's output after round 1): "no wrong canonical forms". Findings applied:

- MUST: the `vs-s` さない rule only for verbs with a godan twin (有さない, 要さない, 反さない were wrong) → allowlist of
  stems; the others keep the する forms with volitional (察しよう, 罰しましょう), no potential or causative; 訳せば first
  (愛すれば kept first for 愛する). The kana-only いる of class v5r (要る) cannot be told from 居る in a prompt → not drilled.
- SHOULD: いらしたら accepted; ありません/ありませんでした accepted for the adjective ない; the polite negative label fits
  adjectives (〜ません / 〜くないです), pattern hints on the polite past labels; かっこよいです no longer accepted (よいです only
  for いい itself); 要する/有する without volitional or passive.
- Noted, nothing to change: the duplicate 分かる and 来る/くる, ある/有る blocks are separate fixture cases (spellings
  are merged per entry by the route); recognition shows only canonical forms (never 食べれる); ゆく only for an entry
  whose headword reading is ゆく.

The review notes are kept here; the reviews themselves were scratch files of this run.

## Execution record

Commits: the plan; the engine and its contract (`internal/conjugation`, `families.json`, `forms.json`, README; review
round 1 applied); the route and contract 29 (round 2 applied, `settings.json`, `words.json`, CHANGELOG, index, the
settings key row); the web drill and its registration (Go `drills.IDs`, `drills.json` registry, `events/activity.json`,
web `DRILL_IDS`/`DRILLS`, activity words, Settings → Study → Conjugation); e2e; two test follow-ups; docs.

Test first, seen failing before the code: `TestFamiliesContract`, `TestFormsContract`, `TestFormsDeinflect` (package
missing; then 297 lemmatizer misses, which became the honest `lemmaGaps` list), `TestConjugationWords` (404 with the
route row commented out), `conjugationSettings.test.ts`, `words.test.ts`, `check.test.ts`, `items.test.ts` (modules
missing). The expected forms are typed by hand (a typing aid swapped the kanji stem for its kana; two of its slips,
判かります and べんきょう出来る, were caught by the engine's test and fixed in the oracle).

Written with or right after the code (not seen failing first): `ime.test.ts`, `ConjugationDrill.dom.test.ts`,
`ConjugationSettings.dom.test.ts`, the e2e spec (failed once on an ambiguous `status` locator, then passed), the
route's words fixture (generated from the route with `UPDATE_CONJUGATION_FIXTURE=1` and read by hand).

Not green at every commit: the registration commit left two Go tests red that the full run found
(`TestStatsActivityDefaults` counted five sources) and three web tests (the frame sections and the goal choices
assumed no registered drill); fixed in the two follow-up commits right after.

Gates (final): Go `gofmt` clean, `go vet ./...`, `go test ./...` 64 packages ok, only the known
`internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6); `internal/api` re-run green after the fix.
Web `check` 0 errors (2110 files); full vitest on Node 26: 764 files, 15381 passed, 3 skipped; e2e 69 passed, 1
failed in the full run (`hide-romanisation.spec.ts` Chinese: pinyin still on the word page right after the Settings
radio, a timing flake not touched by this work; 3 of 3 passed alone); `node --test scripts/*.test.mjs` 241 passed,
1 skipped; `gen-api-docs --check` clean.

No separate scratch-server run: the e2e spec runs the real binary with a JMdict-format pack and checks the
`drill.conjugation` events on the server.

## Local follow-up

- **Android shell (#178):** in a Japanese workspace with a few reviewed verbs (a JMdict install), open Practice →
  Conjugation. On a produce question type with Gboard's Japanese input: the Enter that converts かいた → 書いた must not
  check; the next Enter checks; the keyboard stays up and Enter moves to the next produce question; the hardware back
  button leaves the round; nothing scrolls sideways at 360 px. No emulator here.
- **iOS/desktop IMEs:** the same composition check with the macOS/Windows Japanese IME in a desktop browser (only the
  synthetic events were tested).
- **A person's review:** the forms and exclusions were reviewed by two teacher agents only; a native teacher should
  look at `docs/contracts/conjugation/forms.json` and the exclusion list.
- **Lemmatizer gaps:** `lemmaGaps` (182 forms: い-adjective です forms, いい's よ- forms, v5aru's い-stem, 問う/請う,
  the 愛する pattern, くる in kana, ある's ない, …) are forms the reader cannot look up yet: a follow-up on the rule
  table (#165).
- **Later families** from both reviews: 〜たい, 〜ている, 〜ないで/〜なくて, the imperative, the causative-passive, the
  adjectives' adverbial form.
