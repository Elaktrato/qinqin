# qinqin: next release

Notes collected for the next release; they move into its `vX.Y.Z.md` when it is cut.

## Upgrading

- Migration 057 adds the picture reports (#274). An upgrade wipes nothing. Images packs now build a data package; the
  server builds it at start. Re-seed (`qinqin seed`) to install the reviewed picture maps of a rebuilt image.
- Run `qinqin seed` once after upgrading (#346): it re-imports CC-CEDICT and JMdict so each meaning knows its reading. Until then a Starter word's card shows the meanings of all its readings. Starter cards added before this release keep doing so (a pin is set when a word is first added); everyday meanings still come first on them. Nothing is wiped.

- The bundled level list `jlpt-words` (#219) takes the id of the former local-only JLPT vocabulary pack
  (`prepare-level-packs.mjs --jlpt-vocab`, removed). If you generated that pack, delete `plugins/data-local/jlpt-words`
  before seeding: both have the id `jlpt-words`, and a seed keeps whichever it imports last (path order). Run `qinqin seed` to install the new list on an
  existing server.

- Migration 055 rebuilds `feature_switches` without its list of feature ids (#294); every switch is kept. Nothing to do beyond the usual backup.
- Migration 056 turns grammar lesson progress into study events (#277): each lesson's best score becomes one finished run at the time of its last run, then the `grammar_progress` table is dropped. What an upgrade loses: the run history before it is one run per lesson (the best one), and a progress row with an unreadable lesson id or time is dropped. The routes `GET/POST /api/grammar/progress` are gone. A backup made before the upgrade still restores; its lesson progress becomes the same runs.

## Changed

- Dictionary: a word list's 虹 (にじ) is the rainbow again, not 二次 (#347): an entry where a spelling is only kept for searching no longer wins over the word that is really written that way. Level lists pick it up with `qinqin seed`.
- Dictionary: the everyday meaning comes first (#346). Surname, abbreviation, variant, "see", archaic and classical lines move after it: 书 is "book" before "abbr. for 書經", 水 "water" before "surname Shui", 三, 马, 云 and about 400 more. A Starter word learned in one reading keeps it on its card: 喝 shows "to drink", not "to shout"; 猫 only māo. In the Reader's lookup, 目 and 山 are no longer called "usually kana".
- Dictionary: slang, vulgar and derogatory meanings never come first (#345). 鸡 is "chicken" on a card, not "(slang) prostitute"; 黄色 is "yellow"; 草 is "grass". On cards they are folded behind **Show n more meanings**, in the Reader's lookup they come last, after **Show more senses**, and search results, the Starter words and a word's characters never show them; the word page lists them last, marked "slang", "vulgar" or "derogatory". Nothing to reinstall: the dictionaries stay as they are.
- Starter mode: the Starter words grow from 47 Chinese and 55 Japanese words to 146 and 145 (#275), each with a checked picture: people, numbers, school, the body, food and drink, home, clothes, transport, places, colours, nature, animals and a few actions, now starting with people and numbers. They were reviewed by agents acting as native-speaker teachers, not yet by a person; the Home offer and Settings → Study say how many words there are and who reviewed them, and the Sources page credits them. Learners who already added the Starter words get the new ones with **Add the Starter words to my decks** again (words they have keep their history).
- Flashcards: the level, the deck and the labels on a card (the Word Salad tier, "Again, look 2 of 3", "new") are small outlined tags (#286), the level in the accent colour. They wrap onto a second line on a phone.
- Writing: strokes that flow into each other may be drawn in one motion, as in handwriting: き's third and fourth strokes, さ's last two, こ, い, う, た's last two, the dots of 心 (#292). A join is accepted where a stroke's hook or flick points at the next stroke's start; drawing the strokes separately still works, and the order still counts. In flashcards and the scripts trainer.
- Writing: after 3 misses on a stroke, only that stroke is shown (lit up, then faint until you draw it), no longer the whole character's outline; it happens again for any later stroke you miss 3 times, and each one counts as a hint (#287). The same in the scripts trainer's Write mode.
- Writing: the writing pad grows with the screen (#285). On a phone it takes the full width where the height allows, and stays small enough to keep the feedback line above the buttons; on a computer it is a little larger than 200 px. The same in the scripts trainer's Write mode.
- Grammar lessons count like the rest of study (#277): a finished lesson is a point on the heatmap and in the weekly summary (each lesson once a day), can be a daily goal, earns 20 XP and keeps your streak going, also for the streak and days-active milestones. The best score of each lesson is worked out from your finished runs, and a run made offline is sent when you are back online.

## New

- **Tone pairs** (Chinese workspaces), the first drill in Practice: the 20 two-syllable tone patterns, each practised with words from your decks, then the HSK word list. Type the two tones (the phone keeps its number keyboard open between words) or tap them; grading and tone sandhi follow the Tones settings (citation tones by default, spoken tones counted too). A grid shows each pair's recent accuracy, and **Practise my weakest pairs** drills the weak ones. Tone-pair answers count on the heatmap, in the weekly summary and as a daily goal (#180).
- Courses (#222): a guided path through sections, units and small lessons, at **Courses** (`/courses`; a section of the bottom bar under More until you pin it). Lessons of new words, script, grammar, practice, listening, speaking and reading open full screen and end with a short check and a summary; course words get cards in a deck named after the course and join your normal reviews without using the daily new-card limit; a unit test or section exam lets you skip ahead, and the words you skip are marked known. The course works offline once loaded. This release ships no real course yet (a server needs a course pack; the Chinese and Japanese courses come with #223), and the unit tests are a first, simple version.

- **Practice** (`/practice`), the home of the drills: each drill item has its own spaced schedule (FSRS, apart from your flashcards), a round per drill and **Practise weakest** across them; drill answers count for the heatmap, the weekly summary, daily goals, XP and the streak. It is a feature you can switch off in Settings → Features. The drills themselves (conjugation, counters, tone pairs, look-alike characters) come next; until one applies to your language, Practice is not in the navigation.

- Pictures of words work offline (#274): while the Pictures visual aid is on, preparing for offline use keeps the
  installed picture sets of the workspace language on the device (about 2 MB, downloaded once in the background and
  again only when a set changes), in the browser, the installed app and the Android app. **Report picture** under a
  picture (on a card or a word page) tells the server it is wrong; it is then no longer shown to you for that word.
- Fewer wrong pictures (#274): the doubtful automatic pictures of the Starter words, HSK 1-2 and ≈ N5-N4 were reviewed
  word by word (by teacher agents, not yet by a person): 262 removed, 14 replaced by a clearer picture.
- The groundwork for courses (#221): a new pack type **Courses** (a course's sections, units, grammar, hanzi or kanji
  and reading texts, written for qinqin; no word lists), which the server fills with words from its installed level
  lists and serves to the app, and course progress kept as study events, so it syncs and is in backups. Nothing to
  see in the app yet: the course screens and the real courses follow.

- Japanese words now carry an estimated JLPT level, "≈ N5" to "≈ N1", from the new bundled list **JLPT words
  (approximate)** (#219): about 10,000 words, with badges on word pages, level sessions and level decks, and a
  grouping on the character map, like the JLPT kanji. It is qinqin's estimate (the JLPT has published no official
  vocabulary list since 2010): about 540 basic textbook words have their level set directly, the rest go mainly by
  how often they are used, so a word can be a level off. A fresh install gets it automatically; an existing server gets it with
  `qinqin seed`.

- Topic labels for words (#220): 49 themes (food, family, travel, work …) for about 2,000 Chinese words (HSK 1–4)
  and 3,700 Japanese words (≈ N5–N3), plus the words with a picture, so the coming courses can fill their units by
  theme. Reviewed by agents acting as native-speaker teachers, not yet by a person; credited on the Sources page.
- Settings → Workspaces → **Interface language** (#297): each workspace may choose its own interface language, for
  example a Japanese workspace in Japanese for immersion and a Chinese one in English; "Use my account setting" is the
  default. Switching to a workspace with another language reloads the page once into it, an offline start in that
  workspace opens in its language, and reminder mails follow the workspaces they count when those share a language.
  English is the only interface language for now; German and Japanese join as their catalogues land.
- Stats → Characters: choose what the mastery map goes by (#163). **Grading** picks one level list (HSK, JLPT, any
  installed list) or a grouping (Grade, Frequency, Strokes …), saved for the workspace on every device; Chinese
  starts on HSK and Japanese on JLPT. With a list the map shows only its characters, **Study levels** switch single
  levels on or off, **Include characters outside** adds the rest as a last group, and **Level** narrows within the
  study levels. The old Group by choice is not carried over.
- Stats can be switched off (#295): Settings → Features has a **Stats** switch. Off, the Stats pages, the Stats
  section in the bars and the menu, and the Activity, Characters, Summary, Reviews per day and Words widgets are
  hidden; your streak, XP, daily goal, the This week widget and milestone cards stay. Nothing is deleted.
- Word Salad: drag the tiles (#291). Drag a placed tile to a new place, a tile from the pool straight to any place in your sentence, or a placed tile back to the pool, with a mouse, a finger or a pen; the other tiles make room and a marker shows where it lands. Tapping works as before. With the keyboard, Alt+← and Alt+→ move a focused placed tile. The same in grammar lessons' "Put the words in order".
- Study: hide romanisation everywhere (#284). Settings → Study → **Romanisation** has **Show pinyin** and **Show bopomofo**
  (Chinese) and **Show romaji** (Japanese), each Always or Never. A hidden one appears nowhere: word pages, search,
  the reader (popup, phone sheet, ruby), word lists, Stats, every flashcard kind and the kana trainer. On a card it is
  the last hint; Tones cards answer with tone numbers and contours; Starter mode starts at the kana or the
  characters. Searching by romaji or pinyin still works. Tone colours and furigana keep their own switches.
- Home shows what it showed last at once when you come back to it and refreshes quietly behind, with no loading lines (#290). The decks page, the Reader's library and the Stats widgets work the same way. After a reload or in the Android app your widget layout shows at once too. When a refresh fails the page keeps what it shows and says so in one quiet line.

## Fixed

- Tones cards accept the tone a syllable is spoken with (#300): 不客气 is right as 4-4-neutral (the dictionary) and as 2-4-neutral (spoken, 不 before a fourth tone is bú); the same for 一 and for third tones in a row (你好). The answer shows both where they differ, bù → bú. Settings → Study → **Tones**: **Show tone sandhi** (on) and **Grade spoken tones** (off), per workspace.
- Study: the study modal's "This session" is now the session's real length. A Word Salad, Cloze, Writing, Tone or
  Reverse card is planned only for words that can make one (the server checks before the session starts), so a
  Japanese deck without example sentences no longer counts down from 20 to "no cards" (#288). The home widget's
  "new left today" counts those cards too.
- Study: the study modal and Advanced settings only offer the card types that have something to study in the chosen
  decks or level, and say in one line why a type is left out (for example no example sentences yet); a hidden
  type keeps its saved choice and comes back when it has cards (#289).

- Switching off the Scripts feature no longer fails with an error (#294).
- Settings → Data no longer scrolls sideways on a phone when a pack has a long id, attribution or package line; the admin tables (users, invites), the sessions and access-token tables and the language table scroll inside their own box instead of widening the page (#296).
- Reader on a phone: the lookup sheet takes at most about half the screen (55 %), so the text stays in view; a long entry scrolls inside the sheet (#282).
- Phone with the bottom bar: the top bar shows the qinqin logo, a link to Home, instead of the section's name, on every page (#293).
- Android: the black "qinqin" bar at the top of the app is gone; the web app fills the screen up to the status bar (#283).
