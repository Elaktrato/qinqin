# Feature switches (`/api/features`)

Issue #199, record 0006. qinqin has no code plugins: flashcards, the reader, the journal and grammar are core
features, each with a per-user switch (`server/internal/features/`, migration 047, table `feature_switches`).
The ids and the order are fixed: `flashcards`, `reader`, `journal`, `grammar`.

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

A client reads a list (`reads`) leniently: a feature without a row is on, a row whose `id` is not a string or
whose `enabled` is not a boolean is skipped (so its feature is on).

The switches also travel in the paged pull as the collection `features` (rows `{id, enabled, updatedAt}`, only
the features the user switched; `sync/pull-page.json`) and in a personal backup's account as `features:
[{id, enabled}]` (`backup/README.md`). The web reads them through the route; its study pull does not ask for
them.

| File | Rule | Decoded by |
| --- | --- | --- |
| `switches.json` | the order, the list of a fresh and a switched user, how a client reads a list, the PUT answers | `server/internal/api/handlers_features_test.go` (`TestFeaturesContract`), `apps/web/src/lib/features/switches.test.ts` |
