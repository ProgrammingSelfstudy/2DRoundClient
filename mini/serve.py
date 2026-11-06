#!/usr/bin/env python3
"""Serve the Creator web build and forward /loginapi/* to the login HTTP service, so the page needs no CORS.

  python3 mini/serve.py <host> <port> [login-base]     (login-base defaults to http://127.0.0.1:8081)
"""
import http.server
import os
import sys
import urllib.request

HOST, PORT = sys.argv[1], int(sys.argv[2])
LOGIN = (sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8081").rstrip("/")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build/web-mobile")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
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
