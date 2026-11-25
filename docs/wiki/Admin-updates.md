# Updates and the release check

Settings → Admin → **Updates** shows which qinqin you run and whether a newer release exists. It never updates anything: you update the container yourself ([Upgrading](Admin-upgrading)).

## What the page shows

- **Installed**: the version, and for a release image the commit and the build date. The build date is the date of the commit, so every rebuild of one commit shows the same day. A build that is not a release (a `develop` image, `go run`) reports `dev`; it cannot be compared and the page says so.
- **Latest release**: the newest release on the project's GitHub Releases page, with its notes (plain text) and a link. Pre-releases (`0.7.0-rc1`) count only when you switch **Include pre-releases** on.
- **State**: *Version X is available*, *You are up to date*, *newer than the latest release* (a build from after the last release), or the reason the check has no answer.
- **Offline**: when the server cannot reach GitHub, the page says so and keeps showing the last release it knew (*Showing the last known release*). A rate limit from GitHub (60 requests an hour per address for anonymous callers) is named too.

## When the server contacts GitHub

Only when an administrator opens the Updates section or presses **Check now**, and only when the last answer is older than 6 hours (15 minutes after a failure). Never in the background: an instance nobody looks at never calls out. Check now skips the 6 hours but not a 30 second pause between requests. The answer is kept in memory; a restart forgets it.

The request is one HTTPS `GET https://api.github.com/repos/Elaktrato/qinqin/releases`. GitHub sees your server's IP address and the fixed user agent `qinqin-update-check`. Not sent: the version, the instance's name or address, an id, any user data or cookie. There is no telemetry and nothing else leaves the server.

## Switching it off

Untick **Check for new releases**: the server then never contacts GitHub for this, and the page says the check is off. The change is in the audit log. The setting is stored in the database (a restore brings it back).

## A token for a shared address

If many servers share one outgoing address and GitHub's limit bites, set `QINQIN_UPDATE_TOKEN` to a GitHub token without any scope (a fine-grained token for public repositories needs no permission). It is sent only to `api.github.com`, never stored in the database and never shown.

## For other clients

`GET /api/version` is public and tells a client that this is a qinqin server: `{app: "qinqin", version, contract, bridge}`; with a sign-in it also has `commit` and `buildDate`. The Android shell reads it on its first-run screen. The rules are in [docs/contracts/version](https://github.com/Elaktrato/qinqin/tree/develop/docs/contracts/version).
