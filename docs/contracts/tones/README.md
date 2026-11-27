# Tones: citation tones, spoken tones (sandhi) and grading

Mandarin tone exercises (the Tones flashcard; the tone-pair drill, #180) check the tones a learner marks against a
word's reading. Every client works out the spoken tones and grades with the same rules and the same fixture.

Fixture: `sandhi.json` (rule `tones/sandhi`): `cases` (a reading → its citation and spoken tones) and `grading` (the
verdict of the tone card). Web: `apps/web/src/lib/exercises/toneSandhi.ts` and `tones.ts` (`toneVerdict`), decoded
by `toneSandhi.contract.test.ts`. Go: `server/internal/pinyin/sandhi_contract_test.go` (each case's CC-CEDICT
numbered pinyin gives the marked reading the server sends, `pinyin.ToMarked`, and the citation tones,
`pinyin.ToNumbered`, one character per syllable). The settings that steer it are the workspace-settings key `tones`
(`settings/tones.json`).

## Citation and spoken tones

- The **citation tones** are the dictionary's: the readings the server sends (CC-CEDICT `bu4 ke4 qi5` is sent as
  `bù kè qi`), parsed per syllable (1–4, 5 the neutral tone).
- The **spoken tones** are worked out from them, per reading, by the rules below (tone sandhi). A syllable whose
  spoken tone differs from its citation tone is a **sandhi syllable**.

The rules look at each syllable's citation tone, its **character** — only when the written form has exactly one Han
character per syllable (otherwise no syllable has one, and 不 and 一 cannot be told from the pinyin: 一 and 衣 are
both yī) — and the **word boundaries** (`words`: syllable counts per word; absent, or not adding up to the syllable
count, the reading is one word). A dictionary entry is one word: the segmenter returns an entry whole (greedy
longest match), so a card never needs it; running text (a sentence) passes the segmenter's words.

1. **不**: the character 不 on the syllable `bu` with citation tone 4, before a syllable whose citation tone is 4, is
   spoken **2** (不客气 bú kè qi, 不是 bú shì). Before any other tone, alone or at the end it stays 4.
2. **一**: the character 一 on the syllable `yi` with citation tone 1 is spoken **2** before a citation 4th tone
   (一个 yí gè) and **4** before a 1st, 2nd or 3rd tone (一天 yì tiān, 一直 yì zhí, 一起 yì qǐ, 一百 yì bǎi). It stays
   **1** alone, at the end (统一), before a neutral tone, right after an `ordinalBefore` character (第一, 初一), and
   right before or after a `numerals` character (十一, 一一: a number read out).
3. **Third tones**: from the last syllable to the first, a syllable with citation tone 3 followed by a 3rd tone is
   spoken **2**. Inside a word the next syllable's **citation** tone counts (a run inside a word: all but the last,
   展览馆 zhán lán guǎn); across a word boundary the next syllable's **spoken** tone counts (我|很好 wǒ hén hǎo,
   我|也|很好 wó yě hén hǎo, 展览|馆 zhán lán guǎn). Before a neutral tone a 3rd tone stays (我们).

Rules 1 and 2 use citation tones only and touch only 不 and 一 (never a 3rd tone), so the order does not matter.

Not covered: 一 and 不 as neutral tones inside reduplications and A-not-A questions (看一看, 是不是: the dictionary's
citation tones are graded there), a 3rd tone before a neutral syllable that was a 3rd tone (小姐 xiáo jie), and the
half-third tone (a contour, not a tone number). With the default grading their citation tones are right.

## Grading (`grading`)

Per reading of the same syllable count as the answer (a polyphone has several), each syllable is right when the
marked tone is

- **by default**: its citation tone **or** its spoken tone (the spoken tone is not a mistake);
- with **`gradeSpoken`** (Settings, "Grade spoken tones"): its spoken tone only.

The reading with the fewest wrong syllables is the verdict's (ties: the first); it reports `correct`, `wrong` (the
number of wrong syllables), `marks` (per syllable) and the reading's `spoken` tones (null when no reading has the
answer's length: every syllable is wrong). The suggested grade follows `wrong` as before (0 Good, 1 Hard, more
Again).

## Showing

With "Show tone sandhi" on (the default) the answer of a sandhi syllable shows both, citation then spoken: `bù → bú`,
or with pinyin hidden (`settings/romanisation.json`) tone numbers and contours, `4ˋ → 2ˊ`. Off, only citation tones
are shown, also while spoken tones are graded; the card then says that spoken tones are graded.
