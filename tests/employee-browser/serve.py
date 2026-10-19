"""Fixed owned preview server. Run from the prepared output, never a repository root."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote
import hashlib, json, mimetypes, re
ROOT = Path(__file__).resolve().parent
report = json.loads((ROOT / 'report.json').read_text())
if report['status'] != 'prepared' or report['mode'] != 'local-prepare':
    raise RuntimeError('An honest prepared local report is required')
files = {}
for item in report['build']:
    path = ROOT / 'site' / item['path']
    if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
        raise RuntimeError('Prepared source output differs')
    files['/' + item['path']] = path.read_bytes()
CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; worker-src 'none'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == '/favicon.ico':
            self.send_response(204); self.end_headers(); return
        if path == '/' or re.fullmatch(r'/ihr/employees(?:/new|/[a-f0-9-]{36}(?:/edit|/reporting)?)?', path):
            path = '/index.html'
        if path not in files:
            self.send_error(403); return
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(path)[0] or 'application/octet-stream')
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers(); self.wfile.write(files[path])
print('Synthetic prepared preview only: http://127.0.0.1:4179/preview.html', flush=True)
HTTPServer(('127.0.0.1', 4179), Handler).serve_forever()
