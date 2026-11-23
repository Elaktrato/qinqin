# Reverse proxy, rate limiting and trusted proxies

The app speaks plain HTTP on port 8080. Serve it over HTTPS through a reverse proxy: installing the app and studying offline need HTTPS (or `http://localhost`); over plain HTTP the site works as before, without a service worker ([Install as an app and study offline](Install-and-offline)), and browsers may withhold other secure-context features from other devices.

## What the proxy must do

- Pass the `Authorization` header.
- **Not cache** `/service-worker.js`, `/manifest.webmanifest` or anything under `/api/`. The server sets `Cache-Control` on the static files (`no-cache` for the worker and the manifest, `no-store` for `index.html`, a year for hashed assets), but most API responses carry none, so a proxy that applies a default cache to `/api/` would serve one user's data to another.
- Allow request bodies of at least **130 MB**: pack uploads and personal restores go up to 128 MiB.
- Allow a read timeout of at least **180 seconds**: an AI review can take up to 170 s.
- qinqin closes a connection that takes more than 10 s to send its request headers and a keep-alive connection idle for **125 seconds**. Keep the proxy's idle keep-alive towards qinqin shorter than that (Caddy's default is 2 minutes; nginx `keepalive_timeout` in an `upstream` block defaults to 60 s), so the proxy closes idle connections first.
- No WebSocket is used.

**Caddy** (its defaults are fine: no body limit, no response timeout):

```
qinqin.example.com {
    reverse_proxy qinqin:8080
}
```

**Traefik** labels (the container on the proxy's network; Traefik has no default body limit):

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.qinqin.rule=Host(`qinqin.example.com`)
  - traefik.http.routers.qinqin.entrypoints=websecure
  - traefik.http.routers.qinqin.tls.certresolver=letsencrypt
  - traefik.http.services.qinqin.loadbalancer.server.port=8080
```

Raise the entrypoint's `respondingTimeouts.readTimeout` and `writeTimeout` if you set them below 180 s. Add `networks:` to the stack to join the proxy's network; `docker-compose.yml` does not.

**nginx:**

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 130m;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
    # Optional: stream uploads instead of buffering them to disk first.
    # proxy_request_buffering off;
}
```

## Trusted proxies and client addresses

Sign-in and registration are limited per client address, so the server must see the real address. It believes `X-Forwarded-For` only when the TCP peer is a trusted proxy. By default that means the private networks a Docker or LAN proxy connects from: 127.0.0.0/8, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16, fc00::/7 and fe80::/10. `QINQIN_TRUSTED_PROXIES` replaces that set with a comma list of CIDRs or addresses (for example a CDN's ranges in front of your proxy), or `none` to ignore the header. A bad value stops the server at startup.

> **Warning: the default is spoofable without a proxy.** On an install with **no** reverse proxy any client on your LAN (or any peer the network layer makes look private) can send a forged `X-Forwarded-For` and get a fresh per-client limit for every request. The same happens when the proxy layer rewrites the source address: Docker's userland proxy for IPv6, rootless Docker or Podman, Docker Desktop, or router port forwarding that masquerades connections can all make every client look like a private address. The per-username limit and the hash gate still hold, but **set `QINQIN_TRUSTED_PROXIES=none` whenever nothing reverse-proxies to qinqin**, and list your proxy's address when you run one.

The first time a forwarded header is honoured the server logs one line, `auth: honouring X-Forwarded-For from a trusted proxy; set QINQIN_TRUSTED_PROXIES=none if you have no reverse proxy`, so you can tell. Addresses are used only as in-memory limiter keys (hashed with a per-process secret): never stored, never logged.

## Sign-in throttling

`POST /api/auth/login` and `/register` hash passwords with argon2id (64 MiB each), so they are limited. The limits live in memory; a restart clears them.

| Layer | Key | Rule |
|---|---|---|
| Client | address (IPv6 per /64) | burst 10, one more every 6 s; every attempt costs one |
| Pair | client and username | 5 failures free, then a lock of 60 s doubling to 15 min; a success clears it and marks the pair known-good for 30 days |
| Username | username, any client | burst 20 failures, one more per minute; a known-good pair is exempt |
| Hash gate | the server | at most min(4, CPUs) hashes at once, 3 s wait, then 503 |

Each table holds at most 65,536 keys, and the known-good marks live in their own table, so a flood of new failing keys cannot erase them. A locked key is refused (429 with `Retry-After`) before the password is checked, unknown usernames behave exactly like known ones, and an administrator creating users is not throttled. A distributed attack can keep an account refused for new devices and networks while it lasts; the owner's usual device keeps signing in. Errors of both routes are JSON `{"error", "message"}`: `rate_limited`, `busy`, `bad_credentials`, `registration_closed`, `username_taken`, `bad_request`, `too_large`. Client contract: `docs/contracts/auth/throttling.md`.

## Other limits

All in memory unless noted, per user unless noted.

| What | Limit |
|---|---|
| Wrong passwords where the app re-asks for one (change password, email, two-step changes, delete) | 5 per 15 minutes; a right password gives its attempt back |
| Wrong one-time codes (second step, sign-in by code, setup) | 10 per 15 minutes and 30 a day; an administrator's re-authentication codes have their own budget of the same size |
| Reset-link checks and uses | 10 per client, then one every 30 s |
| Reset requests and sign-in code requests | 5 an hour per identifier, 10 an hour per client |
| Code mails (verification, sign-in, second step) | 5 an hour; reset mails 3 an hour; beyond that silently not sent |
| Mail for the whole server | 200 an hour; test mails 10 an hour |
| Personal export (Download my data) | 6 an hour |
| Restore uploads | 5 an hour |
| Server backup | 1 a minute, one at a time |
| Personal access tokens | 120 requests at once, then one every half second, shared by all of a user's tokens; creating tokens 10, then one every 6 minutes |
| AI provider calls | 30 per rolling hour across all providers, one in flight (stored in the database) |
| Journal photos | 30 uploads an hour, 10 pending; offline reads 60 an hour |
| Data package downloads | 2 at a time (429 `download_busy`, `Retry-After: 5`) |
| Staged pack uploads (admin) | 3 at a time for the server |
| Dictionary lookups and tap segmentation (`GET /api/lookup`, `GET /api/segment/at`, public) | 300 at once per client address, then 20 a second (429 `rate_limited` with `Retry-After`) |
| Text segmentation (`POST /api/segment`) | 6 at a time per user (429 `rate_limited`, `Retry-After: 1`); each request also has a fixed work budget, after which the rest of the text is matched without deinflection |

Request body limits per route are on [API reference](API-Reference#request-body-limits).
