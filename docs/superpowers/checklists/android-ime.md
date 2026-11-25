# Chinese and Japanese input checklist (#37)

For the owner, on a real phone. The emulator job simulates composition through DevTools (`Input.imeSetComposition`,
a "Process" Enter with keyCode 229) in the search box, a typing card and the journal; it cannot reproduce a real
keyboard's event order, candidate bar, predictions or handwriting. The code audit is in
[`../plans/2026-11-25-android-testing.md`](../plans/2026-11-25-android-testing.md).

**What must hold, everywhere below:** while the underlined pre-edit text is open, Enter (or the keyboard's confirm
key) only confirms the candidate: it never searches, checks a card, sends a message or adds a line break; the
confirmed text arrives whole, with no lost or doubled characters; the text does not jump or reset while you type
(also when the page autosaves or re-renders meanwhile); after the candidate is confirmed, Enter does the action.

Keyboards: **Gboard Pinyin** (Chinese, Simplified), **Gboard Japanese** (romaji and 12-key flick), **Gboard handwriting**
(Chinese or Japanese), and, if you use it, the Samsung keyboard or another IME.

| Where | What to do | Expect | Pinyin | Japanese | Handwriting |
|---|---|---|---|---|---|
| Search (Japanese workspace) | type `gakkou`, confirm 学校 with the space/candidate, press Enter | no search before the last Enter; results show school | [ ] | [ ] | [ ] |
| Search (Chinese workspace) | type `xuexi`, pick 学习, press the search key on the keyboard | the search runs once, after the pick | [ ] | n/a | [ ] |
| Search, keyboard search/go key | type 学校 and press the keyboard's search key | one search | [ ] | [ ] | [ ] |
| Typing card, Recall (reverse) | type the word, confirm the candidate, press Enter | not checked until Enter after the confirm; Correct for the right word | [ ] | [ ] | [ ] |
| Typing card, full-width or katakana | type the answer in katakana or full-width Latin where the card accepts it | still accepted (NFKC and kana variants are folded) | n/a | [ ] | n/a |
| Cloze card | type the missing word | as the typing card | [ ] | [ ] | [ ] |
| Journal editor | write a sentence with several candidate picks, a line break with Enter after confirming | no break inside a composition; autosave while composing does not reset the text; the saved text is the typed text | [ ] | [ ] | [ ] |
| Journal margin / correction note | type a note | as above | [ ] | [ ] | [ ] |
| Conversation | send a reply: confirm the candidate, then Send | not sent while composing | [ ] | [ ] | [ ] |
| Reader, word list or highlight note | type a note | as above | [ ] | [ ] | [ ] |
| Shared text | in another app select Chinese or Japanese text, Share or "Look up in qinqin" | the search opens with the text, one lookup | [ ] | [ ] | n/a |
| Sign-in, Settings forms | type a Chinese or Japanese name (workspace name, deck name) | accepted, Enter after the confirm submits | [ ] | [ ] | [ ] |

Also check: the candidate bar does not cover the field; the page scrolls the field into view; switching the keyboard
language mid-field keeps the text; a long press on the field offers cut and paste.
