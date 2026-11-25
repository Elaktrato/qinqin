# Version, build metadata and release check (issue #154) — design

Status: proposed, 2026-11-25. Written unattended; every decision is a Ruling the owner can undo. Plan:
`docs/superpowers/plans/2026-11-25-version-check.md`.

## Goal

1. A release image reports its real version, commit and build date (today `main.version` is `dev` everywhere).
2. A public route lets the Android shell's first-run screen verify "this is a qinqin server" before sign-in, and
   lets the shell and the server compare their native-bridge features.
3. An administrator sees the installed and the latest release, with release notes and a clear offline state, can
   switch the check off and can ask for a check now. No telemetry.

## Build metadata

`main.version`, `main.commit` and `main.buildDate` are set with `-ldflags -X`. The Dockerfile takes `ARG VERSION`,
`COMMIT`, `BUILD_DATE` (defaults `dev`, empty, empty) and passes them. `build.yml` passes, for a `v*` tag, the tag
without its `v` (`v0.7.0` becomes `0.7.0`; `v0.7.0-rc1` becomes `0.7.0-rc1`), for every other build `dev`; the commit is
`github.sha`; the date is the commit's committer date in UTC. A binary built without the flags (go run, e2e) reads
`vcs.revision` and `vcs.time` from `debug.ReadBuildInfo` when present, else commit and date are empty.

Ruling: build date = commit date, not the wall clock — the date is then the same for every rebuild of one commit,
which keeps the image reproducible from its inputs — cost if wrong: the date shows the commit, not the build, day.

Ruling: non-tag builds report version `dev` (not `0.7.0-dev+sha`) — the sha is its own field and "dev" is what
the code already compares as "unknown" — cost if wrong: a `develop` image cannot say which release it follows.

## Routes

| Route | Access | Answer |
| --- | --- | --- |
| `GET /healthz` | public | unchanged, `ok` |
| `GET /api/version` | public; more for a signed-in caller | `{app, version, contract, bridge}`, plus `commit`, `buildDate` with a valid full session |
| `GET /api/admin/update` | admin | installed build, settings, the check state |
| `PATCH /api/admin/update/settings` | admin | `{enabled?, prereleases?}`, answers like the GET |
| `POST /api/admin/update/check` | admin | checks now (at most once per 30 s), answers like the GET |

Ruling: one `/api/version` URL with extra fields for a signed-in caller, not a second route — the shell and the
web read one URL, the public part is a strict subset, and nothing secret is behind the extras — cost if wrong: a
caching proxy must not share the two answers, so the route sends `Cache-Control: no-store`.

Ruling: the public block carries `version` (the release tag without `v`, or `dev`) but never commit or date —
the shell needs a version to show and to compare, while the commit and date identify a build more exactly than
anonymous callers need — cost if wrong: version fingerprinting of an old release is possible; a server that is
public on the internet is scanned for it anyway.

`app` is the constant `qinqin`: the unambiguous "this is qinqin" signal (a random server answering `/api/version`
with JSON would not carry it). `contract` and `bridge` below.

The administrator routes are separate from the version route because they can reach GitHub, mutate a setting and
carry release notes; they live in `/api/admin/update`, next to the other admin settings.

### Contract version

`contract` is an integer, `api.ContractVersion` (`server/internal/api/version.go`). Rule
(`docs/contracts/version/README.md`): it goes up by one in the same change that adds a `docs/contracts/CHANGELOG.md`
entry a client must follow (a route, a changed answer, a retired fixture). The newest entry that bumps it carries
`(contract N)` in its heading; `TestContractVersionMatchesTheChangelog` compares the first such heading with the
constant. Entries from before #154 count as contract 0. This issue is contract 1.

Ruling: an integer, not semver — a contract has no "compatible patch": a client follows the entry or does not —
cost if wrong: a later need for minor/major means a second field.

The shell does not refuse a server because of `contract`; it shows the number in the "About" screen and may warn
when the server's is lower than the one the shell was built against. Compatibility of native features is
`bridge`.

### Bridge

`bridge = {level: int, features: [string]}` is what **this server's web app** can use from a native shell.
`level` goes up when the web app starts to rely on a shell behaviour that an older shell lacks; `features` are
names of the optional pieces (`secure-storage`, `tts`, `share`, `files`, `status-bar`, `keep-awake`, `local-notifications`; the shell design lists them) the web app uses when the shell has them.
Today the web app calls none of them: `{level: 1, features: []}`.

The shell has its own `{level, features}` (what it implements). The pure function `bridgeCompatibility(server,
shell)` (`apps/web/src/lib/api/version.ts`, fixture `docs/contracts/version/bridge-compat.json`):

- `shellOutdated`: the shell's level is below the server's, or the shell lacks features the server lists
  (`missing` names them, sorted);
- `serverOutdated`: the shell's level is above the server's (the shell expects a newer web app);
- `ok` otherwise. When both apply, `shellOutdated` wins: the shell can be updated, a server may not be.

Ruling: `level` plus named `features`, not one number alone — a level says "too old", the names let the warning
say what is missing and let a feature be skipped without raising the level — cost if wrong: two fields to keep
in step.

Ruling: the server's list means "uses when present", so a missing feature is a warning, not a refusal — the web
app has to work in a browser, which has none of them — cost if wrong: a shell may warn about a feature that the
web app handles without it.

Note for the shell: the first-run screen should call the route with the native HTTP plugin; a call from the
WebView origin (`capacitor://localhost`) would need CORS on this route, which the server does not send.

## Release check

Source of truth is the GitHub Releases of the project (`build.yml` creates one per `v*` tag). One request,
`GET https://api.github.com/repos/Elaktrato/qinqin/releases?per_page=30`, with `Accept:
application/vnd.github+json` and a fixed `User-Agent: qinqin-update-check`. The newest release by semantic
version among non-draft ones (pre-releases only when the setting asks) is the latest; the list also gives
every release's notes.

What is sent: an HTTPS GET with the server's IP address as the TCP peer, the fixed user agent, the `Accept` and
`X-GitHub-Api-Version` headers, `If-None-Match` after the first answer, and `Authorization: Bearer` when the
administrator set `QINQIN_UPDATE_TOKEN` (never to another host: Go drops it on a cross-host redirect). Not sent:
the version, the instance's name or URL, an id, any user data, any cookie. The answer is cached in memory.

Ruling: no version in the user agent — GitHub does not need it and it would tell the host which release an IP
runs — cost if wrong: none for the check; GitHub's logs of per-version use are not available to the owner.

Ruling: GitHub Releases only; no GHCR digest check — `latest` on GHCR follows `main`, not a release, and a digest
says nothing a person can act on — cost if wrong: an instance on the rolling `latest` tag sees "up to date" while
`main` moved.

Ruling: stable only by default, a switch "include pre-releases" — a release candidate on a family server is a
choice — cost if wrong: an administrator who wants rc builds flips a switch.

Ruling: the check is **on by default and lazy**: the server contacts GitHub only when an administrator opens
Settings, Admin, Updates (or presses Check now), never in the background, so an instance nobody looks at never calls out;
the switch turns even that off — an on-demand request is what a person would do in a browser, and the answer is
the value of the feature (default off would leave the page empty for everyone who never finds the switch) —
cost if wrong: a privacy-first owner flips the default in the migration (`enabled DEFAULT 0`); one request per
cache window leaves a server that nobody asked for.

Cache: a good answer is fresh for 6 hours, a failure for 15 minutes; a stale cache is revalidated with the ETag
(a 304 costs no rate limit); "Check now" bypasses the freshness but not a 30 s floor. After a failure the last
good answer stays in the state as `stale`, so the page still shows the latest known version with "offline" beside it.
Timeout 8 s, response read capped at 1 MiB. Notes are capped at 16 KiB and shown as plain text.

Ruling: the cache lives in memory — a restart costs one conditional-less request — cost if wrong: a crash loop
spends GitHub's 60 requests an hour; the 15-minute failure window and the lazy trigger bound it.

State (`check.state`): `disabled`, `unchecked` (enabled, not yet asked), `ok`, `error` with
`check.error` one of `offline` (no connection, DNS, timeout), `rate_limited` (403/429 from GitHub), `bad_response`
(anything else). `check.latest` is `{version, tag, name, url, publishedAt, prerelease, notes}`; `check.update` is
`available`, `current`, `ahead` or `unknown` (installed `dev` or a version that does not parse); `check.checkedAt`.

Comparison is semver 2.0 (`major.minor.patch`, pre-release identifiers compared as the spec says, `+build` ignored,
a leading `v` stripped). Tags that do not parse are ignored.

The setting is a one-row table `update_settings` (migration 051): `enabled`, `prereleases`. The token is an
environment variable, not a row, so no secret is stored. Changes are audited (`settings_changed`, field name and value).

## Web

`apps/web/src/lib/api/version.ts`: `getVersion()`, the types, `bridgeCompatibility`. The administrator's page is a new
Admin section `updates` (`lib/admin/UpdatesAdmin.svelte`, `lib/api/adminUpdate.ts`): installed version (and commit,
date) against latest, the notes, the state, two switches, a Check now button. Every string is in the i18n catalogue.
`/api/version` also feeds a one-line "version" in the Admin section; the shell's first-run use is later work.

## Out of scope

The shell itself, an in-app "update now" (the administrator updates the container), a notice outside Settings
(a badge on the Admin tab would call out on every page load of an administrator; later, if wanted), checking
GHCR, release notes in markdown.
