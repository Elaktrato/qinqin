# Grammar lessons

**Grammar** (`/p/grammar`, the grammar icon in the top bar or the phone menu) holds short grammar lessons with examples and a practice run after each. It is a built-in feature plugin: it is on for everyone until you switch it off in [Settings → Plugins](Settings-tour#plugins), and the order number there sets its place in the navigation.

## What there is to learn

Lessons come from **grammar packs** installed on the server. The page lists the packs for the language of the current workspace ("Grammar · Chinese"), each as a section, and inside it the levels with their lessons. A level can carry a badge such as "≈ HSK 1" when the matching level list is installed; the "≈" says the match is approximate. Each section ends with the pack's licence and attribution.

qinqin ships one pack: **Chinese grammar demo (A1)**, ten short lessons for beginners (是, 不, 吗, 很 + adjective, 的, 也 and 都, 个, 在, 有 and 没有, 了) written for qinqin and released under CC0 1.0. Its levels are the author's own estimates (roughly HSK 1), and it has not been reviewed by a native speaker. For a language without a pack the page says "No grammar lessons for this language yet" and links to the Sources page, which lists the packs that are installed. An administrator can install more packs ([installing packs](Admin-data-packs); format: [Data pack format](Data-pack-format)).

## A lesson

Each lesson row shows its title and a one-line summary; a finished lesson has a tick and your best score (for example `4/5`).

Opening a lesson (`/p/grammar/<pack>/<lesson>`) shows:

- the title and summary,
- the **pattern** (such as `A + 是 + B`), marked by an accent line,
- the explanation,
- **Examples**: each sentence with the grammar point in the accent colour, its reading and its translation. **Show readings** hides or shows the readings; the choice is remembered in this browser.
- **Practice**, and links to the **previous** and **next lesson** and back to **All lessons**.

Every word in the pattern, the explanation and the examples can be looked up like in the [Reader](Reader#looking-words-up): hover or select it for the popup, or tap it on a phone. **Add to deck** in the popup adds the word to the current workspace when the workspace has the lesson's language. Popups that stay open count in your [lookup history](Searching-and-entries#lookup-history) as lookups "in lessons".

Chinese lessons follow the reader's **Script** setting (original, simplified or traditional, see [Reader](Reader#display-settings)), so lessons and their exercises appear in the script you read in.

## Practice

**Practice** (`…/practice`) runs the lesson's exercises one after another ("Exercise 2 of 7"):

1. **Choose the word that fits the gap**: one per example that has a marked grammar point and wrong choices, in the order of the examples. The translation is shown above the sentence.
2. **Put the words in order**: one per example, in a shuffled order; tap the word tiles into place, as in a [Word Salad flashcard](Flashcards-study-sessions#card-types). It counts as right only when solved on the first check without giving up.

After each answer the whole sentence and its reading are shown; **Next** goes on, **Finish** ends the run. The result says "Score: 5/7" and "Best so far: 6/7". **Retry** shuffles the exercises anew; **Back to lesson** and **Next lesson** leave.

## Your progress

Your best score per lesson is saved for the workspace, on the server: it syncs to your devices and is in [your data](Your-data). A run never lowers a best score. If the result cannot be saved, the page says "Could not save your progress, so nothing was changed" and offers **Try saving again**. A lesson whose number of exercises changed (for example after the pack was updated) starts a new best score.

Grammar practice does not create flashcards and does not count for streaks, the heatmap, daily goals or milestones.

## Offline

The lessons are read from the server, so Grammar needs a connection.
