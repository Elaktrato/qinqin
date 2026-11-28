# Sense display (#345, #346)

How a client shows the senses of a dictionary entry: which meanings come first, which come last, which are folded
behind "more", and which belong to a pinned reading.
Every client implements it identically; the server applies it where it picks one gloss for a list. Fixture:
`display.json` (rule `senses/display`; Go: `server/internal/lexicon/senses_test.go`, `lexicon.DisplaySenses`; web:
`apps/web/src/lib/entry/senseDisplay.test.ts`, `senseDisplay.ts`).

The rule is a **display rule**. Stored senses keep the order and the count the dictionary import gave them (one per
CC-CEDICT line, one per JMdict `<sense>`): picture mappings (`images/`, the `sense` column) and JMdict
cross-references ("山札・1") count stored senses, and an existing database follows the rule without a re-import.

## Input

An entry's senses in stored order (`(dictionaryId, ord, id)`, as the entry answer's `senseGroups` and the lookup
answer's `senses` list them), each with its `tags` and its `glosses`, and optionally a **pinned reading** (`pinned`).
The rule does not look at the dictionary: a caller keeps each unit's `sense` index to reach it.

Tags are JMdict's `<misc>` entity names, plus **reading tags** `reading:<value>` (#346): the importer tags each
CC-CEDICT sense with its line's reading as stored (`reading:Shū`, `reading:huáng sè`) and each JMdict sense with
its `<stagr>` restrictions (`reading:こんにち`). A sense without a reading tag belongs to every reading. A client shows
reading tags nowhere (they are not chips). A database imported before #346 has none: a pin then changes nothing.

## The pinned reading

With a non-empty `pinned`, only the senses **of that reading** take part: a sense with no reading tag, or with a
reading tag whose value equals the pin when both are compared in lower case without white space and apostrophes
(`shuǐ` matches CC-CEDICT's `Shuǐ`; `huángsè` matches `huáng sè`; tone marks count: `hē` is not `hè`). A pin that
no sense with glosses belongs to is ignored, so a card never goes blank. Dropped senses give no unit.

## Marks

A gloss is **marked** `vulg`, `derog` or `sl` when any of these holds; the strongest mark wins (`vulg`, then `derog`,
then `sl`):

1. its sense has a JMdict tag: `vulg` → `vulg`; `derog` → `derog`; `sl`, `net-sl`, `m-sl` → `sl`;
2. a parenthesised note of the gloss (`(...)` without nested parentheses: CC-CEDICT's markers, "(slang)",
   "(vulgar)", "(derog.)", "(Internet slang)", "(sometimes derog.)") contains, ignoring case, `vulgar` or `expletive`
   (→ `vulg`), else `derog`, `pejorative` or `offensive` (→ `derog`), else `slang` (→ `sl`);
3. the gloss contains one of the `explicitWords` of the fixture as a whole word (ASCII word boundaries, ignoring
   case; "Dickens" is not "dick") → `vulg`. They catch the lines CC-CEDICT leaves unmarked: 黄色 "vulgar; lewd;
   pornographic", 鸟 diǎo "penis", 烟花 "prostitute";
4. the gloss contains one of the `vulgarCharacters` (肏 屄 屌) → `vulg`: CC-CEDICT points at them from unmarked
   lines (草 cào "variant of 肏[cao4]").

Not marks: JMdict `col` and CC-CEDICT "(coll.)" (colloquial: thousands of everyday senses), `sens` (a term some find
impolite: 外人's main sense), `euph` and "(euphemism)" (去世 "to pass away").

## Minor senses (#346)

A sense is **minor** when it has a JMdict tag of `minorTags` (`arch`, `obs`, `rare`, `dated`, `surname`; not `abbr`:
電話's "telephone (device)") or its **first** gloss starts, ignoring case, with one of `minorPrefixes`: a surname,
abbreviation, short name, variant, cross-reference ("see", "used in", "also written") or an archaic, old or
classical line (书 "abbr. for 書經", 水 "surname Shui", 云 "(classical) to say", 猫 máo "used in 猫腰"). The whole
sense is minor, its later glosses too ("Shui ethnic group"); a minor-looking gloss later in an everyday sense leaves
it everyday (喝 "to drink; variant of 嗬"). Capitalised pinyin alone does not make a line minor.

## Units, order and folding

1. Each sense gives at most two **units**, in this order: its unmarked glosses (class `everyday`, or `minor` for a
   minor sense; `mark` null), then its marked glosses (class `sensitive`, `mark` the strongest of theirs). Glosses
   keep their order inside a unit; a sense without glosses gives none.
2. **Order:** every everyday unit in sense order, then every minor unit, then every sensitive unit.
3. **Folding:** sensitive units are `folded` unless the entry has no everyday and no minor unit (a word whose only
   meaning is vulgar, 鸡巴: it is shown, marked, in the stored order). Minor units are never folded.
4. **The one gloss** a list shows is the first gloss of the first unit (`gloss` in the fixture).

## Where clients apply it

- **Cards** (vocab, Starter mode, reverse backs), with the card's pinned reading (the card row's `extra.reading`,
  `study/README.md`; the Starter add flow sets it from the set's `reading`): the unfolded units, grouped by
  dictionary in first-seen order;
  the folded ones behind a "Show n more meanings" button, each marked. The reverse card's front and the writing
  card's prompt take their glosses from the first unfolded units.
- **Lookup popup and sheet:** the units in display order, the first three shown as before; a folded unit is never
  among those shown before "Show more senses". A sensitive unit carries its mark as a chip.
- **Entry page:** every unit in display order, grouped by dictionary, sensitive ones unfolded and marked (the full
  entry keeps them for completeness).
- **Server lists:** the `gloss` of `GET /api/starter-sets/{id}` entries (pinned to the word's `reading`) and of
  `GET /api/frequency-packs/{id}/top` entries, the
  first gloss per dictionary of `GET /api/search` hits, the `gloss` of an entry's `characters`, and the glosses an AI
  example request is given (folded units left out).
