#!/usr/bin/env python3
"""Serve the Creator web build and forward /loginapi/* to the login HTTP service, so the page needs no CORS.

Also serves /cdn/* from a release folder (2DRoundAssets/build/<version>), the stand-in for the real CDN: files named by content hash are
immutable, so they get a long cache lifetime; the manifest does not.

  python3 mini/serve.py <host> <port> [login-base] [cdn-root]     (login-base defaults to http://127.0.0.1:8081)
"""
import http.server
import mimetypes
import os
import sys
import urllib.request

HOST, PORT = sys.argv[1], int(sys.argv[2])
LOGIN = (sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8081").rstrip("/")
CDN = os.path.abspath(sys.argv[4]) if len(sys.argv) > 4 else None
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build/web-mobile")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def cdn(self):
        rel = self.path[len("/cdn/"):].split("?")[0]
        full = os.path.abspath(os.path.join(CDN, rel)) if CDN else ""
        if not CDN or not full.startswith(CDN + os.sep) or not os.path.isfile(full):
            self.send_error(404)
            return
        body = open(full, "rb").read()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(full)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if rel.startswith("f/") else "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/cdn/"):
            return self.cdn()
        if self.path.startswith("/loginapi/"):
            try:
                with urllib.request.urlopen(LOGIN + self.path[len("/loginapi"):], timeout=8) as r:
                    body = r.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:  # the login service is down or slow
                self.send_error(502, str(e))
            return
        super().do_GET()


http.server.ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
