# Visual aids: pictures, tone colours, character anatomy (#212)

Milestone v0.8.0 (the beginner experience). Issue #212 asks to "pick and order in the spec". Branch
`feature/visual-aids-212`, PR base `feature/v0.8.0`. Contract: `docs/contracts/aids/`. Plan:
`docs/superpowers/plans/2026-11-26-visual-aids.md`.

Why "aids", not "learning styles": research does not support matching teaching to a self-described learner type;
combining words with images and making structure visible helps everyone. Every aid is an option anyone can turn off.

## The ideas, picked and ordered

| # | Aid | Decision | Why |
| --- | --- | --- | --- |
| 1 | Pictures on entries and cards | **Build** | #216 shipped the data (OpenMoji, Mulberry, mappings) and #215 the hint kind; only the UI was missing. |
| 2 | Tone colours (Chinese) | **Build** | Pure rendering of data every Chinese entry has (pinyin); no data question. |
| 3 | Character anatomy | **Build** | The components index (#71) and the character universe already carry parts and glosses. |
| 4 | Settings group "Visual aids" | **Build** | One switch per aid, a preview, defaults, stored per workspace. |
| 5 | Pitch-accent lines (ja) | Follow-up | #182 has no data yet (licence check first). |
| 6 | Grammar diagrams | Follow-up | Needs sentence-structure data (roles per word) the grammar lessons do not have; a hand-authored set per lesson is a content job. |
| 7 | Word maps | Follow-up | Needs a related-words source beyond `relatedWords` (same character); a graph view is its own design. |
| 8 | Gender and case colours | Follow-up | Waits for the new languages (#201). |
| 9 | Own picture per card | Follow-up | Avoids licensing entirely, but needs storage like journal photos and a card editor. |

The order of the build is the order of the table: pictures first because the hint kind and the data wait for it,
tone colours second because they touch every reading, anatomy third, the settings group last because it needs the
three to exist (the settings component and its tests are written with them).

## Rules

- **One setting, one place.** The workspace-settings key `visualAids` (`pictures`, `toneColors`, `anatomy`), each a
  boolean, all on by default; read switch by switch like `hints`; written by merge patch. Settings > Study > Visual
  aids shows a checkbox per aid with a note, and a preview of the tone colours and of an anatomy example (drawn even
  when the switch is off, so the learner sees what they are switching). Stored in the workspace: synced and part of a
  backup (no new row, no Go change; the server keeps the key as it keeps `hints`).
- **Pictures.** Entry page header (picture and credit), the answer of Recognise, Recall and writing cards (unless the
  Picture hint already shows it), and the Picture hint of #215 (`ready: true`; `hasPicture` = an images pack maps the
  entry and the aid is on). The session asks `entryPicture` for the card on screen, once per entry per session
  (`PictureCache`), and shows nothing on a miss or an error. The picture is inline SVG, black outlines drawn from the
  text colour (`themeSvg`), with its credit line (CC BY-SA 4.0 attribution) and the English name as the accessible name.
- **Tone colours.** Every pinyin reading, wherever `ReadingText` or the card's `ReadingTable` draw it: each syllable in
  its tone's colour and the tone's contour (a small line drawing) under it. Colours: Okabe-Ito hues made readable
  (4.5:1) on the painted theme's panel by moving toward its text colour; the neutral tone is the muted text. The
  contour is the non-colour cue; the tone mark of the pinyin stays as written. The Tone card's front is not changed:
  readings are only drawn on answers and as the reading hint, never as part of the question.
- **Anatomy.** The entry page and the writing card's answer list the parts of a character with their meaning from the
  components index and the universe's first gloss. Shown only where a components pack has the character.
- **Accessibility.** Colour is never the only cue (contours, tooltips, part meanings as text, radical label); forced
  colours drop to the system text colour and keep the contours; there is no animation, so reduced motion needs nothing
  and the pictures do not move; pictures have an accessible name; the aids add no text to what a screen reader reads
  for a reading.
- **Offline.** Pictures need the server (`images` packs have no data package, #216 ruling 5); tone colours and anatomy
  work with what the client has already fetched.

## Out of scope

Starter mode (#214, a parallel change on the same card faces: this change adds `AnswerAids` to three answers and a
picture row to `HintShown`, nothing else). Colouring the hanzi by tone (needs a character-to-syllable alignment). Part
highlighting inside the character drawing (needs per-part stroke data, which only KanjiVG has, CC BY-SA 3.0: not
added).
