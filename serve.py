#!/usr/bin/env python
"""Serve app/ for a human:  python serve.py [port]   ->  http://localhost:8765/

Standard library only. This file exists because Windows' registry can map .js to text/plain,
which makes Python's stock http.server serve ES modules with the wrong Content-Type and makes
Chromium refuse to run them. The types the page needs are pinned here.

It listens on both loopback addresses (127.0.0.1 and ::1) because `localhost` resolves to the
IPv6 address first on Windows, and a server bound to IPv4 only makes every request wait for the
IPv6 attempt to fail.

The verification gate (verify/smoke_test.py) starts its own server and neither requires nor
uses this file.
"""
import socket
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "app"
DEFAULT_PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".htm": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".ico": "image/x-icon",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")  # edits show up on a plain reload
        super().end_headers()


class Server4(ThreadingHTTPServer):
    # Report a port collision instead of silently sharing the port (Windows allows that
    # when allow_reuse_address is left on, which is http.server's default).
    allow_reuse_address = False
    daemon_threads = True


class Server6(Server4):
    address_family = socket.AF_INET6


def main(argv: list[str]) -> int:
    try:
        port = int(argv[1]) if len(argv) > 1 else DEFAULT_PORT
    except ValueError:
        print(f"usage: python serve.py [port]   (got {argv[1]!r})", file=sys.stderr)
        return 2
    if not (ROOT / "index.html").is_file():
        print(f"app/index.html not found under {ROOT}", file=sys.stderr)
        return 1
    handler = partial(Handler, directory=str(ROOT))
    try:
        main_server = Server4(("127.0.0.1", port), handler)
    except OSError as e:
        print(f"cannot listen on port {port} ({e.strerror}). Pass another port: python serve.py {port + 1}",
              file=sys.stderr)
        return 1
    extra = []
    if socket.has_ipv6:
        try:
            extra.append(Server6(("::1", port), handler))
        except OSError:
            pass  # no IPv6 loopback here; browsers fall back to 127.0.0.1 on their own
    for srv in extra:
        threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.5}, daemon=True).start()
    print(f"Samaa Explorer: http://localhost:{port}/   (also http://127.0.0.1:{port}/)")
    print(f"serving {ROOT}  -  Ctrl+C to stop")
    try:
        main_server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        for srv in extra:
            srv.shutdown()
            srv.server_close()
        main_server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
