#!/usr/bin/env python3
"""Static file server for the TicketScan web app.

Pure standard library (no dependencies) so it runs anywhere Python does and
inside a tiny Docker image. Serves the project directory with:

  * correct MIME types for ES modules (.js/.mjs) and WASM,
  * cache disabled, so edits show up immediately during development,
  * threaded request handling, so the browser can load several assets at once.

Usage:
    python server.py                 # serve ./ on 0.0.0.0:8000
    python server.py --port 8080
    python server.py --dir . --host 127.0.0.1 --no-cache false
"""
from __future__ import annotations

import argparse
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class AppRequestHandler(SimpleHTTPRequestHandler):
    """Static handler with module-friendly MIME types and no caching."""

    # Ensure JS modules and WASM are served with the right Content-Type.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".json": "application/json",
        ".css": "text/css",
        ".html": "text/html; charset=utf-8",
        ".svg": "image/svg+xml",
    }

    disable_cache = True

    def end_headers(self):
        if self.disable_cache:
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter, single-line logs
        print("[server] " + (fmt % args))


def build_handler(directory: str, disable_cache: bool):
    handler = partial(AppRequestHandler, directory=directory)

    # `partial` can't set the class attribute, so wrap it.
    class _Handler(AppRequestHandler):
        pass

    _Handler.disable_cache = disable_cache
    return partial(_Handler, directory=directory)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the TicketScan app.")
    parser.add_argument("--host", default="0.0.0.0", help="Interface to bind (default 0.0.0.0).")
    # Honor $PORT so hosts like Render/Heroku/Railway can assign the port.
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", 8000)),
        help="Port to listen on (default: $PORT or 8000).",
    )
    parser.add_argument("--dir", default="public", help="Directory to serve (default: public/).")
    parser.add_argument(
        "--cache",
        action="store_true",
        help="Allow browser caching (default: caching disabled for dev).",
    )
    args = parser.parse_args()

    handler = build_handler(args.dir, disable_cache=not args.cache)
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    url_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    print(f"TicketScan serving '{args.dir}' at http://{url_host}:{args.port}  (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
