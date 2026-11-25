# Study modal — design

Status: Approved by the owner on 2026-11-25.

## 1. Intent

Starting a study session should be one decision, or none. Today "Study" leads to `/study`, a long page:
- a summary with Start and Study all;
- limits and order;
- the source (decks or a level);
- a deck list with create, rename and delete;
- card types;
- advanced per-deck switches.

The learner makes the same choices every time. Those choices are remembered only in that browser tab, and the
card types only in that browser.

The owner wants **a modal that is as small as possible.** It shows:
- the card amount and how many cards this session will study;
- the card types right below;
- Start.

All the decks the learner studies are already selected. **Only "Advanced settings" leads to the fine-grained
controls** that the study page has today. **The choices are saved for the workspace and used for every later
session.**

## 2. Goals, non-goals, anti-goals

### Goals
- **One modal from every "Study" button:**
  - the home Flashcards widget;
  - the Flashcards deck list;
  - the end of a session ("Back");
  - the session's close button;
  - the scheduling page's back link;
  - the nav entry, if one points at `/study`.
- **It is small:**
  - one summary line;
  - one "today" line;
  - the card type chips;
  - Start and Study all;
  - an "Advanced settings" link.

  It contains nothing else.
- **Saved setup:** the setup is saved per workspace to the account and synced. It is the same on every device and
  in the Android shell. It is restored whenever the modal opens.
- **Advanced settings:** everything the current page offers stays reachable there. Nothing the learner can do
  today is lost.

### Non-goals
- No change to how sessions are planned, scheduled or graded.
- No new study features.

### Anti-goals
- **A modal that grows back into the long page:** a scrolling box with every section.
- **Losing a choice silently:** a setup that resets on another device or tab, or a deck selection that drops a
  deck the learner chose.
- **A modal that blocks:** for example, waiting on a slow full load before anything shows.

## 3. Approaches (the owner picked A)

- **A — small modal; "Advanced settings" opens the full page (chosen).** The modal has the minimal block. The
  existing page moves to `/study/advanced` and keeps every section. Saving there returns to the modal. Trade-off:
  the fine-grained controls are a page away, but the modal stays tiny.
- **B — one modal where Advanced unfolds inside it.** Rejected: expanded, it is the whole long page in a scrolling
  box, which is poor on a phone and against "as small as possible".
- **C — keep `/study` as a page that opens compact, with a disclosure.** Rejected: it is not a modal, so the
  learner still leaves the page they were on.

## 4. Design

### 4.1 The modal

```
┌ Study ─────────────────────────── ✕ ┐
│ 12 due · 8 new · 4 decks            │
│ This session: 20 cards              │
│ ☑ Vocab  ☑ Reverse  ☑ Cloze         │
│ ☐ Writing  ☐ Word Salad  ☐ Tone     │
│ [ Start ]   [ Study all ]           │
│ Advanced settings →                 │
└─────────────────────────────────────┘
```

- **Container:** it is the existing `lib/ui/Dialog` on a desktop and `lib/ui/Sheet` on a phone, following the
  frame's breakpoint. In the Android shell the back button closes it, through the existing back-button stack in
  `lib/native`.
- **Summary line:** due and new for the saved selection, plus the number of decks. In level mode it is the scheme
  and level instead, for example "HSK 2 · 12 due · 8 new".
- **"This session" line:** the number of cards Start would plan under the saved limits and the selected types
  (the same count the page's summary uses today).
  - When nothing is due and nothing is new, it says so, and Start is disabled.
  - A vacation replaces both lines with the vacation note and a link to change it, as the page does today.
- **Card type chips:**
  - Only the types the language offers are shown (the language profile from #199). Spanish, for example, has no
    Writing and no Tone chip.
  - Reverse and Cloze show only when a selected deck switches them on, as today.
  - At least one chip must stay selected.
  - Any change is saved at once.
- **Buttons:**
  - **Start** plans with the saved setup and goes to `/study/session`, as today.
  - **Study all** keeps today's meaning.
  - The type warnings and errors the page shows today appear under the chips. The unreadable-rows notice (#167)
    shows when it applies.
- **Advanced settings** goes to `/study/advanced`.

### 4.2 Default selection

- **No saved setup** (the first time, or a new workspace): every deck of the workspace is selected, and the card
  types fall back to the current defaults. In both cases this is decks mode, with no levels.
- **Saved setup:** the saved selection, minus decks that no longer exist (`keepKnownDecks`, as today).
- **Newly created decks:**
  - A deck created after the setup was saved is selected automatically when the learner never narrowed the
    selection. The saved form records "all decks" or an explicit list. My call: "all decks" is the default and
    stays a live "all", so a new deck joins.
  - An explicit list is kept as chosen.

### 4.3 `/study/advanced`

This is today's `/study` page moved, with these changes:

- **Removed:**
  - the summary's Start and Study all, since the page now ends with "Save and back";
  - the deck create, rename and delete controls, since deck management moves to the Flashcards decks page (4.5).
- **Kept as they are:**
  - the deck selection, with checkboxes and an "All decks" option that sets the live "all";
  - the source (decks or by level);
  - limits and order, and the type order;
  - card types;
  - the Advanced per-deck switches;
  - the scheduling link;
  - the mastery-map link.
- **Saving:**
  - Changes are saved as they are made, as the page does now.
  - "Back to study" returns to where the learner came from and reopens the modal.
  - Its Escape and back-button behaviour is a plain page's.
- **Direct links:** `/study` itself stays a valid URL. Opening it directly, from a bookmark, an old link, or the
  session's "missing config" redirect, shows the page the learner was on (the home page when there is none) with
  the modal open. My call: `/study` renders the home page with the modal open, so the address bar and the back
  button behave.

### 4.4 The saved setup (synced)

- **A new keyed-rows family** `study-setup`, scope `workspace`:
  - It is added to `docs/contracts/keyed/families.json`.
  - It has a small contract under `docs/contracts/study/` (or `settings/`), with a JSON fixture decoded by Go and
    web tests, and a `docs/contracts/CHANGELOG.md` line.
- **What it holds:**
  - `decks`: `"all"` or a list of ids;
  - `mode`: `decks` or `levels`;
  - `schemeId` and `levelName`;
  - `cardTypes`;
  - `newLimit` and `reviewLimit`;
  - `newOrder` and `typeOrder`.

  These are the fields of today's `StudySessionConfig`. Unknown members are kept, under the keyed-rows lenient
  rule.
- **Opt-in kinds:** the setup also holds `unchecked`, the opt-in kinds (Reverse, Cloze, …) the learner switched
  off. That way today's rule is kept: a kind that a deck in scope switches on is checked by default unless the
  learner unchecked it (`effectiveKinds`). This replaces the `qinqin.study.extraTypes` local key. (My call:
  behaviour is unchanged, which is a non-goal requirement.)
- **What it replaces:**
  - the per-tab `sessionStorage` setup (`lib/study/session.ts` `loadConfig`/`saveConfig`);
  - the localStorage card-type memory (`lib/study/cardTypesMemory.ts`).

  Owner direction: no compatibility is needed. Old local keys are ignored and may be removed.
- **Where it lives:**
  - It is read and written through the session's keyed-rows path (`lib/sync/keyed.ts`) and owned by the
    `Session` (record 0009).
  - It is cached per workspace, so the modal opens from the cache without waiting, then refreshes.
  - The home widget's card counts read the same setup. Today they read the card-type memory.

### 4.4a The running session and one-off starts

The saved setup is **what the modal starts**. It is not the store of a running session.

- **One-off starts leave the saved setup alone.** "Study this deck" on the deck list (`DeckList`), on a deck's page
  (`DeckDetail`), and a level's "Study" (`SystemDeckDetail`) start a session directly, as today, and never change
  the saved setup. Otherwise, studying one deck would narrow the workspace's selection on every device. (My call,
  from the anti-goal "losing a choice silently".)
- **The running session keeps a per-tab copy** (today's sessionStorage config, with `seed` and `studyAll`). Start
  in the modal writes it from the saved setup, and a one-off start writes it from its own scope. A reload of
  `/study/session` keeps its order. The session's "missing config" redirect goes to the modal (4.3).
- **Every reader of "the setup"** uses the saved setup instead of the local keys:
  - the home widget's counts;
  - `DeckDetail`'s session kinds;
  - `deckStats`;
  - `studyStart.ts`;
  - offline preparation (`lib/pwa/prepareOffline.ts`, `prepareRuntime.ts`).

  Offline preparation therefore prepares the cards the modal would study. (My call.)

### 4.4b A saved setup that no longer fits

Each field is repaired on its own when the setup is read. The whole setup is never thrown away, because for a
synced setup that would be a silent reset on every device. (My call.)
- a level mode whose scheme or level is gone, or belongs to another language → decks mode, with the deck selection
  kept;
- an explicit deck list with no deck left → "all decks";
- card types the language does not offer are dropped, and if none are left, the defaults apply;
- unknown members are kept.

The repaired value is used, but the row is written back only when the learner changes something. A device on an
older version then never rewrites a newer one. The modal says when it fell back, in one line, for example "Your
level is no longer installed; studying all decks".

### 4.5 Deck management

The Flashcards decks page (`lib/features/flashcards/decks/DeckList.svelte`) already creates decks. It gains
**rename** and **delete**, using the same commands, confirmation and wording as the study page today. They then
leave the study page.

### 4.6 Entry points

- **Opening the modal:** every place that links `href="/study"` opens it instead. That is:
  - `FlashcardsWidget`;
  - `DeckList`;
  - `SessionTop`'s close;
  - the session's Back buttons;
  - the scheduling page.
- **How:** one shared opener on the app or session context, for example `app.studyModal.open()`, so any page can
  open it. A plain `<a href="/study">` without JavaScript still works through 4.3.
- **After a session:** "Back" returns to the page the session was started from, with the modal closed. My call: a
  finished session should not reopen the modal.

## 5. Constraints

- **Web rules:**
  - state per record 0009 (no module-level state);
  - folder rules per record 0004, with the modal in `lib/features/flashcards/`;
  - errors per record 0001;
  - every string in `en.json`;
  - logic in tested TypeScript modules.
- **Contracts:** keyed-rows family rules (#199) and contracts with fixtures.
- **Platforms:** it must work in the Android shell, which covers the back button, phone layout and focus.
- **e2e:** the suite must stay green. `study.spec.ts` drives the current page by role and text; update it
  deliberately for the modal, and add a spec covering the modal → Start flow and a setup restored after a reload.
- **Accessibility:**
  - the dialog has a title;
  - focus starts on Start;
  - the chips are checkboxes with labels;
  - Escape closes.

## 6. Left to the builder

- **The chips' exact look:** use the existing `lib/ui` toggles, and add a chip variant only if none fits.
- **Wording:** the exact wording of the two summary lines.
- **Loading state:** the modal shows the cached counts at once, refreshing in the background, and a skeleton only on
  a cold start.
- **Contract folder:** whether the setup contract sits in `study/` or `settings/`.
- **Splitting the page:** how the 1,357-line page is split as it moves. Prefer extracting tested modules over
  copying code.
