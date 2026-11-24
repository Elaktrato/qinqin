# Language profiles (`profiles.json`)

Issue #199, record 0006. One core definition per language of what the language *has*; availability checks
read it instead of comparing language codes. Reading code (pinyin, kana, deinflection, the lemma tables)
stays language code: a profile says whether a language has tones, not how to parse them.

A code resolves by its primary subtag, case-insensitive (`zh-TW`, `zh_Hant`, `ZH` → `zh`). Every code
without a profile gets the fallback (`code: "*"`).

| Member | Meaning | Read by |
| --- | --- | --- |
| `script` | `han`, `latin` or `other` | the Characters tab, the character-map widget, the parts search and radical filter, the weekly characters, the han milestones (web `usesHan`); the character breakdown of a word (server `entryCharacters`); the journal's script check of a correction (server `journal.CorrectionFitsLanguage`) |
| `readings` | the reading systems an entry carries (`pinyin`, `kana`) | informational: which reading code exists |
| `segmentation` | `dictionary` (words found by lookup, no spaces) or `spaces` | the reader's word counts and Words tab, the word salad's tokens |
| `tones` | tone practice exists | tone eligibility |
| `strokes` | the stroke player has data | the entry page's stroke player |
| `kana` | the language writes kana | the journal's script check |
| `variants` | traditional/simplified variants | the variant label, the reader's and grammar's variant choice |
| `cardKinds` | the card kinds a session and the setup may hold | the session's kinds, Study → card types |
| `practiceModes` | `decks`, `levels`, `characterMap` | which practice the language offers |

The fallback is the plain set: no readings, space segmentation, no tones, strokes, kana or variants, the card
kinds `vocab`, `sentence`, `reverse`, `cloze`, decks and levels. The Spanish demo is exactly that with
`script: "latin"`. Grammar lessons are not in a profile: they come from grammar packs of any language.

## How to add a language

1. Add its profile to `profiles.json` (and a `resolve` case), then the same row to
   `server/internal/lang/profile.go` and `apps/web/src/lib/languageProfiles.ts`; both tests compare the table
   with the fixture.
2. Install its data packs (dictionary, levels, sentences; `packages/`). A language without a code pack is
   data-only (`lang.KindData`), like Spanish.
3. Reading code (a tokenizer, readings, deinflection) is a code pack in `server/internal/lang` (`Register`)
   and only needed when `segmentation` is `dictionary` or the language has readings.

| File | Rule | Decoded by |
| --- | --- | --- |
| `profiles.json` | the profiles and how a code resolves | `server/internal/lang/profile_test.go`, `apps/web/src/lib/languageProfiles.test.ts` |
