# Scripts: learn the writing system first

**Scripts** (`/scripts`, the "Aa" icon in the top bar or the phone menu) teaches the writing system of the workspace's language before its words: **hiragana and katakana** for Japanese, **Hangul** for Korean and the **Cyrillic** alphabet for Russian. It is a core feature: it is on until you switch it off in [Settings → Features](Settings-tour#features). It appears **only** in a workspace whose language has a writing system to teach (the language profile decides; Chinese and Spanish workspaces do not show it).

It is **not a flashcard deck**. Nothing is added to your decks or the study queue, and the cards' scheduling never sees it. It keeps its own progress per workspace.

## The chart

Each writing system has a chart grouped as the system is taught:

- **Kana**: the basic 46, then dakuten (が, ざ, …), handakuten (ぱ, …) and the combinations (きゃ, …), for hiragana and katakana separately.
- **Hangul**: consonants, tense consonants, vowels and compound vowels, plus **Build a syllable**: pick a first consonant, a vowel and an optional final consonant (batchim) and see the block and how it reads.
- **Cyrillic**: vowels, consonants and the two signs. Letters that look like Latin letters but sound different (В, Н, Р, С, У, Х) are marked, and notes describe italic and handwriting forms (д, и, п, т).

Each cell shows the letter and its romanisation; its frame says how well you know it (not seen, learning, known; a ✓ marks known, a dashed frame learning, a darker frame due for review). Tap a cell for its sound (the play button), the keyboard key that types it and notes.

## Practice

Four modes, ten questions a round, feedback after each:

- **Recognise**: see the letter, choose its sound.
- **Recall**: see the sound, choose the letter.
- **Read**: read example words (and for Hangul, syllable blocks built from the jamo you have practised) and choose how they sound.
- **Type**: see the sound and type the letter with your keyboard (a Japanese input method, the Korean 2-set layout, the Russian ЙЦУКЕН layout). A hint shows the key.

Each round starts with what is due, then up to five new letters in chart order, then the weakest ones. A letter is **known** after three correct answers, the second at least 10 minutes and the third at least a day after the one before (a letter is promoted only when it is due, so repeating it in one sitting does not climb). After that the waits grow: 3 days, 7 days, 21 days. A wrong answer sends the letter back to be asked again within a minute.

Sound comes from your device's voice (the browser's speech synthesis, or Android's text-to-speech in the app); the play button appears only when the device has a voice for the language. Installing a voice: [Settings → Audio](Settings-tour).

## Progress, stats and the heatmap

Your progress is **derived from your answers**, which are stored as `script` study events (system, item, mode, right or wrong). Every answer counts as activity on the [heatmap](Stats-and-heatmap) as "Script practice", and the **Script practice** widget on Stats and Home shows how many letters of each system you know. Answers given offline wait in the browser and are sent on the next visit.

## Not here yet

- **Write mode** (stroke order). KanjiVG, the usual source of kana strokes, is CC BY-SA 3.0, below the project's licence floor, and qinqin has not yet written stroke data for kana, jamo or Cyrillic.
- **Audio recordings**: only the device voice.

## Data and licence

The charts, example words and key hints are written by the qinqin project and released under CC0 (public domain). See [Data and licences](Data-and-licences).
