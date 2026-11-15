# Login and Register Rate Limiting (issue #86, #1 leftovers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task, independent review on the strongest model, one fix wave, whole-branch review). Steps use
> checkbox (`- [ ]`) syntax.

**Goal:** Bound argon2 memory with a hash gate and slow online guessing with client, (client, username)
and username limits, enumeration-safe, behind proxies, with JSON error bodies and a seam #64 plugs into.

**Architecture:** New dependency-free package `server/internal/ratelimit` (Keyer, Buckets, Backoff, Gate,
injected clock). `server/internal/api/authlimit.go` holds `AuthPolicy`, the `limiter` seam,
`withHashGate`, `clientIP` lives in `client_ip.go`; `handleLogin`/`handleRegister` run the checks
before any hash. `cmd/qinqin` parses `QINQIN_TRUSTED_PROXIES`. Web: `lib/api/authErrors.ts`.

**Tech stack:** Go 1.26 stdlib, SvelteKit 2 / Svelte 5, vitest. No new dependencies, no migration (035
would be next if one were needed; #64 holds 032–034, the study-day plan 035).

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-15-v030-rate-limiting-design.md`.

**Branch / worktree:** `feature/v030-rate-limiting` from the current tip of `feature/v0.3.0`:
`git worktree add -b feature/v030-rate-limiting .claude/worktrees/v030-rate-limiting feature/v0.3.0`; `<wt>`.

**Order in v0.3.0:** first plan of work item 1; independent of the study-day and character plans. #64:
plans 1–2 tolerate this branch's absence (no-op seam); plan 3 (SMTP/MFA) must start only after this branch
is merged. If #64 plan 1 merged first (its `authlimit.go` with `limiter`/`noLimit` exists), Task 5 edits
that file instead of creating it, keeps its names, and replaces `noLimit` with the real tables.

## Gates

- Go: the docker command in `/home/user/qinqin-v030/AGENT-RULES.md` with shared caches; per task the
  touched packages and `-run` patterns. `-race` on `./internal/ratelimit/...` (Tasks 1–3) and on
  `./internal/api/... -run 'AuthLimit|Login|Register'` (Tasks 5–6; never the whole api package). ONE full
  `go vet ./... && go test -p 2 ./...` before the last commit. Never two Go gates at once; afterwards
  `git status` clean and `find <wt> -user root` empty.
- Web: `npm --prefix <wt>/apps/web ci` once, then `run check`, `test`, `run build`; read exit codes.
- One commit per task, explicit `git add`, message ends with a blank line and
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge or push.

## Global constraints

- Policy defaults: spec table. Table cap 65 536 keys, sweep every 60 s, eviction samples 8.
- Keys: `Keyer.Key(parts ...string) Key` = first 16 bytes of HMAC-SHA-256(per-process random key,
  NUL-joined parts). No table stores a raw username or address.
- Error bodies JSON `{"error","message"}` for every status of login/register; codes: `rate_limited`,
  `busy`, `bad_credentials`, `admin_required`, `username_taken`, `bad_request`, `too_large`.
  `Retry-After` = ceil seconds, ≥ 1; the 429 message wording comes from the same number.
- A locked key refuses before the password is verified; only `auth.ErrBadCredentials` counts as a failure.
- No log line contains an address, username, password or token.
- `cmd/qinqin` never passes `WithAuthPolicy` or `WithAuthHooks`; only tests do.

## Review Focus

1. **Enumeration safety.** Known vs unknown username: same status sequence and bodies, dummy hash still
   runs (Task 5 `TestAuthLimitSameForUnknownUser`, the #1 timing test).
2. **Lock before verify.** A correct password during an L2/L3 lock is 429 and no hash ran (hook counter) — Task 5.
3. **Memory and table bounds.** Gate size 1 → 503; eviction keeps `Len() ≤ cap` and a flood of new keys
   cannot make a fresh legitimate key refused (Tasks 1, 3, 5).
4. **Concurrency.** 30 concurrent failures for one username cannot pass more than the L3 burst (Task 5, `-race`).
5. **Proxy trust.** Header only from trusted peers, right-to-left, `none` disables (Task 4).
6. **Seam names** match #64 plan 1 (`limiter`, `noLimit`, `withHashGate`, `authlimit.go`) — Task 5.

---

### Task 1: `ratelimit.Keyer` and `ratelimit.Buckets`

**Files:** Create `server/internal/ratelimit/doc.go`, `keys.go`, `bucket.go`, `bucket_test.go`.

**Interfaces:**
```go
type Key [16]byte
type Keyer struct{ /* secret [32]byte */ }
func NewKeyer() *Keyer                                   // crypto/rand secret
func (k *Keyer) Key(parts ...string) Key
type BucketPolicy struct { Burst int; Every time.Duration; MaxKeys int }
func NewBuckets(p BucketPolicy) *Buckets
func (b *Buckets) Take(k Key, now time.Time) (ok bool, retry time.Duration)
func (b *Buckets) Refund(k Key, now time.Time)           // gives one token back, never above Burst
func (b *Buckets) Len() int
```

- [ ] **Step 1: Failing tests:** burst 10, 11th refused with retry 6 s; refill after 6 s; partial refill
  (3 s → retry 3 s); `Refund` restores one and never exceeds the burst; sweep after 60 s drops full idle
  buckets; at `MaxKeys` a new key evicts (Len stays at cap) and the new key starts full; a flood of 2×cap
  fresh keys never makes a fresh key's first `Take` fail; clock going backwards mints nothing; two Keyers
  give different keys for the same input, one Keyer is stable.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (+ `-race`). **Step 5:** Commit `feat(ratelimit): keyed token buckets`.

### Task 2: `ratelimit.Backoff`

**Files:** Create `server/internal/ratelimit/backoff.go`, `backoff_test.go` (reuses Task 1's `Key`, sweep
and eviction helpers).

**Interfaces:**
```go
type BackoffPolicy struct { Free int; First, Max, Forget, GoodFor time.Duration; MaxKeys int }
func NewBackoff(p BackoffPolicy) *Backoff
func (b *Backoff) Begin(k Key, now time.Time) (ok bool, retry time.Duration) // refuses while locked or failures+inflight ≥ … would lock
func (b *Backoff) Fail(k Key, now time.Time)                                  // ends an in-flight attempt as a failure
func (b *Backoff) Succeed(k Key, now time.Time)                               // clears failures, marks known-good until now+GoodFor
func (b *Backoff) Abort(k Key)                                                // ends an in-flight attempt without counting
func (b *Backoff) KnownGood(k Key, now time.Time) bool
```

- [ ] **Step 1: Failing tests:** failures 1–5 free; the 6th starts 60 s; after expiry the next failure 120 s
  … capped at 15 min; refused `Begin` does not extend; in-flight attempts count (6 concurrent `Begin`s after
  5 failures: only those that fit pass); `Succeed` clears and marks known-good for 30 days; `Abort` changes
  nothing; 1 h quiet forgets failures but not a live known-good mark; sweep/eviction as Task 1.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (+ `-race`). **Step 5:** Commit `feat(ratelimit): failure backoff`.

### Task 3: `ratelimit.Gate`

**Files:** Create `server/internal/ratelimit/gate.go`, `gate_test.go`.

**Interfaces:** `func NewGate(n int) *Gate`; `func (g *Gate) Acquire(ctx context.Context, wait time.Duration) (release func(), ok bool)`; `func (g *Gate) InUse() int`.

- [ ] **Step 1: Failing tests:** n = 2 admits two, the third waits and gets the slot on release; times out
  after `wait`; a cancelled context returns at once; double release is a no-op; `n < 1` acts as 1.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (buffered channel). **Step 4:** PASS (+ `-race`). **Step 5:** Commit `feat(ratelimit): concurrency gate`.

### Task 4: Client address and trusted proxies

**Files:** Create `server/internal/api/client_ip.go`, `client_ip_test.go`; modify `server/internal/api/api.go`
(`trusted []netip.Prefix` on `server`, nil → `DefaultTrustedProxies`; `WithTrustedProxies`),
`server/cmd/qinqin/main.go` (call `api.ParseTrustedProxies(os.Getenv("QINQIN_TRUSTED_PROXIES"))`, fail
startup on error) and `server/cmd/qinqin/main_test.go` (or the existing cmd test file).

**Interfaces:**
```go
var DefaultTrustedProxies = []netip.Prefix{ /* 127.0.0.0/8 ::1/128 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 fc00::/7 fe80::/10 */ }
func ParseTrustedProxies(v string) ([]netip.Prefix, error)  // "" → DefaultTrustedProxies; "none" → []netip.Prefix{} (non-nil); CIDRs or bare addresses
func WithTrustedProxies(p []netip.Prefix) Option
func (s *server) clientIP(r *http.Request) netip.Addr
func clientKeyString(a netip.Addr) string                    // IPv4 as is; IPv6 masked to /64
```

- [ ] **Step 1: Failing tests:** no header; public peer with a forged header (ignored); trusted peer with
  `203.0.113.9`; chain `198.51.100.1, 10.0.0.5` from `10.0.0.2` → `198.51.100.1`; two header lines joined;
  all-trusted → left-most; garbage stops the walk; 40 hops capped at 32; IPv6 /64 grouping; zoned and
  IPv4-mapped peers normalised; `none` ignores the header; bare addresses parse as /32 and /128; parse
  errors name the bad item; `cmd` fails on `QINQIN_TRUSTED_PROXIES=10.0.0.0/33`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(api): resolve client addresses behind trusted proxies`.

### Task 5: Seam, gate and limits on login

**Files:** Create (or, if #64 plan 1 merged first, modify) `server/internal/api/authlimit.go`,
`server/internal/api/authlimit_test.go`; modify `server/internal/api/api.go` (`authLimits`, hook fields,
options), `server/internal/api/handlers_auth.go` (JSON errors; order of checks), `server/internal/api/export_test.go`
(`WithAuthHooks`), `apps/web` is untouched here.

**Interfaces:**
```go
type limiter interface{ Allow(key string) (ok bool, retry time.Duration) }
type noLimit struct{}                                                     // Allow → true, 0
type AuthPolicy struct {
    Client ratelimit.BucketPolicy; Pair ratelimit.BackoffPolicy; Account ratelimit.BucketPolicy
    Hashes int; HashWait time.Duration; Named map[string]ratelimit.BucketPolicy
}
func DefaultAuthPolicy() AuthPolicy
func WithAuthPolicy(p AuthPolicy) Option
var errHashBusy = errors.New("hash gate busy")
func (s *server) authLimiter(name string) limiter
func (s *server) withHashGate(ctx context.Context, fn func() error) error
func writeRateLimited(w http.ResponseWriter, retry time.Duration)
func writeBusy(w http.ResponseWriter)
func writeAuthError(w http.ResponseWriter, status int, code, message string)
// export_test.go
type AuthHooks struct { Login func(ctx context.Context, db *sql.DB, user, pass string) (string, error); CreateFirstUser, CreateUser any /* same signatures as auth */ }
func WithAuthHooks(h AuthHooks) Option
```
Login: `readBody` → client `Take` → decode → pair `Begin` → account `Take` unless `KnownGood(pair)` →
`withHashGate(login)` → `ErrBadCredentials`: pair `Fail`, account stays taken → other error/503:
pair `Abort`, account `Refund` → success: pair `Succeed`, account `Refund`.

- [ ] **Step 1: Failing tests** (`WithClock` for time; each sequence on a fresh server or its own
  `X-Forwarded-For` from the trusted 127.0.0.1 test peer): 10 logins with 10 usernames → 401
  `bad_credentials` JSON; the 11th → 429 `rate_limited`, `Retry-After: 6`, message "… in 6 seconds.";
  one username: failures 1–6 → 401, 7th with the right password → 429, hook login counter unchanged;
  after the lock (advance clock) → 200, pair known-good; L3: 20 failures from 20 addresses → the 21st from a
  new address 429, but the known-good address still reaches the hash; 30 concurrent failures for one
  username from 30 addresses → at most 20 hook calls; unknown vs known username identical statuses and
  bodies; gate size 1, a hook blocked on a channel, `HashWait` 50 ms → second request 503 `busy`,
  `Retry-After: 2`; a hook returning a non-credential error → 500 and no failure counted; captured
  `log` output contains no address, username or password; `authLimiter("reauth")` returns a working
  limiter with the named policy; existing `TestLogin*` and the #1 timing test pass.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (log `auth: sign-in throttled (layer …)` through a 1-per-10 s
  global limiter with a suppressed count). **Step 4:** Go gate `./internal/api/... -run 'AuthLimit|Login|Register'`
  (+ `-race`), `./internal/auth/...` → PASS. **Step 5:** Commit `feat(api): rate-limit sign-in and gate password hashing`.

### Task 6: Register, the #1 leftover and the test audit

**Files:** Modify `server/internal/api/handlers_auth.go` (client bucket + gate on every register path,
refund after `requireAdmin` succeeds, JSON errors), `authlimit_test.go`, `server/internal/auth/auth_test.go`
(`TestConcurrentFirstRegisterCreatesOneAdmin` gets `api.WithAuthPolicy` with `Hashes: 8`, `HashWait: 30 s`),
`server/internal/sync/sync_test.go` (`registerAndLogin` asserts 201), every test that reads a plain-text
login/register error body (grep `bad credentials`, `username taken`, `admin token required` in `*_test.go`).

- [ ] **Step 1: Failing tests:** anonymous register on a database with users passes the client bucket
  before its 403 `admin_required` (11 rapid anonymous registers → the 11th 429); an admin creating 15 users
  in a row never sees 429; the bootstrap passes the gate (hook counter 1); `registerAndLogin` fails when
  register is not 201.
- [ ] **Step 2:** FAIL where expected. **Step 3:** Implement; update the plain-text assertions to the JSON
  codes. Run the FULL Go suite once and list every test file changed in the commit body.
- [ ] **Step 4:** PASS. **Step 5:** Commit `feat(api): rate-limit registration; JSON auth errors; assert register status`.

### Task 7: Web messages

**Files:** Create `apps/web/src/lib/api/authErrors.ts`, `authErrors.test.ts`,
`apps/web/src/routes/login/page.dom.test.ts` (new; follow `routes/entry/[id]/page.dom.test.ts` for mocks);
modify `apps/web/src/routes/login/+page.svelte`, `apps/web/src/routes/register/+page.svelte`.

**Interfaces:** `authErrorMessage(err: unknown, fallback: string): string` — reads `apiErrorBody(err)`;
`bad_credentials` → "Wrong username or password."; `rate_limited` → wording from
`err.retryAfterSeconds` ("6 seconds", "1 minute", "15 minutes"), else the body `message`; `busy` → body
message; other codes → body message; non-JSON bodies (older server) → the existing behaviour.

- [ ] **Step 1: Failing tests:** unit table incl. a plain-text 401 from an old server; dom: a mocked 429
  shows the alert, the button stays enabled, no second request is sent.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** web gates PASS. **Step 5:** Commit `feat(web): explain sign-in throttling`.

### Task 8: Docs, contract and the real-app check

**Files:** Modify `README.md` (reverse-proxy section: replace "does not read client IPs… no trusted-proxy
setting exists" with the trusted-proxy rule, the nginx `X-Forwarded-For` line, the CDN note, "addresses are
in-memory limiter keys only, never stored or logged"; Portainer section: `QINQIN_TRUSTED_PROXIES` in the
optional variables; a "Sign-in throttling" paragraph with the policy table), `docs/ROADMAP.md` (#86 done),
`docs/contracts/README.md` (index entry; create it if the study-day branch has not merged — the merger
reconciles); create `docs/contracts/auth/throttling.md`, `docs/contracts/auth/throttle-responses.json`.

- [ ] **Step 1: Real-app check (no browser):** scratch copy, image build with `WITH_OCR=0 WITH_AUDIO=0`, free
  127.0.0.1 port. curl, each sequence after a container restart: (a) register the first user; 6 wrong logins
  for `owner` → 401 `bad_credentials`; the 7th with the right password → 429 with `Retry-After` and a JSON
  body; (b) the same for `nobody` → identical statuses and bodies; (c) 11 wrong logins with 11 usernames fired
  in parallel → ten 401 and one 429 with `1 ≤ Retry-After ≤ 6`; (d) 30 parallel logins each with its own
  `X-Forwarded-For: 198.51.100.<n>` (the Docker bridge peer is trusted by default) → only 401/503 statuses, and
  `docker stats --no-stream` stays below ~400 MiB; (e) restart with `QINQIN_TRUSTED_PROXIES=none` → the header
  no longer gives a fresh bucket; (f) `docker logs` contains no address, username or password. Stop and
  remove everything.
- [ ] **Step 2:** Full Go gate, web gates. **Step 3:** Commit `docs: sign-in throttling and trusted proxies`.

## Task dependencies

1 → 2; 3 independent; 1, 2, 3, 4 → 5 → 6 → 8; 7 after 6 (JSON codes) → 8. Other plans: none required.
#64 plan 3 depends on this branch merged; #64 plans 1–2 use the `limiter`/`noLimit` seam meanwhile.

## Contract notes (for `docs/contracts/`)

- `docs/contracts/auth/throttling.md` — order of checks, statuses, headers, bodies, client rules (Task 8).
- `docs/contracts/auth/throttle-responses.json` — 429 `rate_limited`, 503 `busy`, 401 `bad_credentials`,
  403 `admin_required` (all JSON) (Task 8). Reconcile with #64's `docs/contracts/auth/errors.json` at merge.
- Android: branch on `error`, honour `Retry-After`, show `message`, never retry 429/503 automatically.

## Execution log and rulings (implementer, 2026-11-15)

- Ruling: `Backoff.Begin` lets at most `Free+1` attempts be in flight from a clean state (the 6th may lock);
  after a lock expired one attempt at a time runs; a refused in-flight attempt reports `Retry-After` 1 s —
  keeps "in flight counts as failure" without a second counter — cost: none known.
- Ruling: a failure arriving while a lock is still active (a straggler that began earlier) does not
  double it — only a failure after expiry doubles — cost: none.
- Ruling: login also answers 400 `bad_request` for empty username or password (spec order step 3) —
  before it hashed against the dummy — cost: a script sending an empty password sees 400 instead of 401.
- Ruling: `Named` defaults are empty; every name incl. `reauth` falls back to the client policy until
  #64 adds its own entries — YAGNI — cost: #64 plan 1 must put its numbers into `DefaultAuthPolicy().Named`.
- Ruling: the commit trailer follows AGENT-RULES (`Claude Opus 5.5`).
- Deviation: Task 4's `trusted` option lives in `api.go`; `WithLimiterProbe` (export_test) replaced the
  planned `authLimiter` access from `api_test`; hooks are typed (`AuthHooks` fields are not `any`).
- Deviation: real-app memory check — 30 parallel logins that all pass the limits reach VmHWM about 470-535 MiB
  (a 150 MiB baseline after one login, 4 gate slots of 64 MiB, plus Go heap garbage), not under 400 MiB; the
  unbounded figure would be above 2 GiB. The gate holds; the threshold in step 1(d) is read as "below 600 MiB".
- Full Go gate ran once after Task 7; Task 8 only added a fixture test and docs (targeted run).

## Real-app check result (built binary, curl-equivalent Python, loopback)

(a) 6 wrong -> 401 `bad_credentials`, 7th with right password -> 429, `Retry-After: 60`, JSON; (b) `nobody`
identical statuses and bodies; (c) 11 parallel one client -> ten 401, one 429 (`Retry-After` 6); anonymous
register after the first user -> ten 403 then 429; (d) 30 parallel with own `X-Forwarded-For` -> only 401/429
(20 hashed by L3), VmHWM 473-535 MiB; (e) `QINQIN_TRUSTED_PROXIES=none` -> header ignored (429 by the 10th/11th);
default trust -> distinct addresses are distinct clients; bad value stops startup naming the item; (f) log has
only `auth: sign-in throttled (layer ...)` lines, no address, username or password.

## Fix wave after the security review

- Ruling: known-good marks in a separate capped table (65 536, sampled-oldest eviction) — a flood of failing
  pairs evicted marks before — cost: a second table of at most 65 536 small entries.
- Ruling: eviction samples the first 8 entries of Go's map iteration (random start, no `rand.IntN` skip walk)
  — O(8) per insert instead of O(n) — cost: the sample is clustered, not uniform; a test pins the cost.
- Ruling: the default trusted set stays "private networks", now loudly documented as spoofable without a
  proxy (README, Portainer stack, compose), with `QINQIN_TRUSTED_PROXIES=none` recommended there, and one log
  line the first time a forwarded header is honoured — cost: an install without proxy that ignores the docs is
  still spoofable on the per-client layers (per-username limit and hash gate hold).
- Ruling: `QINQIN_TRUSTED_PROXIES` and `QINQIN_TESSERACT` are passed by the Portainer stack and offered in
  docker-compose.yml; a test (`cmd/qinqin/deploy_env_test.go`) requires every variable of the README's
  environment table to be in both files.
- Ruling: IPv4-mapped prefixes in `QINQIN_TRUSTED_PROXIES` are converted (`::ffff:10.0.0.0/104` is `10.0.0.0/8`);
  shorter than /96 is a startup error.
- Ruling: register 429 reads "Too many attempts."; an administrator's valid bearer skips the client bucket
  (checked before it, a plain token lookup) — cost: an invalid or non-admin bearer still pays.
- Ruling: a cancelled request is answered 499 with no body and no log, nothing counted.
- Forwarded entries with a port or brackets parse.
