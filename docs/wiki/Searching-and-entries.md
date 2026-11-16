# Searching and entries

## Search

Search looks across written forms, readings and meanings and is scoped to the language of the current workspace. Hits are ranked in tiers: exact written form, exact reading, reading prefix, bopomofo prefix, and then a substring of a meaning. Within a tier, words that are usually written in kana and have a priority mark come first, then by priority. The server returns at most 50 hits by default.

Readings you can search by: pinyin and bopomofo for Chinese, kana (and romaji) for Japanese.

## Entries

An entry is one dictionary headword, either a **word** or a **character** (kanji or hanzi).

- **Meanings keep their source.** Each sense is tagged with the dictionary it comes from, with its licence and attribution, so several dictionaries can describe the same entry. Hidden dictionaries ([Workspaces and languages](Workspaces-and-languages)) are filtered out.
- **Chinese**: one entry per simplified written form; traditional forms are forms of the same entry, so searching 學習 finds 学习. A written form with several readings (行 xíng, háng) is one entry with all readings.
- **Japanese**: one entry per JMdict word, with all forms and readings and part-of-speech tags per sense. Homographs are separate entries.
- **Characters** show readings, radicals, variants and stroke counts. Chinese character entries add animated stroke order. A radical entry lists the characters classified under it.
- **Level badges** (HSK, JLPT and other level schemes you have installed) appear on entries; word-based schemes derive badges for their characters.
- **Frequency**: a rank chip appears where a frequency pack covers the word. Frequency also orders lookup results when a pack exists.
- **Example sentences** come from installed sentence packs plus your own. Sentences you save are private to you.
- **Audio**: where an audio pack covers a word, a play button appears. Clips are credited on the Sources page.

## Your own edits

You can correct written forms and readings of an entry. The edit is stored per user as a patch over the shared data; the shared dictionary is never changed, and clearing a field reverts it to the shared value. Your edited readings are used in the Reader as well.

## Your note

Under the senses, **Your note** keeps one private note per word: a mnemonic, a usage warning, a memory hook. Press **Add a note**, type, and **Save**; **Edit** and **Delete** change it later (Delete asks first, there is no undo). Esc cancels editing.

- Plain text only, line breaks kept; nothing is turned into links or formatting. At most 2,000 characters.
- A note belongs to the current workspace, even for a word of another language, like Add to study. Two workspaces keep separate notes.
- It syncs to your other devices, is in [your backup](Your-data), and appears on the flashcard answer side (see [Flashcards: study sessions](Flashcards-study-sessions)).
- Notes are not searchable yet.

## Add to study

Press **Add to study** next to an entry's title. The card joins the General deck and keeps the entry's first example sentence for context. See [Flashcards: study sessions](Flashcards-study-sessions).

## Related

[Reader](Reader) (lookup popups with the same entries), [Data and licences](Data-and-licences).
