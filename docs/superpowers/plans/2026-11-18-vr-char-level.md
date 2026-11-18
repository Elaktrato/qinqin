# Character map: choose the level you are studying (owner request 2026-11-18)

## Goal

Stats → Characters shows every Han character the server knows. A learner preparing for one
level (JLPT N5, HSK 2, Jōyō grade 3) does not want 10k+ characters they have not studied;
they want that level's list and its own "X of 150 learned" count. Add an optional level
filter to the map. No server or contract change: `GET /api/schemes/{id}/characters` already
sends each installed level's characters, lowest level wins, and the page already loads it
for a scheme grouping.

## What the person sees

- A **Level** select above **Group by**, default **All levels**.
  - Options are an "All levels" option plus one `optgroup` per installed level scheme of
    the workspace language, each with its levels in level order (JLPT N5–N1, HSK 1–6 and
    7–9, HSK words, Jōyō grades, 通用规范汉字表, an administrator's packs).
  - The bundled samples (`hsk-mini`, `jlpt-mini`) are hidden like the Group by list.
  - `joyo-grades` stays available here even though it is hidden from Group by (Grade is the
    same list).
- Choosing a level restricts the map, the stage filter counts and the **X of Y learned**
  summary to that level's characters. The learned rule is unchanged (mastery threshold).
- Choosing a level also switches **Group by** to that level's scheme, so the map opens on the
  chosen level rather than on empty sections of another scheme. The person can then regroup
  the same level by Grade / Frequency / Strokes.
- **All levels** clears the filter and keeps the current grouping.
- The choice is remembered per workspace (`localStorage`), so two workspaces of one language
  can be at different levels. A stored level that no longer exists (its pack was uninstalled)
  falls back to All levels.
- A character that belongs to the level through a variant form (a traditional/simplified
  partner) is included, the same rule the scheme grouping uses.
- The empty state says that the level has no characters if the installed list is empty.

## Approach and Rulings

- Ruling: a level **filter** separate from Group by, not one option per level in Group by —
  the person wants "my level" while keeping the grouping choice (grade, frequency, strokes);
  one list would conflate the two. Cost: one more control in the map's control row.
- Ruling: the filter includes a character whose variant form is in the level — the map's
  cells merge those forms, and the scheme grouping already assigns them this way. Cost: a
  level's visible cell count can differ from the raw list length by the merged variants.
- Ruling: remember the level per workspace, not per language like Group by — two workspaces
  of one language can study different levels. Cost: a new browser does not know the choice
  until it is made again.
- Ruling: choosing a level changes Group by to its scheme — otherwise the first view is a
  list of empty sections from another scheme. Cost: the previous grouping is replaced; the
  person can choose it again.

## Tests

- Pure `lib/study/charLevels.ts`: option groups (language, order, sample/hidden rules,
  duplicate scheme names), stored selection validation, `filterByLevel` includes variants.
- Page `routes/stats/characters/page.dom.test.ts`: the Level select renders with All levels
  and the scheme groups; choosing JLPT N5 fetches the scheme, shows one populated section
  and the N5 **0 of N learned** summary; All levels restores; a stored choice is read and
  a stale one falls back.
- The existing character-map tests stay green.

## Gates

Targeted web tests, `npm run check`, the i18n catalogue tests, and the normal page gates.
No Go change; no contract fixture change.
