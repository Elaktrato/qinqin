# Login and register rate limiting — design (issue #86, #1 leftovers)

Status: Draft for review (2026-11-15), v0.3.0 work item 1. Written unattended; every non-obvious call
is a **Ruling** (`what — why — cost if wrong`). Nothing is built. Revised after a builder check and the
orchestrator's rulings for the accounts work (#64, `docs/v030-accounts`,
`2026-11-15-v030-accounts-design.md` "Shared conventions"): JSON error bodies on every auth route,
anonymous registration possible, client IPs in memory only, an explicit limiter seam.

## Intent and why

`POST /api/auth/login` runs one argon2id hash (64 MiB, t = 3, p = 4) per attempt, also for unknown
users since #1 (dummy hash for equal timing). Nothing limits attempts, so a flood of concurrent logins
is a memory and CPU denial of service (100 parallel attempts ≈ 6.4 GiB) and passwords can be guessed at
full speed. `POST /api/auth/register` hashes too, and with #64's invite/open modes anonymous callers
reach the hash. The issue asks for per-IP and per-username throttling, a global cap on concurrent
hashes, tests, and kept timing equalisation.

## Goals

- Bounded memory: never more than N argon2 runs at once per server, whatever the request rate.
- Online guessing slowed per username and per client, with responses that do not reveal whether a
  username exists.
- Correct client keys behind the reverse proxies the README documents (Caddy, Traefik, nginx, Portainer
  stacks), with addresses kept in memory only — never stored, never logged.
- A reusable in-memory limiter and hash gate with a named seam that #64's routes plug into.
- The #1 leftover: test setups that discard the register status (`registerAndLogin` in
  `server/internal/sync/sync_test.go`; #64 plan 1 fixes the `auth_test.go` helpers) assert 201.

## Non-goals

- Persistent lockouts across restarts, CAPTCHAs, admin unlock UI, notifications (a restart clears every
  limit; acceptable for a single-instance server). Rate limits on other routes. Multi-instance
  coordination. No migration (if one were ever needed it would take 036; #64 holds 032–034, the study day 035).

## Approaches

1. **In-memory layered limiter in the API server (CHOSEN):** a client token bucket, a per-(client,
   username) failure backoff, a per-username failure bucket, and a hash gate. Cheap, testable with an
   injected clock, no schema.
2. **Lockout columns in `users`:** survives restarts, but only covers existing users (enumeration leak
   or dummy rows), costs a write per failure and does nothing for the memory flood. Rejected.
3. **Leave it to the reverse proxy:** not every install configures one, and the proxy cannot see
   usernames. Rejected (documented as an extra layer).

## Policy

Order for `POST /api/auth/login` and `POST /api/auth/register` (authenticated admin or anonymous): read
the body (oversize → 413, free: it is capped at 4 KiB and never hashed) → **L1 Take** → decode (malformed
JSON, empty fields → 400, the L1 token stays spent) → L2/L3 (login only) → L4 → hash.

| Layer | Key | Rule | When exhausted |
|---|---|---|---|
| L1 client | client address (IPv4 /32, IPv6 /64) | token bucket, burst 10, refill 1 per 6 s, every attempt costs 1 | 429 |
| L2 pair | (client, username) | 5 consecutive failures free; the 6th starts a 60 s lock, each further failure after a lock doubles it up to 15 min; attempts in flight count as failures until they end; a success clears it and marks the pair **known-good** for 30 days; forgotten after 1 h quiet (known-good marks after 30 days) | 429 |
| L3 username | username, any client | failure bucket, burst 20, refill 1 per 60 s; a token is taken up front and refunded on success; known-good pairs are exempt | 429 |
| L4 hash gate | one per `api.New` server (`cmd/qinqin` builds one) | at most `min(4, max(1, GOMAXPROCS))` argon2 runs at once; wait at most 3 s | 503 |

- L3 keys unknown usernames exactly like known ones. A locked pair or username is refused **before** the
  password is checked, even when it is right. A refused attempt never extends a lock.
- Only a credential mismatch (`auth.ErrBadCredentials`) is a failure. A 503, a cancelled request or a 500
  ends the attempt without counting (L2 in-flight released, L3 refunded).
- Register: anonymous and admin calls pass L1 and L4; an admin whose token checks out gets the L1 token
  refunded (bulk user creation is not throttled). #64's invite/open paths reach the hash only through
  L1 + L4.
- Keys: usernames and client addresses are keyed by HMAC-SHA-256 with a random per-process key,
  truncated to 16 bytes, so the tables hold neither usernames nor addresses and a memory dump cannot be
  reversed by dictionary; a 4 KiB username costs 16 bytes.
- Known-good marks live in their own table (cap 65 536, sampled-oldest eviction), so a flood of new failing
  keys cannot erase them; creating a mark needs a correct password. Register: an administrator's bearer token
  is checked first and skips L1 entirely (parallel bulk creation is never refused); everyone else pays one
  L1 token, and the 429 reads "Too many attempts." (login: "Too many sign-in attempts."). A request whose
  client went away is dropped with 499, no body, no log, nothing counted.
- Every table holds at most 65 536 keys; a sweep every minute drops idle entries (full bucket, no lock,
  no failure in the last hour, no live known-good mark). A full table **evicts** the least recently
  touched of the first 8 entries of Go's randomised map iteration for each new key (constant cost).

Ruling: burst 10 / one per 6 s per client — a person mistyping a password never notices, a script gets
10 tries a minute — cost: a classroom behind one IPv4 NAT signing in at once may see a short 429.

Ruling: per-username failure bucket with a known-good-pair exemption instead of a hard lockout — a
distributed attacker gets about one guess a minute per account, the owner's usual device and network
keep signing in — cost: an attacker taking every refilled token (about 15 addresses, or one IPv6 /56)
keeps the account refused for **new** devices and networks while the attack lasts.

Ruling: evict instead of sharing an overflow entry — a shared entry lets 65 536 cheap keys (an IPv6 /48,
or spoofed headers from a trusted peer) drain one bucket for every newcomer — cost: under such a flood an
evicted attacker key starts fresh; L3 and L4 still bound guessing and memory.

Ruling: hash gate of up to 4 runs (≈ 256 MiB) with a 3 s wait, then 503 — bounds memory on 1–4 GB
machines — cost: under a flood real users wait up to 3 s or retry after a 503.

## Responses (contract)

Per the accounts shared rule, every error of these routes is JSON `{"error":"<code>","message":"<text>"}`
(`Content-Type: application/json`); the web client branches on `error`, shows `message`.

- 429 `rate_limited`, header `Retry-After: <whole seconds ≥ 1>`, message worded from the same rounded-up
  seconds: "Too many sign-in attempts. Try again in 6 seconds." / "… in 1 minute." / "… in 15 minutes."
  Every layer uses this code and shape; the value can hint at the layer, which reveals nothing about the
  username.
- 503 `busy`, `Retry-After: 2`, "The server is busy. Try again in a moment."
- Login bad credentials: 401 `bad_credentials` (anonymous step; "401 = session gone" applies to signed-in
  routes), dummy-hash timing kept. Register: 403 `registration_closed` (closed mode; #64 renamed it per mode),
  409 `username_taken`, 400 `bad_request`, 413 `too_large`. Codes shared with `docs/contracts/auth/errors.json`
  (#64); whichever branch merges second reconciles the two fixture files.

## Client address

`clientIP(r)`: the peer from `RemoteAddr`; if the peer is a trusted proxy, walk `X-Forwarded-For` (all
header lines, `r.Header.Values`) from the right, at most 32 hops, and take the first address that is not
a trusted proxy (all hops trusted → the left-most). A malformed entry stops the walk at the last good
address. Addresses are unmapped and stripped of zones before matching. Default trusted set (no option
passed): 127/8, ::1, RFC 1918, 100.64/10, 169.254/16, fc00::/7, fe80::/10 — the networks a Docker or LAN
proxy connects from. `QINQIN_TRUSTED_PROXIES` overrides it: a comma list of CIDRs or bare addresses (/32,
/128), or `none` (an empty, non-nil set: the header is ignored). `api.ParseTrustedProxies` parses it;
`cmd/qinqin` calls it once and passes `api.WithTrustedProxies`; a bad value fails startup naming the item.
README (reverse-proxy and Portainer sections): the nginx example adds `proxy_set_header X-Forwarded-For
$proxy_add_x_forwarded_for;`; a CDN in front needs its ranges in `QINQIN_TRUSTED_PROXIES`; addresses are
used only as in-memory limiter keys.

Ruling: trust private-network peers by default — the documented deployments put the proxy on a private
Docker network, and without trust every user would share the proxy's bucket — cost: a LAN attacker
connecting directly can spoof the header to dodge L1/L2 (L3 and L4 hold); set `none` on a LAN without proxy.

## Code shape and the seam for #64

- `server/internal/ratelimit` (new, no dependencies): `Keyer` (per-process HMAC), `Buckets` (`Take`,
  `Refund`), `Backoff` (`Begin`, `Fail`, `Succeed`, `Abort`, `KnownGood`), `Gate` (`Acquire(ctx, wait)
  (release func(), ok bool)`), all with an injected clock, sweeping and sampled eviction.
- `server/internal/api/authlimit.go` (the file name #64 plan 1 uses) defines the seam:
  ```go
  type limiter interface{ Allow(key string) (ok bool, retry time.Duration) }   // as in #64 plan 1
  type noLimit struct{}                                                        // #64's no-op default
  func (s *server) authLimiter(name string) limiter      // named bucket tables: "login-client", plus #64's "reauth", "ident", "reset-mail", "smtp-test"
  func (s *server) withHashGate(ctx context.Context, fn func() error) error   // errHashBusy when the gate times out
  func writeRateLimited(w http.ResponseWriter, retry time.Duration); func writeBusy(w http.ResponseWriter)
  ```
  `authLimiter` returns a `ratelimit.Buckets` adapter (key hashed by the `Keyer`, clock `s.now`) with
  the named policy from `AuthPolicy.Named`; unknown names get the login-client policy. Login's L2/L3 use
  the richer `Backoff`/`Buckets` API directly. If #64 plan 1 merged first, this branch replaces its
  `noLimit` wiring; otherwise #64 uses these names as they are.
- `AuthPolicy` holds every number above; `WithAuthPolicy` (tests only). Hashing goes through server
  fields `login`, `createFirstUser`, `createUser` (default the `auth` functions), swappable through
  `WithAuthHooks` in `internal/api/export_test.go`, so API tests can block or count hashes.
- Logging: one line when a key starts being refused, with **no address, username, password or token**:
  `auth: sign-in throttled (layer client|pair|account)`; a global log limiter allows one line per 10 s
  with the number suppressed. 500 paths stay unlogged as today.
- Web: `lib/api/authErrors.ts` maps codes and `ApiError.retryAfterSeconds` to the same wording; login
  and register pages use it; the button stays enabled; no automatic retry.

## Testing

Unit: bucket refill/burst, refund, backoff doubling/cap, in-flight counting, forgetting, known-good,
sweep, eviction at the cap, gate timeout/cancel, `clientIP` table. API (each sequence on its own server or
its own `X-Forwarded-For` from the trusted test peer; clock via `WithClock`): the 11th attempt of one
client → 429; 6 failures then the right password → 429, no hash ran; lock expiry → 200 and known-good;
L3 across clients; known-good pair exempt from L3; concurrent failures cannot exceed L2/L3; unknown vs
known username identical; register anonymous and admin (refund); gate size 1 with a blocked hook → 503;
#1 timing test still passes; captured logs contain no address, username or password. The builder check
found no existing test above 10 auth requests per server; `TestConcurrentFirstRegisterCreatesOneAdmin`
(8 racers hashing) gets an explicit `WithAuthPolicy` with a larger gate and wait.

## Contract fixtures (`docs/contracts/auth/`)

- `throttling.md` — order, statuses, headers, bodies, client rules (show `message`, honour `Retry-After`,
  never retry automatically on 429/503).
- `throttle-responses.json` — 429, 503, 401 `bad_credentials`, 403 `registration_closed` examples (JSON).

## Risks

- Shared-NAT IPv4 users hitting L1: mitigated by the burst.
- Two error-code fixtures (#64's `errors.json`, this `throttle-responses.json`) until reconciled at merge.
