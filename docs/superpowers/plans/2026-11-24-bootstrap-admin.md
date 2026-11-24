# Bootstrap administrator by default (#211)

A fresh install gets an administrator before the port opens, every time, so no deployment has a window in
which the first registration over the API decides who is admin.

Before: `QINQIN_BOOTSTRAP_ADMIN` was opt-in. Unset, no admin was created and the first registration on an
empty database became the administrator, in every registration mode (`GET /api/auth/options` said so with
`bootstrap: true`, and the register page showed "the first account becomes the administrator").

## Design

- `serve` (only `serve`) calls `bootstrapAdminFromEnv` before the port opens, as before. While the users
  table is empty it now creates an administrator **by default**:
  - username `admin`, or the value of `QINQIN_BOOTSTRAP_ADMIN` when set (trimmed, the usual username rules);
  - password `QINQIN_BOOTSTRAP_PASSWORD`, else 20 random URL-safe characters (120 bits) printed **once** in
    the log (`bootstrap: initial password (shown once, never again): ...`). A supplied password is never
    logged. There is no fixed default password;
  - the forced password change at the first sign-in stays (`auth.BootstrapAdmin` is unchanged).
- `QINQIN_BOOTSTRAP_ADMIN=off` (any case, surrounding spaces ignored) switches it off. On an empty instance
  serve then logs that no administrator exists and how to create one (`qinqin adduser --admin`).
- An invalid name or password still stops `serve` before it listens.
- Once users exist both variables are ignored and nothing is logged, so they can stay set.
- Registration on an empty instance is **closed**: `POST /api/auth/register` no longer has a zero-users path;
  the instance's registration mode decides as for any instance (default `closed`, so 403
  `registration_closed`). `auth.CreateFirstUser` and its API hook go. `GET /api/auth/options` loses
  `bootstrap`; the web register and sign-in pages lose the bootstrap notice and link.

## Rulings

- Ruling: the opt-out value is `off` (case-insensitive, trimmed) — one obvious word that reads well in a
  compose file next to a username, and matches the wiki's other on/off switches; an empty value keeps the
  default (`admin`), so the compose file's `${QINQIN_BOOTSTRAP_ADMIN:-}` gives every fresh `docker compose up`
  an admin — cost if wrong: nobody can bootstrap an admin literally named `off` (create it with `adduser`).
- Ruling: an empty instance with the bootstrap off has registration **closed** until an administrator exists
  (`qinqin adduser --admin`) — no licensing impact; the opt-out exists for deployments that create the admin
  with `adduser`, so they never need the first-registration path, and keeping it would keep the takeover
  window open exactly where the operator turned the safe default off; it also removes a special case from
  the register route and `bootstrap` from the options contract — cost if wrong: an operator who opts out and
  wants to pick the admin in the browser must instead set `QINQIN_BOOTSTRAP_ADMIN=<name>` (and optionally
  the password) or run `adduser`; the startup log and the wiki say so.
- Ruling: the closure needs no special case: with no users nobody can have changed the registration mode, so
  the migration default `closed` applies; a restored or hand-edited database whose mode is `open` or
  `invite` with zero users lets a registration through as an ordinary non-admin user — cost if wrong: such an
  instance has users but no admin; `adduser --admin` fixes it.
- Ruling: only `serve` bootstraps; `seed`, `adduser`, `backup`, `recover` and the other commands that open the
  database do not — they run before or beside a server, and `adduser` on an empty database is the opt-out
  path itself; bootstrapping there would create a second admin or print a password into a one-off command's
  output — cost if wrong: none known; a later serve still bootstraps an empty database.
- Ruling: the trigger stays "no users" (not "no admin"), the same guarded `INSERT ... WHERE NOT EXISTS`
  `auth.BootstrapAdmin` already uses, so two processes racing on one database create one admin and the loser
  logs nothing — cost if wrong: a database whose only users are non-admins (an `adduser` without `--admin`
  before the first serve) gets no admin; `adduser --admin` fixes it.
- Ruling: `QINQIN_BOOTSTRAP_PASSWORD` set together with `off` is ignored with one log line naming the
  variable (never the value) — a contradictory but harmless setting should not stop a server that has users;
  the line tells the operator to remove it — cost if wrong: an operator who ignores logs keeps a password in
  the stack that does nothing.
- Ruling: the e2e suite needs no change: its template creates `e2e-admin` with `qinqin adduser --admin` before
  any `serve`, so the instance already has users and the bootstrap never runs there; no spec relies on first
  registration becoming admin (`register.spec.ts` opens registration as the admin first) — cost if wrong: a
  future spec that serves an empty data directory gets a bootstrap admin it does not know the password of;
  set `QINQIN_BOOTSTRAP_ADMIN=off` or a known password there.
- Ruling: Go tests that registered their first user anonymously to get an admin now create it in the
  database (`auth.CreateUser(..., admin=true)`, as `adduser` does) through their helpers; tests that pinned
  the zero-users registration now pin 403 `registration_closed` — the production path is closed, so no test
  seam keeps it open — cost if wrong: none for users; a larger test diff.

## Tasks

1. **Bootstrap by default** (`server/cmd/qinqin/bootstrap_env.go`). Tests first in `bootstrap_env_test.go`:
   default (`admin`, generated password logged exactly once, admin with a forced change; a later start logs
   nothing), named admin, supplied password never logged, `off` (nothing created, a hint logged, a supplied
   password ignored with a line that does not contain it), non-empty database (nothing happens, invalid
   values not even read), invalid name or password (error naming the variable), a race between two database
   handles on one file (one admin, one password line, both calls nil), and `serve` itself refusing to listen
   on an invalid name. Commit `feat(server): create a bootstrap administrator by default (#211)`.
2. **Registration closed on an empty instance** (`internal/api/handlers_auth.go`, `internal/auth/auth.go`).
   Tests first: an empty instance answers 403 `registration_closed` and creates nothing; options carry no
   `bootstrap`. Remove `CreateFirstUser`, the `createFirstUser` hook and `bootstrap`; move every Go test that
   registered an anonymous first admin to a database-created admin. Contract: `auth/options.json`,
   `auth/README.md`, `CHANGELOG.md`. Commit `feat(auth): no admin by first registration (#211)`.
3. **Web**: drop `bootstrap` from `AuthOptions`, the register notice and the sign-in link it opened, and the
   `auth.register.bootstrap` string. Tests first in the register and login page tests. Commit
   `feat(web): drop the first-registration notice (#211)`.
4. **Docs**: wiki (`Admin-deploying`, `Admin-environment-variables`, `Accounts-and-sign-in`,
   `Admin-users-and-registration`, `Getting-started`, `Troubleshooting`, `API-Reference`), README,
   `docker-compose.yml` comments, `docs/releases/NEXT.md`. Commit `docs: bootstrap administrator by default
   (#211)`.

## Execution record

(filled in as the tasks land)
