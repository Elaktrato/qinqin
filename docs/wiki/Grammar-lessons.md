# Grammar lessons

**Grammar** (`/grammar`, the grammar icon in the top bar or the phone menu) holds short grammar lessons with examples and a practice run after each. It is a core feature: it is on for everyone until you switch it off in [Settings → Features](Settings-tour#features). Each finished run is saved in your study history, and your best score of each lesson is worked out from it.

## What there is to learn

Lessons come from **grammar packs** installed on the server. The page lists the packs for the language of the current workspace ("Grammar · Chinese"), each as a section, and inside it the levels with their lessons. A level can carry a badge such as "≈ HSK 1" when the matching level list is installed; the "≈" says the match is approximate. Each section ends with the pack's licence and attribution.

qinqin ships two packs, both written for qinqin and released under CC BY 4.0, and both installed on the first start:

- **Chinese grammar (HSK-aligned)**: 386 lessons in seven levels, ≈ HSK 1 to 7–9. The topics follow the grammar outline of the HSK 3.0 syllabus, used as a topic index only; the explanations, examples and exercises are qinqin's own.
- **Japanese grammar (≈ JLPT levels)**: 265 lessons in five levels, ≈ N5 to N1. The JLPT publishes no grammar list, so the choice and order of points are qinqin's own.

Each point has 4–8 example sentences with readings and translations. The levels are qinqin's estimates, not official HSK or JLPT levels, and neither pack has been reviewed by a native speaker yet. For a language without a pack the page says "No grammar lessons for this language yet" and links to the Sources page, which lists the packs that are installed. An administrator can install more packs ([installing packs](Admin-data-packs); format: [Data pack format](Data-pack-format)).

## A lesson

Each lesson row shows its title and a one-line summary; a finished lesson has a tick and your best score (for example `4/5`).

Opening a lesson (`/p/grammar/<pack>/<lesson>`) shows:

- the title and summary,
- the **pattern** (such as `A + 是 + B`), marked by an accent line,
- the explanation,
- **Examples**: each sentence with the grammar point in the accent colour, its reading and its translation. **Show readings** hides or shows the readings; the choice is remembered in this browser.
- **Practice**, and links to the **previous** and **next lesson** and back to **All lessons**.

Every word in the pattern, the explanation and the examples can be looked up like in the [Reader](Reader#looking-words-up): hover or select it for the popup, or tap it on a phone. **Add to deck** in the popup adds the word to the current workspace when the workspace has the lesson's language. Popups that stay open, and every tap or selection that finds an entry, count in your [lookup history](Searching-and-entries#lookup-history) as lookups "in lessons".

Chinese lessons follow the reader's **Script** setting (original, simplified or traditional, see [Reader](Reader#display-settings)), so lessons and their exercises appear in the script you read in.

## Practice

**Practice** (`…/practice`) runs the lesson's exercises one after another ("Exercise 2 of 7"):

1. **Choose the word that fits the gap**: one per example that has a marked grammar point and wrong choices, in the order of the examples. The translation is shown above the sentence.
2. **Put the words in order**: one per example, in a shuffled order; tap the word tiles into place, as in a [Word Salad flashcard](Flashcards-study-sessions#card-types). It counts as right only when solved on the first check without giving up.

After each answer the whole sentence and its reading are shown; **Next** goes on, **Finish** ends the run. The result says "Score: 5/7" and "Best so far: 6/7". **Retry** shuffles the exercises anew; **Back to lesson** and **Next lesson** leave.

## Your progress

Each finished run is saved to the workspace's study history, like a flashcard review: it syncs to your devices and is in [your data](Your-data). Your best score per lesson and the time of your last run are worked out from these runs, so a run never lowers a best score, even one made on another device. A run made without a connection waits on this device and is sent when you are back online (it already counts on this device). Only when the workspace was deleted in the meantime does the page say "This run was not saved: its workspace was deleted." A lesson whose number of exercises changed (for example after the pack was updated) starts a new best score.

A finished lesson counts:

- on the [heatmap](Stats-and-heatmap) and in the [weekly summary](Weekly-summary) as "Grammar lessons": one point per lesson finished, once per lesson a day (practising the same lesson again that day adds nothing);
- for a [daily goal](Daily-goals) of grammar lessons (Settings → Study → Daily goal);
- 20 XP per run, whatever the score, towards your level ([XP and streaks](Flashcards-study-sessions#scheduling-xp-and-streaks));
- for your streak: a day with a finished lesson keeps it going like a day with a review, and for the streak and days-active [milestones](Milestones).

Grammar practice does not create flashcards.

## Offline

The lessons are read from the server, so Grammar needs a connection.
