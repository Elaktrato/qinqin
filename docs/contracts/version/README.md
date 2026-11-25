# Version, native bridge and release check (#154)

Design: `docs/superpowers/specs/2026-11-25-version-check-design.md`.

Fixtures:

- `version.json` — the answers of `GET /api/version` (Go: `api/handlers_version_test.go`).
- `bridge-compat.json` — `bridgeCompatibility(serverBridge, shellBridge)` (web: `lib/api/version.test.ts`).
- `update-check.json` — the release check: how the installed version stands against the latest one, the state
  names, and the shape of `GET /api/admin/update` (Go: `update/check_test.go`, `api/handlers_version_test.go`).

## `GET /api/version`

Public, `Cache-Control: no-store`. `{app, version, contract, bridge}`: `app` is always `"qinqin"` (the "this is
qinqin" signal for a shell's first-run screen), `version` the release without its `v` or `dev`, `contract` and
`bridge` below. A full session adds `commit` and `buildDate` (the commit's date, RFC 3339 UTC; both may be empty).
No CORS: a native shell calls it with its HTTP plugin, not from the WebView origin.

## Contract version

`contract` is an integer, `api.ContractVersion`. It goes up by one in the same change that adds a
`CHANGELOG.md` entry a client must follow (a route, a changed answer, a retired fixture). The newest entry that
bumps it has `(contract N)` in its heading; `TestContractVersionMatchesTheChangelog` compares it with the
constant. Entries from before #154 count as contract 0. A shell may warn when the server's is lower than the
one it was built against; it does not refuse a server for it.

## Bridge

`bridge = {level, features}` is what this server's web app can use from a native shell. `level` goes up when
the web app starts to rely on a shell behaviour an older shell lacks; `features` names the optional pieces the
web app uses when the shell has them (`secure-storage`, `tts`, `share`, `files`, `status-bar`, `keep-awake`,
`local-notifications`). A server lists a feature when its web app uses it if the shell has it; a shell lists what
it implements (the Android shell: `status-bar`, `QinqinShell.setBars`). Today: `{level: 1, features: ["status-bar"]}`. `bridge-compat.json` is the rule: `shellOutdated`
(level below the server's, or features missing, sorted), `serverOutdated` (level above), else `ok`;
`shellOutdated` wins. A missing feature is a warning: the web app also runs in a browser, which has none.

Who uses the rule: the Android shell's first-run screen (`apps/android/src/firstrun/verify.ts`) compares the
server's bridge with `SHELL_BRIDGE` and warns before opening the app. That screen is a separate bundle in the
APK and cannot import the web app, so the rule is written twice; `bridge-compat.json` pins both copies. The web
app's `lib/api/version.ts` (`getVersion`, `bridgeCompatibility`) is the reference implementation of the same
rule and is not called by any screen today.

## Administrator routes

`GET /api/admin/update` (installed build, settings, check; contacts GitHub only when the cache is stale),
`PATCH /api/admin/update/settings {enabled?, prereleases?}`, `POST /api/admin/update/check` ("check now", at most
one request per 30 s). All answer `{installed, settings, check}` (`update-check.json` `answer`), `no-store`.
`check.state` is `disabled`, `unchecked`, `ok` or `error` (`check.error`: `offline`, `rate_limited`,
`bad_response`; `check.stale` is true when `check.latest` is the last good answer). Release notes are plain
text, at most 16 KiB.
