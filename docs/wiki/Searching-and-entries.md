# Searching and entries

## Search

Search looks across written forms, readings and meanings and is scoped to the language of the current workspace. Hits are ranked in tiers: exact written form, exact reading, reading prefix, bopomofo prefix, and then a substring of a meaning. Within a tier, words that are usually written in kana and have a priority mark come first, then by priority. The server returns at most 50 hits by default.

Readings you can search by: pinyin and bopomofo for Chinese, kana (and romaji) for Japanese.

## Find a character by radical or part

In a Chinese or Japanese workspace, **Find a character by radical or part** on the Search page opens `/search/parts`, for a character you can see but cannot read or type (鯖, 锈).

- **Radical**: the 214 Kangxi radicals in 17 groups by their classical stroke count. Each tile shows the radical with the shapes you meet in text (氵 for 水; 讠 in Chinese, 竜 in Japanese). Picking one lists the characters classified under it.
- **Parts**: the parts you can see anywhere in the character, at any depth (語 has 言 口 吾 五 二). Every chosen part must be in the character. Parts that would leave nothing are greyed out; the list shows the common parts first, **Show all parts** lists the rest. Japanese has a bundled parts list (derived from KanjiVG); Chinese has radicals and strokes only, unless the server has a local components pack.
- **Total strokes**: narrows the result to one total stroke count (total, not residual strokes).
- **Type a radical or part**: a typed 氵 picks radical 85; any other character is added as a part.

Results are grouped by total stroke count, at most 300 at first (**Show all** shows the rest), and each links to its entry. The address keeps the selection (`/search/parts?r=85&p=口`), so a reload or a shared link shows the same list. A character entry links **All characters with this radical**, and a radical's own entry **Browse by stroke count**. The lookup needs no network beyond loading the character list once; it does not work offline.

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

## Lookup history

**Search → Lookup history** (`/lookups`, also linked from **Settings → Account → Your data**) lists the words you looked up in the current workspace, newest first: how often (`×4`), the day of the last lookup, and where (book titles, lessons, search; a book you deleted reads "a removed book"), with a chip that says **No card**, **In study** or **Known**.

What counts as a lookup:

- In the reader and in grammar lessons: a hover popup that stays open for a second, or that you move the pointer into, and every selection popup that finds something. The word recorded is the popup's first entry. Moving the mouse across a line records nothing, and popups opened from inside a popup never count.
- In search: opening a result (a click, Enter or a middle click; opening it from the right-click menu is not noticed). Typing a query records nothing.
- Looking the same word up again within ten minutes only updates "last" (rereading a paragraph does not inflate the count). Visiting an entry page from a link is not a lookup.

The box **You keep looking these up** names up to ten words you looked up at least three times that have no card and are not marked known, with a button to add them all. Every row has **Add** (to the deck chosen at the top: General first, then your decks) and **Remove**; select several rows for **Add selected** and **Remove selected**, and filter to **No card yet**. Adding twice creates nothing new; added words stay in the history. The reader popup says "You've looked this up 4 times." under the buttons of a word you looked up at least three times without a card.

**Clear history…** asks first, then deletes the workspace's history on the server, including old search records (older versions kept the text of every search query). It cannot be undone. The switch **Record words I look up** is one setting for your account on every device and workspace; turning it off stops recording (other devices stop at their next save) but deletes nothing, so the page then offers **Clear history too**.

The history lives on your server only (the at most 500 most recent words per workspace), syncs between your devices, and is in your backup. Lookups wait in the open tab for a few seconds before they are saved; a lookup made right before the tab is closed while offline can be lost. Nothing about the history is kept in browser storage: the offline copies the app saves for studying offline leave the history and old search records out. See [Your data](Your-data) for what Clear cannot reach.

## Related

[Reader](Reader) (lookup popups with the same entries), [Data and licences](Data-and-licences).
