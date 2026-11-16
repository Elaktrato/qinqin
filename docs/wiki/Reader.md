# Reader

The Reader is a library of books you import, with a lookup popup in the style of Yomitan, bookmarks, highlights and notes. The library belongs to a workspace: the library page lists the current workspace's books only, and reading time counts for the book's workspace. If the current library is empty but other workspaces hold books, the page lists them with a button to switch.

## Importing books

- **Upload an epub** (up to 20 MiB). The book's language must match the workspace's language (a Chinese book cannot go into a Japanese workspace; the page asks you to switch). The same epub may live in several workspaces as separate copies.
- **Import from a source** (the Sources button). There is one tab per source: Aozora Bunko (Japanese) and Project Gutenberg. The first source serving the workspace language is selected. Each tab shows 12 suggested works, the same all day (they are seeded by the date); **Shuffle** draws another set.
- **Search** matches title and author as written and also by reading: romaji for Aozora (`tokyo`, `toukyou` find 東京) and pinyin for Gutenberg Chinese works (`hong lou meng`). A reading query needs at least 3 letters. Gutenberg Japanese titles are not searchable by reading.
- A result in another language shows "Needs a <language> workspace" instead of Import.

Imports run on the server, one work per request, from an allow-list of hosts. A server behind a mandatory outbound proxy cannot import from sources (uploads still work).

## Looking words up

Hover a word in the text to see a ranked stack of dictionary entries with frequency chips; popups open from inside popups. Every entry in the popup has a **+** button that adds the word to the General deck of the book's workspace (a **...** deck menu appears only if the workspace has custom decks). The sentence around the word (up to 200 characters) is saved as your own example sentence and linked to the card. Sentences you save are private to you.

## Display settings

The **Display** button above a chapter opens the reading display. The settings are saved per workspace, so they follow you across devices.

- **Book ruby** (only for books that have ruby): the reading marks printed in the book.
- **Readings over words**: Never (default), Always or Smart. Chinese words get pinyin; Japanese words with kanji get furigana over the kanji only. A reading is left out when the app cannot align it with certainty; it never guesses. Your own edited readings are used.
- **Smart** hides the reading of a word you know: its flashcard has a memory score at or above a threshold (10 to 100, default 80). A hidden reading is only transparent, so screen readers still read it and the text does not move. Hover a word, tap it (4 seconds), press **R** outside text fields, or use **Show all readings** to reveal them.
- **Ruby size** and **Font** (default, sans, serif, kai: system fonts only, nothing is downloaded).

These apply in the Reader only; entry pages and flashcards always show readings.

## Bookmarks, highlights and notes

Beside the text is a side rail with two tabs. Wide screens (1000 px and up) show a column that can collapse; narrower screens show a drawer opened by a floating button (Escape or a click outside closes it).

- **Bookmarks**: **Add bookmark here** or the `b` key bookmarks the first paragraph in view (again to remove). Up to 200 per book. You can jump, rename and delete.
- **Highlights**: select text and pick a colour (yellow, green, blue, pink) or **Note**. The `h` key highlights the current selection. A highlight stays inside one paragraph, cannot overlap another, covers at most 500 characters; notes hold up to 2000 characters; a book holds up to 2000 highlights. If the text under a highlight changes (for example after switching between simplified and traditional) it shows a **text changed** badge instead of being drawn in the wrong place.
- Bookmarks, highlights and notes are private and go with their book.

## Reading time

The Reader records active reading time in bursts (a burst under 30 seconds is not recorded, idle gaps count at most 2 minutes, a hidden tab does not count). It feeds the heatmap and the Reading time widget ([Stats and heatmap](Stats-and-heatmap)).

## Not covered by real-device checks

The Reader was verified by unit and component tests; the developers did not test it in real browsers on all devices.
