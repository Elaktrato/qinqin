# Reader

The Reader (`/reader`, in the main navigation) is part of the app; you can switch it off for yourself in [Settings → Features](Settings-tour#features). It is a library of books you import, with a lookup popup in the style of Yomitan, bookmarks, highlights and notes. The library belongs to a workspace: the library page lists the current workspace's books only, and reading time counts for the book's workspace. If the current library is empty but other workspaces hold books, the page lists them with a button to switch.

## Importing books

- **Upload an epub** (up to 20 MiB). The book's language must match the workspace's language (a Chinese book cannot go into a Japanese workspace; the page asks you to switch). The same epub may live in several workspaces as separate copies.
- **Import from a source** (the Sources button). There is one tab per source: Aozora Bunko (Japanese) and Project Gutenberg. The first source serving the workspace language is selected. Each tab shows 12 suggested works, the same all day (they are seeded by the date); **Shuffle** draws another set.
- **Search** matches title and author as written and also by reading: romaji for Aozora (`tokyo`, `toukyou` find 東京) and pinyin for Gutenberg Chinese works (`hong lou meng`). A reading query needs at least 3 letters. Gutenberg Japanese titles are not searchable by reading.
- A result in another language shows "Needs a <language> workspace" instead of Import.

Imports run on the server, one work per request, from an allow-list of hosts. A server behind a mandatory outbound proxy cannot import from sources (uploads still work).

## Looking words up

Hover a word in the text to see a ranked stack of dictionary entries just below the word (above it only when there is no room below): the word, its reading, chips for its levels (such as "HSK 3", from installed level lists) and frequency, the numbered meanings and the dictionary it comes from. Shift+hover inside a popup opens a popup from inside it. On a phone the lookup opens as a sheet at the bottom of the screen instead; close it with its close button, Escape, a drag down or a tap outside. Every entry has an **Add to deck** button that adds the word to the General deck of the book's workspace in one click (a **Choose a deck** menu beside it appears only if the workspace has custom decks). The sentence around the word (up to 200 characters) is saved as your own example sentence and linked to the card. Sentences you save are private to you.

Words you look up are kept in the workspace's [lookup history](Searching-and-entries#lookup-history) (a popup that stays open a second, one you move into, or a selection); a word you looked up three times or more without a card says so in its popup. Turn recording off on the history page.

## I know this word

Next to **Add to deck** every popup entry has an **I know this** toggle (a check mark shows when it is on). It marks the word as known without making a flashcard: the mark counts like a mastered card everywhere a word is called known (word highlighting, Smart readings, the Words tab, starter decks skip it). Press it again to take the mark back. The mark belongs to the book's workspace and is synced and included in your backup. With word highlighting on, the popup also says how well you know the word ("New word", "Learning", "Known — memory score 85" or "Known — marked by you").

## Display settings

The **Display** tab of the side rail holds the reading display (for Chinese and Japanese books, and books with ruby). The settings are saved per workspace, so they follow you across devices. For Chinese books it also holds the **Script** choice (original, simplified or traditional), kept in this browser.

- **Book ruby** (only for books that have ruby): the reading marks printed in the book.
- **Readings over words**: Never (default), Always or Smart. Chinese words get pinyin; Japanese words with kanji get furigana over the kanji only. A reading is left out when the app cannot align it with certainty; it never guesses. Your own edited readings are used.
- **Smart** hides the reading of a word you know: its flashcard has a memory score at or above a threshold (10 to 100, default 80). A hidden reading is only transparent, so screen readers still read it and the text does not move. Hover a word, tap it (4 seconds), press **R** outside text fields, or use **Show all readings** to reveal them.
- **Ruby size** and **Font**: **App setting** follows the hanzi and kanji font of Settings → Appearance (its current name in brackets); Sans, Serif or Kai override it for the reader. A face comes from an installed font pack (only the pieces the page's characters need are downloaded) or else your device's fonts.
- **Mark words by how well I know them** (word highlighting, off by default): a **new** word (no flashcard) gets a thin solid underline in the theme's accent, a word you are **learning** (it has a flashcard below the threshold) a thin dotted underline; words you know stay plain. The underline style, not only the colour, tells the two apart (also in Windows high-contrast mode), and the text colour never changes. Nothing is drawn inside your own highlights. The threshold slider shows with Smart or with highlighting on: a word counts as known from that memory score, or when you marked it with **I know this**. Only the first dictionary entry of a word counts, the one whose reading is shown.

These apply in the Reader only; entry pages and flashcards always show readings.

## Words tab and coverage

The **Words** tab of the side rail shows how much of the chapter you can read: "You know 87% of the words in this chapter" with the number large and a thin bar under it, with the counts ("1,234 of 1,420 words · 46 different new words · 12 learning") and how many passages the dictionary does not know (names, rare words). Coverage counts running words: every word with a Chinese character (and, for Japanese, kana), so a word that appears ten times counts ten times; punctuation, digits and Latin letters never count, and passages the dictionary lacks are left out of the percentage. It is rounded down, so 100% means every counted word is known. **Count the whole book** fetches and counts every chapter on demand (with progress and Cancel); the book figure adds up the words of all chapters.

Below is the list of words you do not know yet, most frequent first (50 at a time), each with its reading, how often it appears and whether it is new or learning. Pick a deck and use **Add selected** or **Add all new words** to add them in one go (adding again adds nothing new; a word that already has a card joins the deck), or **I know these** to mark them known (with **Undo**). Word counts are available for Chinese and Japanese books.

## Bookmarks, highlights and notes

At the right edge of the page is a side rail of five icons: **Contents** (the chapters, the one you are reading marked), **Bookmarks**, **Highlights**, **Words** and **Display**. Each icon names itself in a tooltip; the arrow keys, Home and End move between them. Wide screens (1000 px and up) show the open tab's panel between the text and the icons; activating the open tab again collapses the panel. Narrower screens have one button for all five (in the top bar on a phone, above the text on a tablet) that opens them as a sheet at the bottom of the screen; jumping to a chapter, bookmark or highlight, or editing a highlight, closes the sheet first. Above the text a small line names the book and its author and shows a bookmark icon when the paragraph in view is bookmarked; previous and next chapter buttons sit at the end of each chapter. The keys `b`, `h` and `R` work as before, with the panel collapsed or the sheet closed.

- **Bookmarks**: **Add bookmark here** or the `b` key bookmarks the first paragraph in view (again to remove). Up to 200 per book. You can jump, rename and delete.
- **Highlights**: select text and pick a colour (yellow, green, blue, pink) or **Note**. The `h` key highlights the current selection. A highlight stays inside one paragraph, cannot overlap another, covers at most 500 characters; notes hold up to 2000 characters; a book holds up to 2000 highlights. If the text under a highlight changes (for example after switching between simplified and traditional) it shows a **text changed** badge instead of being drawn in the wrong place.
- Bookmarks, highlights and notes are private and go with their book.

## Reading time

The Reader records active reading time in bursts (a burst under 30 seconds is not recorded, idle gaps count at most 2 minutes, a hidden tab does not count). It feeds the heatmap and the Reading time widget ([Stats and heatmap](Stats-and-heatmap)).

## Not covered by real-device checks

The Reader was verified by unit and component tests; the developers did not test it in real browsers on all devices.
