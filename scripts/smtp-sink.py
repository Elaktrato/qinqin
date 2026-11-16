#!/usr/bin/env python3
"""A tiny SMTP sink to try qinqin's email features without a provider.

It accepts mail on a plain (no TLS, no login) port, writes every message to
<dir>/<n>.eml and prints one line per message with the subject only. Nothing
is ever forwarded. Use it with Email -> connection security "None" and no user
name. Python standard library only.

    python3 scripts/smtp-sink.py --port 2525 --dir ./mail
"""
import argparse
import os
import socketserver
import sys
from email import message_from_bytes, policy


class Handler(socketserver.StreamRequestHandler):
    def reply(self, text):
        self.wfile.write((text + "\r\n").encode())

    def handle(self):
        self.reply("220 qinqin smtp sink")
        while True:
            line = self.rfile.readline(4096)
            if not line:
                return
            cmd = line.decode("latin-1").strip().upper()
            if cmd.startswith(("EHLO", "HELO")):
                self.reply("250-sink")
                self.reply("250 8BITMIME")
            elif cmd.startswith(("MAIL FROM", "RCPT TO", "RSET", "NOOP")):
                self.reply("250 ok")
            elif cmd == "DATA":
                self.reply("354 end with <CRLF>.<CRLF>")
                data = []
                while True:
                    l = self.rfile.readline(1 << 20)
                    if not l or l in (b".\r\n", b".\n"):
                        break
                    data.append(l[1:] if l.startswith(b"..") else l)
                self.server.store(b"".join(data))
                self.reply("250 queued")
            elif cmd == "QUIT":
                self.reply("221 bye")
                return
            else:
                self.reply("500 unknown command")


class Sink(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, addr, outdir):
        super().__init__(addr, Handler)
        self.outdir = outdir
        self.n = len([f for f in os.listdir(outdir) if f.endswith(".eml")])

    def store(self, raw):
        self.n += 1
        with open(os.path.join(self.outdir, f"{self.n}.eml"), "wb") as f:
            f.write(raw)
        subject = message_from_bytes(raw, policy=policy.default)["Subject"]
        print(f"mail {self.n}: {subject}", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=2525)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--dir", default="./mail")
    a = ap.parse_args()
    os.makedirs(a.dir, exist_ok=True)
    with Sink((a.host, a.port), a.dir) as s:
        print(f"listening on {a.host}:{a.port}, writing to {a.dir}", flush=True)
        try:
            s.serve_forever()
        except KeyboardInterrupt:
            sys.exit(0)


if __name__ == "__main__":
    main()
