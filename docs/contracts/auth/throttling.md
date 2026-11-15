# Sign-in throttling (contract)

Applies to `POST /api/auth/login` and `POST /api/auth/register`. Examples:
`throttle-responses.json`. Reconcile with `errors.json` of the accounts work when both exist.

## Order of checks
1. Read the body (cap 4 KiB; larger: 413 `too_large`, free).
2. Client bucket (address; IPv6 per /64): burst 10, one token per 6 s. Exhausted: 429.
3. Decode (malformed or empty fields: 400 `bad_request`; the client token stays spent).
4. Login only: (client, username) failure backoff, then username bucket (burst 20, one per minute;
   skipped for a pair that signed in successfully within 30 days). Exhausted or locked: 429, **before the
   password is checked**, even when it is right.
5. Hash gate (min(4, CPUs) at once, 3 s wait): none free: 503 `busy`.
6. Password check. Only a credential mismatch is a failure (401 `bad_credentials`); a 500 or 503 counts for nothing.

Register: every call passes 2 and 5; an administrator whose token checks out gets the client token back.
Closed registration for others: 403 `admin_required`; duplicate: 409 `username_taken`.

## Statuses and bodies
Every error is JSON `{"error": "<code>", "message": "<English sentence>"}`, `Content-Type: application/json`.
Codes: `rate_limited` (429), `busy` (503), `bad_credentials` (401), `admin_required` (403),
`username_taken` (409), `bad_request` (400), `too_large` (413), `internal` (500).
429 and 503 carry `Retry-After: <whole seconds, at least 1>` (503 always 2). The 429 message is worded from the
same number: under 60 s "N second(s)", else whole minutes rounded up. Unknown and known usernames get identical
statuses, bodies and headers.

## Client rules
- Branch on `error`, show `message` (or word the wait yourself from `Retry-After`).
- Never retry a 429 or 503 automatically; let the person try again.
- 401 `bad_credentials` here is the anonymous sign-in step, not "session gone".
- The server sees the client address through `X-Forwarded-For` of a trusted proxy only; clients send nothing special.
