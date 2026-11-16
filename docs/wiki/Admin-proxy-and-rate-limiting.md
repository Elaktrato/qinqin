# Reverse proxy, rate limiting and trusted proxies

The app speaks plain HTTP on port 8080. Put a reverse proxy with HTTPS in front: installing the app and studying offline need HTTPS (or `http://localhost`), and browsers may withhold secure-context features over plain HTTP.

## What the proxy must do

- Pass the `Authorization` header.
- **Not cache** `/service-worker.js`, `/manifest.webmanifest` or anything under `/api/`. The server sets `Cache-Control` on static files (`no-cache` for the worker and manifest, `no-store` for `index.html`), but most API responses carry none, so a default proxy cache would serve one user's data to another.
- Allow request bodies of at least 130 MB (pack uploads and restores go up to 128 MiB).
- Allow a read timeout of at least 180 seconds (an AI review can take up to 170 s).
- No WebSocket is used.

Caddy needs only:

```
qinqin.example.com {
    reverse_proxy qinqin:8080
}
```

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 130m;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
}
```

Traefik label examples are in the README ("Reverse proxy and HTTPS"); raise its `respondingTimeouts` if you set them below 180 s.

## Trusted proxies and client addresses

Sign-in and registration are limited per client address, so the server must see the real address. It believes `X-Forwarded-For` only when the TCP peer is a trusted proxy. By default that means private networks (127.0.0.0/8, ::1, 10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16, fc00::/7, fe80::/10). `QINQIN_TRUSTED_PROXIES` replaces that set with a comma list of CIDRs or addresses, or `none` to ignore the header.

**Warning.** The default is spoofable when no proxy exists: any LAN client can send a forged `X-Forwarded-For` and get a fresh per-client limit for every request. Docker port forwarding that masquerades connections can make every client look private. **Set `QINQIN_TRUSTED_PROXIES=none` whenever nothing reverse-proxies to qinqin**, and list your proxy when you run one. The first time a forwarded header is honoured the server logs one line, so you can tell. Addresses are used only as in-memory limiter keys (hashed with a per-process secret): never stored, never logged.

## Sign-in throttling

`POST /api/auth/login` and `/register` hash passwords with argon2id (64 MiB each), so they are limited. The limits live in memory; a restart clears them.

| Layer | Key | Rule |
|---|---|---|
| Client | address (IPv6 per /64) | burst 10, one more every 6 s; every attempt costs one |
| Pair | client and username | 5 failures free, then a lock of 60 s doubling to 15 min; a success clears it and marks the pair known-good for 30 days |
| Username | username, any client | burst 20 failures, one more per minute; a known-good pair is exempt |
| Hash gate | the server | at most min(4, CPUs) hashes at once, 3 s wait, then 503 |

A locked key is refused (429 with `Retry-After`) before the password is checked, and unknown usernames behave exactly like known ones. An administrator creating users is not throttled. A distributed attack can keep an account refused for new devices and networks while it lasts; the owner's usual device keeps signing in. Client contract: `docs/contracts/auth/throttling.md`.

## Other limits worth knowing

AI: 30 calls per user and hour. Exports: six per hour per user. Restore uploads: five per hour. Server backup: one per minute. Mail: 200 per hour for the server. Request body caps per route are in the README ("Request body limits").
