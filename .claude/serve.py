import functools
import http.server
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
port = int(os.environ.get("PORT", 4174))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler that disables all caching.

    Mobile/desktop browsers can hang on to old copies of html/js/css between
    edits (heuristic freshness on Last-Modified, disk cache, etc.), which
    makes it look like a fix "isn't working" when really the browser is just
    replaying stale bytes. Forcing no-store means every request during local
    development always gets the current file on disk.
    """

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


handler = functools.partial(NoCacheHandler, directory=root)
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
httpd.serve_forever()
