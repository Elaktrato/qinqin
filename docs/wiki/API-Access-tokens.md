# API access tokens

A personal access token lets your own scripts call the qinqin API without your password and without copying a
web session into a file: a cron job that pushes study events, a reader export, a quick `curl` lookup. Create one
in **Settings → Account → Access tokens**; creating one asks for your password again.

**Treat a token like a password.** It acts as you, on your data, until it expires or you revoke it. Never paste
it into a chat, a public repository or a shared script.

## What a token looks like

`qq_pat_` followed by 64 lowercase hexadecimal characters (71 in all). The server stores only its SHA-256 and the
first 6 characters after the prefix (shown in the list as `qq_pat_3f9a1c…`); the token itself is shown once,
when you create it. If you lose it, revoke it and make a new one.

Secret scanners can find leaked tokens with the regular expression:

```
qq_pat_[0-9a-f]{64}
```

## Scope, workspace and expiry

- **Access**: *Read only* (default) or *Read and write*. A read-only token gets 403 `token_read_only` on any route
  that changes something.
- **Workspace**: *All workspaces* (default) or one of your workspaces. A token limited to one workspace may only
  use routes that take `?workspace=<id>` with exactly that id, and the dictionary and content reads that belong to
  no workspace. Routes that span workspaces or address objects by id (sync, the workspace list, a book by id) answer
  403 `token_workspace`.
- **Expiry**: 7, 30, 90 (default) or 365 days in the app (the API, `POST /api/account/tokens`, takes 1 to 365). Every token expires; there are no permanent ones. An expired token
  stays in the list, marked expired, for 30 days.
- At most 20 live tokens per account (409 `token_limit`).
- A token never does more than you could: it reaches only your own data, through the same checks as your
  session, and another user's objects are 404 exactly as in the app.

Which routes take a token, and how a workspace-limited token fares on each, is the **Token** column of
[API routes](API-Routes).

## What a token can never do

Sign-in and account routes (`/api/auth/…`, `/api/account/…`: password, email, two-step sign-in, sessions, the
token routes themselves, export, restore, account deletion), every administrator route (an administrator's token
is an ordinary user token), backups and download tickets, AI keys and providers, the journal and its photos,
creating, renaming or deleting workspaces, changing your time zone or interface language, importing from online
libraries, and the health check. They all answer 403 `token_not_allowed`, before the token is even looked up. Use the app for those.
To check that a token works, call `GET /api/workspaces`. Deleting your lookup history's old search records
(`DELETE /api/events/lookups`) also needs the app.

A token that may read your data can read your personal notes and your [lookup history](Searching-and-entries#lookup-history)
(the `qinqin-core` plugin data rows `note:*` and `lookups`, through the plugin data routes and the sync pull), like
everything else you study; a read and write token can also change them.

## Using it

Send it like a session token:

```sh
export QQ=https://qinqin.example.org QQ_TOKEN=qq_pat_...   # from Settings → Account → Access tokens
curl -sS -H "Authorization: Bearer $QQ_TOKEN" "$QQ/api/workspaces"
curl -sS -H "Authorization: Bearer $QQ_TOKEN" "$QQ/api/lookup?lang=zh&text=%E5%AD%A6&offset=0"
curl -sS -H "Authorization: Bearer $QQ_TOKEN" "$QQ/api/sync/pull?v=2&collections=cards,pluginData&limit=500"
curl -sS -H "Authorization: Bearer $QQ_TOKEN" "$QQ/api/packages"
curl -sS -C - -o lexicon.zh.qqpkg -H "Authorization: Bearer $QQ_TOKEN" "$QQ/api/packages/lexicon.zh/3"
curl -sS -H "Authorization: Bearer $QQ_TOKEN" -H 'Content-Type: application/json' \
     -X POST "$QQ/api/events/batch" --data @events.json
curl -sS -H "Authorization: Bearer $QQ_TOKEN" "$QQ/api/plugins/qinqin-flashcards/data?workspace=3"
```

Since v0.4.0 cards, decks, deck settings, limits and FSRS sets are typed collections of the sync pull and push (`docs/contracts/study/`). A script that reads cards from `pluginData` must ask for it the old way, `collections=pluginData` (it then gets them as `card:` rows), or read the `cards` collection: a pull **without** `collections` carries them only in `cards`. The plugin data routes above still answer the old keys.

The paged pull (`v=2`) answers one page at a time: repeat the request with `page=<next>` alone until `more` is false, then keep `cursor` and send it as `since` next time (`docs/contracts/sync/`). A read token or a token for all workspaces works; a workspace-limited token gets 403 `token_workspace`, as on the old pull.

**A documented break for lexicon collections.** The sync pull no longer carries dictionary data. A script that asks the pull for `entries`, `links`, `senses`, `levelMembers`, `dictionaries`, `schemes` or `levels` (old or paged form) now gets 400 `sync_collection_moved`; a legacy pull without `collections` still has those keys, always empty. Read the catalogue (`GET /api/packages`, any token) and download the language's `lexicon.<lang>` package instead (`GET /api/packages/{id}/{revision}`, resumable with `curl -C -`); it is a zip with a SQLite database and the dictionaries' licence files. A third concurrent download of the same user answers 429 `download_busy` with `Retry-After: 5`: wait and resume.

`events.json` holds `{"events": [...]}` in the shape the app sends, for example
`{"events": [{"id": "01JD0000000000000000000001", "workspaceId": 3, "device": "script", "ts": "2026-11-16T10:00:00Z", "type": "review", "payload": {"cardId": "c-word-12"}}]}`;
event ids are ULIDs and a repeated id is accepted once. Pushing events needs a read and write token.

What a refusal looks like:

```sh
$ curl -sS -H "Authorization: Bearer $QQ_TOKEN" "$QQ/api/auth/me"
{"error":"token_not_allowed","message":"Access tokens cannot be used on this route."}
```

## Errors

| Code | Status | When |
|---|---|---|
| `unauthorized` | 401 | The token is unknown, malformed, expired or revoked, or its owner is disabled (one answer for all) |
| `token_not_allowed` | 403 | The route never takes a token |
| `token_read_only` | 403 | A read-only token on a route that writes |
| `token_workspace` | 403 | A workspace-limited token outside its workspace |
| `password_change_required` | 403 | An administrator set a temporary password for you (your tokens were revoked then anyway) |
| `rate_limited` | 429 | Too many token requests; wait `Retry-After` seconds |

The whole catalogue is [API errors](API-Errors).

## Rate limits

All of your tokens share one budget: 120 requests at once, then one more every half second (120 a minute
sustained). Minting more tokens does not buy more. Creating tokens is limited to 10, then one every 6 minutes.
Your own use of the app is not counted.

## Revoking, and what revokes tokens for you

Revoke one token or all of them in Settings, Account, Access tokens. Your tokens are also revoked, all at once,
when:

- you change your password (also with "Sign out my other sessions" unticked), or use a reset link;
- you log out other devices or everywhere;
- an administrator forces a password change, resets your two-step sign-in, disables your account, signs you out
  or signs everyone out, or the server owner runs `qinqin recover` for you;
- your account is deleted;
- the workspace a token is limited to is deleted (only the tokens limited to it).

Restoring a personal backup does not revoke tokens. The restored workspaces get new ids, and a token limited to a
workspace moves with it; a token limited to a workspace the backup does not contain (one made after the backup) is
revoked. Tokens are never part of a backup.

The administrator's audit log records when a token is created, first used and revoked (never the token, its name
or hint). The list shows when each token was last used (updated at most every 5 minutes).
