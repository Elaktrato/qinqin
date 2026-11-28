# Feature switches (`/api/features`)

Issue #199, record 0006. qinqin has no code plugins: flashcards, the reader, the journal, grammar, the
writing-system trainer (#204), Practice (the drills, `drills/`), courses (#222) and Stats (#295) are core features, each with a per-user switch
(`server/internal/features/`, migration 047, table `feature_switches`; since migration 055 the table has no list
of ids and `features.IDs` is the only one). The ids and the order are fixed: `flashcards`, `reader`, `journal`,
`grammar`, `scripts`, `practice`, `courses`, `stats`.

| Route | Answer |
| --- | --- |
| `GET /api/features` | the caller's switch of every core feature, in the order above: `[{id, enabled, updatedAt}]` |
| `PUT /api/features/{id}` `{enabled}` | stores one switch; answers the stored `{id, enabled, updatedAt}` |

Both need a user; an access token may read (`GET`, scope `read`) and write (`PUT`, scope `write`) them. A
feature the caller never switched is on, with `updatedAt` null. An id that is no core feature is 404
`not_found` (the old plugin ids such as `qinqin-journal` included); a body without a boolean `enabled` is 400
`bad_request`.

Switching a feature off only hides it in the client (navigation, page, widgets, Settings → Features). The
server never refuses or hides the feature's data, routes or events while it is off, and switching off deletes
nothing.

## Stats switched off (#295)

Stats is a feature like the others: switched off, the client hides

- the Stats section (top bar, phone drawer, bottom bar and its More sheet) and the pages `/stats`, `/stats/week` and
  `/stats/characters` (a direct link shows the switched-off notice with a link to Settings → Features);
- the Stats widgets on Home and in the widget editor: `activity-heatmap`, `reviews-per-day`,
  `character-map-summary`, `summary-numbers` (owned by `stats`) and `word-states` (owned by `flashcards`, needs
  `stats` too: a widget is shown only while its owner and every feature it needs are on);
- the links into the Stats pages from other screens (the weekly-summary widget, the milestone card, the reader's
  display settings, the advanced study settings).

What stays: streaks, EXP and the daily goal where other features show them (the study session, the flashcards
widget, the daily-goal widget); the weekly-summary widget, the weekly-summary notification and the milestone cards,
which keep their own settings; the other features' widgets (flashcards summary, reading time, scripts progress). The
server keeps every event and statistic route as it is.

A client reads a list (`reads`) leniently: a feature without a row is on, a row whose `id` is not a string or
whose `enabled` is not a boolean is skipped (so its feature is on).

The switches also travel in the paged pull as the collection `features` (rows `{id, enabled, updatedAt}`, only
the features the user switched; `sync/pull-page.json`) and in a personal backup's account as `features:
[{id, enabled}]` (`backup/README.md`). The web reads them through the route; its study pull does not ask for
them.

| File | Rule | Decoded by |
| --- | --- | --- |
| `switches.json` | the order, the list of a fresh and a switched user, how a client reads a list, the PUT answers | `server/internal/api/handlers_features_test.go` (`TestFeaturesContract`), `apps/web/src/lib/features/switches.test.ts` |
