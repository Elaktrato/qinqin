# Sense display (#345)

How a client shows the senses of a dictionary entry: which meanings come first and which are folded behind "more".
Every client implements it identically; the server applies it where it picks one gloss for a list. Fixture:
`display.json` (rule `senses/display`; Go: `server/internal/lexicon/senses_test.go`, `lexicon.DisplaySenses`; web:
`apps/web/src/lib/entry/senseDisplay.test.ts`, `senseDisplay.ts`).

The rule is a **display rule**. Stored senses keep the order and the count the dictionary import gave them (one per
CC-CEDICT line, one per JMdict `<sense>`): picture mappings (`images/`, the `sense` column) and JMdict
cross-references ("山札・1") count stored senses, and an existing database follows the rule without a re-import.

## Input

An entry's senses in stored order (`(dictionaryId, ord, id)`, as the entry answer's `senseGroups` and the lookup
answer's `senses` list them), each with its `tags` (JMdict `<misc>` entity names; CC-CEDICT senses carry none) and
its `glosses`. The rule does not look at the dictionary: a caller keeps each unit's `sense` index to reach it.

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

## Units, order and folding

1. Each sense gives at most two **units**, in this order: its unmarked glosses (class `everyday`, `mark` null), then
   its marked glosses (class `sensitive`, `mark` the strongest of theirs). Glosses keep their order inside a unit; a
   sense without glosses gives none.
2. **Order:** every everyday unit in sense order, then every sensitive unit in sense order.
3. **Folding:** sensitive units are `folded` unless the entry has no everyday unit (a word whose only meaning is
   vulgar, 鸡巴: it is shown, marked, in the stored order).
4. **The one gloss** a list shows is the first gloss of the first unit (`gloss` in the fixture).

## Where clients apply it

- **Cards** (vocab, Starter mode, reverse backs): the unfolded units, grouped by dictionary in first-seen order;
  the folded ones behind a "Show n more meanings" button, each marked. The reverse card's front and the writing
  card's prompt take their glosses from the first unfolded units.
- **Lookup popup and sheet:** the units in display order, the first three shown as before; a folded unit is never
  among those shown before "Show more senses". A sensitive unit carries its mark as a chip.
- **Entry page:** every unit in display order, grouped by dictionary, sensitive ones unfolded and marked (the full
  entry keeps them for completeness).
- **Server lists:** the `gloss` of `GET /api/starter-sets/{id}` and `GET /api/frequency-packs/{id}/top` entries, the
  first gloss per dictionary of `GET /api/search` hits, the `gloss` of an entry's `characters`, and the glosses an AI
  example request is given (folded units left out).
