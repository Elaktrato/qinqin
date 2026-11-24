# Grammar lesson progress (`/api/grammar/progress`)

Issue #199. Grammar is a core feature with a per-user switch (`features/`). Its lessons come from installed
`grammar` packs (`packages/`, `GET /api/grammar`, `GET /api/grammar/{pack}/{lesson}`); what a learner did is
typed storage of the server (`server/internal/grammar/progress.go`, migration 045): one row per lesson of a
workspace.

| Route | Answer |
| --- | --- |
| `GET /api/grammar/progress?workspace=<id>` | every lesson's progress of the workspace, by pack and lesson: `[{packId, lessonId, completedAt, best, total}]` |
| `POST /api/grammar/progress?workspace=<id>` `{packId, lessonId, score, total}` | records a finished run; answers the stored row |

Both need a user (no access token) and one of the caller's workspaces (missing or not an integer: 400
`bad_request`; unknown or foreign: 404 `workspace_not_found`). A run is refused with 400 `bad_request` unless
`0 <= score <= total <= 1000`, `lessonId` is a lesson id (`^[a-z0-9]+(-[a-z0-9]+)*$`) and `packId` matches
`^[A-Za-z0-9._-]{1,128}$`. The server does not check that the lesson is installed: progress of a pack that
was removed is kept and shows again when the pack is reinstalled.

The rule (`runs`): `completedAt` is the server's time of the run; `best` is the higher of the stored best and
the run's score when the stored `total` equals the run's, else the run's score (a lesson whose number of
exercises changed, by a re-import or a script conversion, starts over). The server applies it in one
statement, so two runs finishing at once never lower a best score. A client reads a row (`reads`) only when
every member is present, `best` and `total` are whole numbers and `0 <= best <= total`.

A personal backup carries each row in its keyed form `grammar:progress:<packId>:<lessonId>` with
`{completedAt, best, total}` (`backup/README.md`).

| File | Rule | Decoded by |
| --- | --- | --- |
| `progress.json` | the keep-the-best rule, refused runs, which rows a client reads | `server/internal/grammar/progress_contract_test.go`, `apps/web/src/lib/features/grammar/progress.test.ts` |
