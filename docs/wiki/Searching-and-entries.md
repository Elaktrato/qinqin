# Searching and entries

## Search

Search looks across written forms, readings and meanings and is scoped to the language of the current workspace. Hits are ranked in tiers: exact written form, exact reading, reading prefix, bopomofo prefix, and then a substring of a meaning. Within a tier, words that are usually written in kana and have a priority mark come first, then by priority. The server returns at most 50 hits by default.

Readings you can search by: pinyin and bopomofo for Chinese, kana (and romaji) for Japanese.

On a wide screen the results stay on the left and the selected entry opens beside them; a row is one link, named by the word, with its reading, the first gloss your workspace does not hide and its kind and level. Choosing a row keeps the list in place. The address carries everything, so a search can be shared or reloaded: `/search?q=…&kind=…&scheme=…&level=…&e=<entry id>`. A new query drops the selected entry; changing a filter keeps it. On a phone the list and the entry are two views: tapping a result opens the entry, and **Back to results** returns to the list. A link with `e` shows that entry even when your filters or the result cap would hide its row, and the entry is still shown (with **Back to results**) when the search finds nothing or fails.

The filters are text options: **All**, **Words** and **Characters**, and **Level: any**, which opens a menu of **Any level** and each installed level scheme's levels. **Clear filters** appears only while a filter is set. When the list is cut at the cap the page says "Showing the first 50 results. Add more of the word or a filter to narrow them." If the workspace's language has no dictionary installed, or no level lists, a line above the results says so (administrators get a pointer to Settings → Data). You can also start a search from the box on the home page.

## Find a character by radical or part

In a Chinese or Japanese workspace, **By parts** next to the search field opens `/search/parts`, for a character you can see but cannot read or type (鯖, 锈).

- **Radical**: the 214 Kangxi radicals in 17 groups by their classical stroke count. Each tile shows the radical with the shapes you meet in text (氵 for 水; 讠 in Chinese, 竜 in Japanese). Picking one lists the characters classified under it.
- **Parts**: the parts you can see anywhere in the character, at any depth (語 has 言 口 吾 五 二). Every chosen part must be in the character. Parts that would leave nothing are greyed out; the list shows the common parts first, **Show all parts** lists the rest. Japanese has a bundled parts list (derived from KanjiVG); Chinese has radicals and strokes only, unless the server has a local components pack.
- **Total strokes**: narrows the result to one total stroke count (total, not residual strokes).
- **Type a radical or part**: a typed 氵 picks radical 85; any other character is added as a part.

Results are grouped by total stroke count, at most 300 at first (**Show all** shows the rest), and each links to its entry. The address keeps the selection (`/search/parts?r=85&p=口`), so a reload or a shared link shows the same list. A character entry links **All characters with this radical**, and a radical's own entry **Browse by stroke count**. The lookup needs no network beyond loading the character list once; it does not work offline.

## Entries

An entry is one dictionary headword, either a **word** or a **character** (kanji or hanzi).

- **Meanings keep their source.** Each sense is tagged with the dictionary it comes from, with its licence and attribution, so several dictionaries can describe the same entry. A licence the app recognises exactly (CC BY and BY-SA 3.0/4.0, CC0 1.0 and the Unicode License v3, by name or SPDX id) links to its text; any other licence name is shown as written. Hidden dictionaries ([Workspaces and languages](Workspaces-and-languages)) are filtered out.
- **Chinese**: one entry per simplified written form; traditional forms are forms of the same entry, so searching 學習 finds 学习. A written form with several readings (行 xíng, háng) is one entry with all readings.
- **Japanese**: one entry per JMdict word, with all forms and readings and part-of-speech tags per sense. Homographs are separate entries.
- **Japanese inflected forms**: looking up an inflected or contracted form finds the dictionary form and shows the inflection chain: 食べちゃった, 飲んでしまいました and 開けておいてください find 食べる, 飲む and 開ける. A word normally written in kanji is ranked below a common kana word when only its kana reading matched (しよう finds する before 使用), and a dictionary phrase that is just a verb's inflection (すれば) comes after the verb.
- **Japanese headwords**: a word whose main meaning the dictionary marks as usually written in kana is shown in kana (こと, する, これ, わかる) in search results, on the entry page, in decks, on cards and in the Reader popup; its other spellings are listed on the entry page ("Also written: 事"), and searching for a kanji spelling shows that spelling. A spelling the dictionary keeps only for searching is never shown as the headword (の, not 乃). A card added before this rule keeps the form it was added with in the card manager until you add it again.
- **Characters** show readings, radicals, variants and stroke counts. Chinese character entries add animated stroke order. A radical entry lists the characters classified under it. A word entry lists its Han characters in order with each character's reading, gloss, radical, stroke count and level, linked to the character entry; a Chinese word lets you pick which character the stroke player shows.
- **Related** lists the dictionaries' cross-references to other words, linked to search.
- **Level badges** (HSK, JLPT and other level schemes you have installed) appear in the entry's header; word-based schemes derive badges for their characters.
- **The header** shows the word large, a Chinese variant beside it labelled traditional or simplified, the readings with a play button, and chips for the levels, the frequency rank, the kind and the decks containing the entry. **Add to deck** is the main action; **Choose a deck** picks another deck. On a phone the same add button sits in the top bar.
- **Characters** in a word name each character's own entry; each row shows the reading, gloss, radical, stroke count and level when they are known. **Stroke order** plays stroke by stroke with a progress line (勤 · 3 of 13), pauses, and loops.
- **Frequency**: a rank chip appears where a frequency pack covers the word. Frequency also orders lookup results when a pack exists.
- **Example sentences** come from installed sentence packs plus your own. Sentences you save are private to you.
- **AI examples**: when a word has fewer than three example sentences, the entry offers [**Generate examples**](#ai-examples) written by your own AI provider.
- **Audio**: where an audio pack covers a word, a play button appears. Clips are credited on the Sources page.

## AI examples

A word with fewer than three example sentences (or with AI examples waiting for you) shows **AI examples** under its examples. Pick **Your level** (Beginner, Elementary, Intermediate or Advanced; it starts at the level you used last) and press **Generate examples**: your AI provider writes up to five sentences at that level, each with a reading (pinyin or kana) and an English translation. It uses the key and provider you set in [Settings → AI](Journal-and-AI#setting-up-a-provider), with the journal's limits (30 calls an hour, one at a time); without a key the panel links to Settings → AI. Only the word, its meanings and the examples it already has (sentences you saved yourself among them) are sent.

The server checks every sentence before you see it: it must be mostly in the word's language and script, contain the word (a Japanese verb may be conjugated: 食べた counts for 食べる, as in the reader and the cloze card), repeat no example the word has, and stay under 200 characters; a kana spelling counts for a word written in kanji only when the dictionary ranks that word first for it (はし is not 橋 when 箸 comes first). A reading that is not in pinyin (Chinese) or kana (Japanese) is left out. The panel says how many were left out. Each new example shows **AI-written · model · provider**, with:

- **Keep**: it joins the word's examples, still marked AI-written, and feeds your Word Salad, cloze and vocab cards like any example (after the dictionary's own examples). Up to ten kept AI examples per word.
- **Delete**: it goes.
- **Report**: pick what is wrong (the word is missing, wrong translation, wrong reading, sounds unnatural, too hard for my level, inappropriate, something else) and **Report and delete**. The report stays in your account (no administrator sees it) so the prompt can be improved later.

A kept AI example has **Delete** and **Report** too. **Generate new examples** replaces the ones you have not kept (when none of the new sentences passes the checks, the earlier ones stay). Keeping or deleting one also refreshes the word's offline copy when you are online. AI examples are yours alone: never shown to other users, never part of a sentences pack, kept per word across your workspaces, in your [backup](Your-data) and removed with your account.

## Your own edits

You can correct written forms and readings of an entry. The edit is stored per user as a patch over the shared data; the shared dictionary is never changed, and clearing a field reverts it to the shared value. Your edited readings are used in the Reader as well.

## Your note

In the entry's side column, **Your note** keeps one private note per word: a mnemonic, a usage warning, a memory hook. Press **Add a note**, type, and **Save**; **Edit** and **Delete** change it later (Delete asks first, there is no undo). Esc cancels editing.

- Plain text only, line breaks kept; nothing is turned into links or formatting. At most 2,000 characters.
- A note belongs to the current workspace, even for a word of another language, like Add to deck. Two workspaces keep separate notes.
- It syncs to your other devices, is in [your backup](Your-data), and appears on the flashcard answer side (see [Flashcards: study sessions](Flashcards-study-sessions)).
- Notes are not searchable yet.

## Add to deck

Press **Add to deck** next to an entry's title. The card joins the General deck and keeps the entry's first example sentence for context; **Choose a deck** opens a menu of your other decks and adds the card there instead. In a deck, the button reads **In study deck**. See [Flashcards: study sessions](Flashcards-study-sessions).

## Lookup history

**Search → Lookup history** (`/lookups`, also linked from **Settings → Account → Your data**) lists the words you looked up in the current workspace, newest first: how often (`×4`), the day of the last lookup, and where (book titles, lessons, search; a book you deleted reads "a removed book"), with a chip that says **No card**, **In study** or **Known**.

What counts as a lookup:

- In the reader and in grammar lessons: a hover popup that stays open for a second, or that you move the pointer into, and every tap or selection popup that finds something. The word recorded is the popup's first entry. Moving the mouse across a line records nothing, and popups opened from inside a popup never count.
- In search: opening a result (a click, Enter or a middle click; opening it from the right-click menu is not noticed). Typing a query records nothing.
- Looking the same word up again within ten minutes only updates "last" (rereading a paragraph does not inflate the count). Visiting an entry page from a link is not a lookup.

The box **You keep looking these up** names up to ten words you looked up at least three times that have no card and are not marked known, with a button to add them all. Every row has **Add** (to the deck chosen at the top: General first, then your decks) and **Remove**; select several rows for **Add selected** and **Remove selected**, and filter to **No card yet** (the count above the list, "3 of 12 words with no card yet", is read out by screen readers when you change the filter). Adding twice creates nothing new; added words stay in the history. The reader popup says "You've looked this up 4 times." under the buttons of a word you looked up at least three times without a card.

**Clear history…** asks first, then deletes the workspace's history on the server, including old search records (older versions kept the text of every search query). It cannot be undone. The switch **Record words I look up** is one setting for your account on every device and workspace; turning it off stops recording (other devices stop at their next save) but deletes nothing, so the page then offers **Clear history too**.

The history lives on your server only (the at most 500 most recent words per workspace), syncs between your devices, and is in your backup. Lookups wait in the open tab for a few seconds before they are saved; a lookup made right before the tab is closed while offline can be lost. Nothing about the history is kept in browser storage: the offline copies the app saves for studying offline leave the history and old search records out. See [Your data](Your-data) for what Clear cannot reach. An [access token](API-Access-tokens) that may read your data can read the history too, like your notes.

## Related

[Reader](Reader) (lookup popups with the same entries), [Data and licences](Data-and-licences).
