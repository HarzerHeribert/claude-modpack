"""The operating-software tasks' repository: tally, a small invoice service (Python standard library only: an HTTP
server on port 8731, an sqlite database, a CSV importer, shell scripts, deploy files, docs) with its logs, and four tasks
a developer would ask for when running it: find why last night's import failed from its log, bring a service up whose
configuration is wrong in three ways that show one after another, move a port across every kind of file that mentions
it, and analyse a 60,000-line access log. Built for the mods that help with operating things (does the model look at
the log before guessing, does it change every file type, does it leave nothing running).

ONE TASK AT A TIME: the grader (and the run itself) starts a server on the fixed port 8731 (8742 after ops-3), so tasks
of this repository must never run in parallel with each other.

Graded by hidden checks, the score is the share passed:
  - ops-1-logs: in a temp copy `make init && make import` exits 0, the database holds every row of the three CSVs, rows
    of partner_b.csv dated DD.MM.YYYY (the partner's export since 1 October, after some 2,200 ISO rows of the
    same file) with day <= 12 are stored day first, partner_a rows are unchanged, `make test` passes;
  - ops-2-health: needs plant() (config/service.toml gets threads = 0, a cache dir that does not exist and a typo in the
    import source; commits it and moves the tag `base` there). The grader checks first that nothing listens on 8731
    (the run must stop the service), then runs `make init`, starts the server itself and reads /health; the code and the
    scripts must be unchanged against `base`, the port still 8731, and the configuration valid on its own;
  - ops-3-port: no 8731 left in config, scripts, deploy, README, tests and the port mentions of the docs; the decoys
    (error code E-8731 in the docs, invoice 8731 in the test fixture) kept; compose, nginx and the unit parsed as data;
    the grader starts the server and runs scripts/healthcheck.sh; `make test` passes;
  - ops-4-monitor (an answer task): error rate, worst 5xx endpoint and its p95, computed by the grader from the
    repository's logs/access.log.
The grader never leaves a process running: servers start in a new session and the process group is killed in a finally.
All generated data comes from random.Random with fixed seeds; offline, macOS, Python 3.11+.

  python3 ops_repo.py build DIR    # writes the repository, commits it, tags it `base` (ops-2: then call plant())
  python3 ops_repo.py selftest     # grades the base (scores <= 0.5) and hidden/ops_reference (scores 1.0)
"""
import contextlib
import csv
import json
import math
import os
import random
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import tomllib
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
REFERENCE = HERE / "hidden" / "ops_reference"
PORT = 8731
CUSTOMERS = ["acme", "globex", "initech", "umbrella", "hooli", "stark", "wayne", "wonka", "cyberdyne", "tyrell", "soylent", "vandelay"]

# --------------------------------------------------------------------------------------------------------------------
# The repository
# --------------------------------------------------------------------------------------------------------------------


def service_toml(port=PORT, threads=4, cache="var/cache", source="data/incoming", formats=False):
    return f"""\
[server]
host = "127.0.0.1"
port = {port}
threads = {threads}

[db]
path = "var/tally.db"

[cache]
dir = "{cache}"

[import]
source = "{source}"
date_format = "%Y-%m-%d"
log = "logs/import.log"
""" + ("""
[import.formats]
"partner_b.csv" = "%d.%m.%Y"
""" if formats else "")


IMPORTER = r'''"""Imports every *.csv of the import source (columns invoice_id,customer,date,amount) into the database."""
import csv
import logging
import os
import sys
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from . import config, db

log = logging.getLogger("tally.importer")


def parse_amount(text):
    return int((Decimal(text.strip()) * 100).to_integral_value(ROUND_HALF_UP))


def import_file(conn, path, date_format):
    """Inserts the rows of one file; returns their number. A bad row is logged with file name and line, then raised."""
    path = Path(path)
    log.info("%s: start", path.name)
    n = 0
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        try:
            for row in reader:
                issued = datetime.strptime(row["date"], date_format).date().isoformat()
                cents = parse_amount(row["amount"])
                conn.execute(
                    "INSERT OR REPLACE INTO invoices(id, customer, issued_on, amount_cents, source) VALUES (?, ?, ?, ?, ?)",
                    (int(row["invoice_id"]), row["customer"], issued, cents, path.name),
                )
                n += 1
                log.debug("%s:%d invoice %s %s %s %d", path.name, reader.line_num, row["invoice_id"], row["customer"], issued, cents)
                if n % 50 == 0:
                    log.info("%s: %d rows", path.name, n)
        except Exception:
            log.exception("%s line %d: cannot import row", path.name, reader.line_num)
            raise
    log.info("%s: done, %d rows", path.name, n)
    return n


def main():
    cfg = config.load()
    icfg = cfg["import"]
    logfile = config.resolve(icfg["log"])
    logfile.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=logfile, level=os.environ.get("TALLY_LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)-7s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    files = sorted(config.resolve(icfg["source"]).glob("*.csv"))
    conn = db.connect(config.resolve(cfg["db"]["path"]))
    log.info("import started: source=%s files=%d", icfg["source"], len(files))
    total = 0
    for path in files:
        fmt = icfg["date_format"]
        try:
            total += import_file(conn, path, fmt)
            conn.commit()
        except Exception:
            conn.rollback()
            log.error("import failed")
            print(f"import failed in {path.name}, see {icfg['log']}", file=sys.stderr)
            return 1
    log.info("import finished: %d rows", total)
    print(f"imported {total} rows from {len(files)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
'''
IMPORTER_FIXED = IMPORTER.replace('fmt = icfg["date_format"]', 'fmt = icfg.get("formats", {}).get(path.name, icfg["date_format"])')

SERVER = r'''"""The tally HTTP server: /health and /invoices?customer=X."""
import json
import logging
import os
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import config

log = logging.getLogger("tally.server")
CFG = {}


def health():
    db_path = config.resolve(CFG["db"]["path"])
    cache = config.resolve(CFG["cache"]["dir"])
    source = config.resolve(CFG["import"]["source"])
    checks = {"db": False, "cache": cache.is_dir() and os.access(cache, os.W_OK), "import_source": source.is_dir()}
    if db_path.is_file():
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
            conn.close()
            checks["db"] = True
        except sqlite3.Error:
            pass
    return {"status": "ok" if all(checks.values()) else "degraded", "checks": checks}


class Handler(BaseHTTPRequestHandler):
    def send_json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self.send_json(200, health())
        if url.path == "/invoices":
            customer = parse_qs(url.query).get("customer", [None])[0]
            conn = sqlite3.connect(config.resolve(CFG["db"]["path"]))
            conn.row_factory = sqlite3.Row
            sql, args = "SELECT * FROM invoices", ()
            if customer:
                sql, args = sql + " WHERE customer = ?", (customer,)
            rows = [dict(r) for r in conn.execute(sql + " ORDER BY id LIMIT 500", args)]
            conn.close()
            return self.send_json(200, rows)
        self.send_json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)


def main():
    logs = config.ROOT / "logs"
    logs.mkdir(exist_ok=True)
    logging.basicConfig(filename=logs / "server.log", level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
    CFG.update(config.load())
    server = CFG["server"]
    threads = server["threads"]
    if not isinstance(threads, int) or not 1 <= threads <= 64:
        log.error("config error: [server] threads must be between 1 and 64, got %s", threads)
        return 2
    port = int(os.environ.get("TALLY_PORT") or server["port"])
    httpd = ThreadingHTTPServer((server["host"], port), Handler)
    log.info("listening on %s:%d with %d threads", server["host"], port, threads)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
'''

FILES = {
    ".gitignore": "var/\nlogs/server.log\nlogs/import.log\n__pycache__/\n*.pyc\n",
    "README.md": """\
# tally

tally is a small invoice service: it imports invoices from partners' CSV files into an sqlite database and serves them
over HTTP on port 8731.

    make init      # creates var/tally.db with its schema and the cache directory
    make run       # starts the server in the background (log: logs/server.log)
    make health    # asks the running server how it is
    make stop      # stops it
    make import    # imports data/incoming/*.csv (log: logs/import.log)
    make test

    curl http://localhost:8731/invoices?customer=acme

The configuration is config/service.toml. The cache lives in var/cache.
""",
    "Makefile": ".PHONY: init run stop health import test\n\n"
    "init:\n\tpython3 -m tally.db init\n\tmkdir -p var/cache\n\n"
    "run:\n\tscripts/run.sh\n\n"
    "stop:\n\tscripts/stop.sh\n\n"
    "health:\n\tscripts/healthcheck.sh\n\n"
    "import:\n\tpython3 -m tally.importer\n\n"
    "test:\n\tpython3 -m unittest discover -s tests -q\n",
    "config/service.toml": service_toml(),
    "tally/__init__.py": "",
    "tally/config.py": r'''"""Loads config/service.toml (relative to the repository root); TALLY_CONFIG may name another file."""
import os
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(path=None):
    p = Path(path or os.environ.get("TALLY_CONFIG") or ROOT / "config" / "service.toml")
    with open(p, "rb") as f:
        return tomllib.load(f)


def resolve(p):
    """A path from the configuration: relative ones are relative to the repository root."""
    return ROOT / p
''',
    "tally/db.py": r'''"""The sqlite database. `python3 -m tally.db init` creates it."""
import sqlite3
import sys

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY,
    customer TEXT NOT NULL,
    issued_on TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    source TEXT
);
CREATE INDEX IF NOT EXISTS invoices_customer ON invoices(customer);
"""


def connect(path):
    return sqlite3.connect(path)


def init(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def main(argv):
    if argv[1:2] != ["init"]:
        print("usage: python3 -m tally.db init", file=sys.stderr)
        return 2
    cfg = config.load()
    init(config.resolve(cfg["db"]["path"]))
    try:
        config.resolve(cfg["cache"]["dir"]).mkdir(parents=True, exist_ok=True)
    except OSError as e:
        print(f"warning: cannot create the cache directory: {e}", file=sys.stderr)
    print("initialised", cfg["db"]["path"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
''',
    "tally/importer.py": IMPORTER,
    "tally/server.py": SERVER,
    "tally/report.py": r'''"""Prints the invoice totals per customer."""
import sqlite3

from . import config


def totals(conn):
    return conn.execute("SELECT customer, count(*), sum(amount_cents) FROM invoices GROUP BY customer ORDER BY customer").fetchall()


if __name__ == "__main__":
    conn = sqlite3.connect(config.resolve(config.load()["db"]["path"]))
    for customer, n, cents in totals(conn):
        print(f"{customer:12} {n:5} {cents / 100:12.2f}")
''',
    "scripts/run.sh": """\
#!/bin/sh
# Starts the server in the background; its output goes to logs/server.log, its pid to var/tally.pid.
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs var
nohup python3 -m tally.server >> logs/server.log 2>&1 &
echo $! > var/tally.pid
echo started
""",
    "scripts/stop.sh": """\
#!/bin/sh
# Stops the server started by run.sh.
cd "$(dirname "$0")/.." || exit 1
if [ -f var/tally.pid ] && kill -0 "$(cat var/tally.pid)" 2>/dev/null; then
    kill "$(cat var/tally.pid)"
    echo stopped
else
    echo "not running"
fi
rm -f var/tally.pid
""",
    "scripts/healthcheck.sh": """\
#!/bin/sh
# Prints /health; exits non-zero unless the status is ok.
out=$(curl -fsS http://127.0.0.1:8731/health) || exit 1
echo "$out"
echo "$out" | grep -q '"status": "ok"'
""",
    "deploy/nginx.conf": """\
upstream tally {
    server 127.0.0.1:8731;
}

server {
    listen 80;
    server_name tally.example.com;

    location /health {
        proxy_pass http://127.0.0.1:8731/health;
    }

    location / {
        proxy_pass http://127.0.0.1:8731;
        proxy_set_header Host $host;
    }
}
""",
    "deploy/docker-compose.yml": """\
services:
  tally:
    build: .
    ports:
      - "8731:8731"
    environment:
      TALLY_PORT: "8731"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8731/health"]
      interval: 30s
      timeout: 5s
      retries: 3
""",
    "deploy/tally.service": """\
[Unit]
Description=tally invoice service
After=network.target

[Service]
User=tally
WorkingDirectory=/srv/tally
Environment=TALLY_PORT=8731
ExecStart=/usr/bin/python3 -m tally.server
Restart=on-failure

[Install]
WantedBy=multi-user.target
""",
    "docs/operations.md": """\
# Operating tally

## Deploying

1. Copy the repository to /srv/tally and run `make init`.
2. Install deploy/tally.service and start it; it listens on port 8731.
3. Put deploy/nginx.conf in front of it; nginx forwards to port 8731 on the same host.
4. Check `make health` (it must print status ok) and watch logs/server.log.

## Importing

`make import` reads data/incoming/*.csv and logs to logs/import.log. Partners send their own date formats.

## Error codes

| Code | Meaning |
| ---- | ------- |
| E-1001 | unknown customer |
| E-2040 | amount is not a number |
| E-8731: duplicate invoice id | the invoice id exists already |
| E-9000 | database is locked |
""",
    "tests/test_config.py": """\
import unittest

from tally import config


class ConfigTest(unittest.TestCase):
    def test_default_port(self):
        self.assertEqual(config.load()["server"]["port"], 8731)

    def test_threads_parse(self):
        self.assertIsInstance(config.load()["server"]["threads"], int)


if __name__ == "__main__":
    unittest.main()
""",
    "tests/test_importer.py": """\
import sqlite3
import tempfile
import unittest
from pathlib import Path

from tally import db, importer

FIXTURE = Path(__file__).resolve().parent.parent / "data" / "fixtures" / "invoices.csv"


class ImporterTest(unittest.TestCase):
    def test_imports_fixture(self):
        with tempfile.TemporaryDirectory() as t:
            path = Path(t) / "t.db"
            db.init(path)
            conn = db.connect(path)
            n = importer.import_file(conn, FIXTURE, "%Y-%m-%d")
            conn.commit()
            self.assertEqual(n, 5)
            row = conn.execute("SELECT customer, issued_on, amount_cents FROM invoices WHERE amount_cents = 12050").fetchone()
            self.assertEqual(row, ("acme", "2026-02-03", 12050))

    def test_amount(self):
        self.assertEqual(importer.parse_amount("19.99"), 1999)


if __name__ == "__main__":
    unittest.main()
""",
    "data/fixtures/invoices.csv": "invoice_id,customer,date,amount\n1,globex,2026-01-05,10.00\n2,initech,2026-01-06,99.90\n3,hooli,2026-01-07,5.25\n"
    "8731,acme,2026-02-03,120.50\n4,stark,2026-01-09,1000.00\n",
}

# --------------------------------------------------------------------------------------------------------------------
# Generated data: the partners' CSVs, last night's import log, yesterday's access log
# --------------------------------------------------------------------------------------------------------------------


# partner_b changed its export on 1 October: its rows are in date order, ISO before, DD.MM.YYYY (day first) from then on,
# so the import fails some 2,200 rows into the file, and a per-file date format cannot fix it.
SWITCH = date(2026, 10, 1)


def dated(name: str, d: date) -> str:
    return d.strftime("%d.%m.%Y") if name == "partner_b.csv" and d >= SWITCH else d.isoformat()


def gen_invoices():
    """{file name: [(invoice_id, customer, date, cents)]}; partner_b's rows in date order (see SWITCH)."""
    rng = random.Random(20261014)
    out = {}
    for name, n, base in (("partner_a.csv", 2000, 10000), ("partner_b.csv", 2400, 20000), ("partner_c.csv", 1500, 30000)):
        days = [rng.randrange(0, 290) for _ in range(n)]
        if name == "partner_b.csv":
            days.sort()
        rows = [(base + i, rng.choice(CUSTOMERS), date(2026, 1, 1) + timedelta(days=d), rng.randrange(500, 250000)) for i, d in enumerate(days)]
        out[name] = rows
    return out


def csv_text(name, rows):
    import io
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["invoice_id", "customer", "date", "amount"])
    for inv, cust, d, cents in rows:
        w.writerow([inv, cust, dated(name, d), f"{cents // 100}.{cents % 100:02d}"])
    return buf.getvalue()


def import_log():
    rng = random.Random(1014)
    data = gen_invoices()
    t = datetime(2026, 10, 14, 2, 0, 0)
    lines = []

    def emit(level, msg, step=0):
        nonlocal t
        t += timedelta(seconds=step)
        lines.append(f"{t:%Y-%m-%d %H:%M:%S} {level:<7} {msg}")

    emit("INFO", "import started: source=data/incoming files=3")
    for name in ("partner_a.csv", "partner_b.csv"):
        emit("INFO", f"{name}: start", 1)
        for n, (inv, cust, d, cents) in enumerate(data[name], 1):
            line = n + 1
            if dated(name, d) != d.isoformat():
                emit("ERROR", f"{name} line {line}: cannot import row")
                lines.append("Traceback (most recent call last):")
                src_line = next(i for i, l in enumerate(IMPORTER.splitlines(), 1) if "issued = datetime.strptime" in l)
                lines += [
                    f'  File "/srv/tally/tally/importer.py", line {src_line}, in import_file',
                    "    issued = datetime.strptime(row[\"date\"], date_format).date().isoformat()",
                    '  File "/usr/lib/python3.12/_strptime.py", line 554, in _strptime_datetime',
                    "    tt, fraction, gmtoff_fraction = _strptime(data_string, format)",
                    '  File "/usr/lib/python3.12/_strptime.py", line 333, in _strptime',
                    '    raise ValueError("time data %r does not match format %r" %',
                    f"ValueError: time data '{dated(name, d)}' does not match format '%Y-%m-%d'",
                ]
                break
            emit("DEBUG", f"{name}:{line} invoice {inv} {cust} {d.isoformat()} {cents}", 0 if rng.random() < 0.8 else 1)
            if n % 50 == 0:
                emit("INFO", f"{name}: {n} rows")
                if rng.random() < 0.04:
                    emit("WARNING", f"slow disk: commit took {rng.randint(900, 4000)} ms")
        else:
            emit("INFO", f"{name}: done, {len(data[name])} rows")
    emit("ERROR", "import failed")
    return "\n".join(lines) + "\n"


# (path template, weight, share 5xx, share 4xx, mean log of response ms)
ENDPOINTS = [
    ("/invoices", 20, 0.002, 0.01, 3.3),
    ("/invoices?customer={c}", 8, 0.002, 0.01, 3.6),
    ("/invoices/{n}", 25, 0.002, 0.02, 3.0),
    ("/customers/{n}/invoices", 14, 0.003, 0.01, 3.5),
    ("/customers/{n}", 10, 0.001, 0.09, 3.0),
    ("/invoices/{n}/pdf", 9, 0.05, 0.0, 6.2),
    ("/reports/monthly", 3, 0.01, 0.0, 5.0),
    ("/health", 3, 0.003, 0.0, 1.5),
]


def access_log():
    rng = random.Random(4242)
    n_lines = 60000
    secs = sorted(rng.randrange(86400) for _ in range(n_lines))
    weights = [e[1] for e in ENDPOINTS]
    out = []
    for s in secs:
        tmpl, _, p5, p4, mu = rng.choices(ENDPOINTS, weights)[0]
        path = tmpl.format(n=rng.randint(1, 5000), c=rng.choice(CUSTOMERS))
        r = rng.random()
        if r < p5:
            status = 503 if tmpl == "/health" else rng.choice([500, 500, 502, 504])
        elif r < p5 + p4:
            status = rng.choice([404, 404, 404, 400, 429]) if tmpl != "/customers/{n}" else rng.choice([404, 404, 404, 400])
        else:
            status = 200
        ms = max(1, int(rng.lognormvariate(mu, 0.5) * (2.5 if status >= 500 else 1)))
        if status != 200:
            size = rng.randint(120, 400)
        elif tmpl.endswith("/pdf"):
            size = rng.randint(20000, 200000)
        else:
            size = rng.randint(300, 9000)
        out.append(f'127.0.0.1 - - [14/Oct/2026:{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d} +0000] "GET {path} HTTP/1.1" {status} {size} {ms}')
    return "\n".join(out) + "\n"


def access_truth(repo: Path) -> dict:
    """Error rate (%), worst 5xx endpoint and its nearest-rank p95, from the repository's access log."""
    total = errors = 0
    by5, times = {}, {}
    pat = re.compile(r'"[A-Z]+ (\S+) [^"]*" (\d{3}) \d+ (\d+)\s*$')
    for line in (repo / "logs/access.log").read_text().splitlines():
        m = pat.search(line)
        if not m:
            continue
        ep = re.sub(r"\d+", "{id}", m[1].split("?")[0])
        status = int(m[2])
        total += 1
        times.setdefault(ep, []).append(int(m[3]))
        if status >= 500:
            errors += 1
            by5[ep] = by5.get(ep, 0) + 1
    worst = max(by5, key=by5.get)
    ts = sorted(times[worst])
    return {"rate": 100 * errors / total, "endpoint": worst, "p95": ts[math.ceil(0.95 * len(ts)) - 1]}


def build(repo: Path):
    repo.mkdir(parents=True, exist_ok=True)
    for rel, text in FILES.items():
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    for name, rows in gen_invoices().items():
        (repo / "data/incoming").mkdir(parents=True, exist_ok=True)
        (repo / "data/incoming" / name).write_text(csv_text(name, rows))
    (repo / "logs").mkdir(exist_ok=True)
    (repo / "logs/import-2026-10-14.log").write_text(import_log())
    (repo / "logs/access.log").write_text(access_log())
    for s in (repo / "scripts").iterdir():
        s.chmod(0o755)
    git = ["git", "-c", "user.email=bench@local", "-c", "user.name=bench"]
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run([*git, "commit", "-q", "-m", "tally"], cwd=repo, check=True)
    subprocess.run(["git", "tag", "base"], cwd=repo, check=True)


def plant_ops2(repo: Path):
    (repo / "config/service.toml").write_text(service_toml(threads=0, cache="/var/cache/tally", source="data/incomming"))
    git = ["git", "-c", "user.email=bench@local", "-c", "user.name=bench"]
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run([*git, "commit", "-q", "-m", "planted"], cwd=repo, check=True)
    subprocess.run(["git", "tag", "-f", "base"], cwd=repo, check=True, capture_output=True)  # the diff base is the planted state


def plant(task: str, repo: Path):
    """Applies a task's planted starting point after build() (bench calls this after copying); nothing for most tasks.
    ops-2-health: the config gets threads = 0, cache dir /var/cache/tally, import source data/incomming; committed as
    "planted" and the tag `base` moved there."""
    if task == "ops-2-health":
        plant_ops2(repo)


# --------------------------------------------------------------------------------------------------------------------
# The tasks
# --------------------------------------------------------------------------------------------------------------------

TASKS = {
    "ops-1-logs": {
        "kind": "edit",
        "prompt": "Last night's import (`make import`) failed. The log of that run is logs/import-2026-10-14.log. Find out why and fix it so "
        "that `make import` imports every file in data/incoming/ completely. Don't skip or drop rows. The tests run with `make test`.",
    },
    "ops-2-health": {
        "kind": "edit",
        "plant": plant_ops2,
        "prompt": "Start the service with `make init` and `make run`, then check it with `make health`. It isn't healthy. Find out why and "
        "fix it in the configuration only (config/), not in the code or the scripts. Stop the service again when you're done.",
    },
    "ops-3-port": {
        "kind": "edit",
        "prompt": "Move the service from port 8731 to 8742 everywhere it is configured or referenced: the config, the scripts, the deploy "
        "files, the tests and the docs. Nothing should still point at the old port.",
    },
    "ops-4-monitor": {
        "kind": "answer",
        "prompt": "logs/access.log is yesterday's access log of the service. What was the overall error rate (share of requests answered with "
        "a 5xx status, in percent with one decimal), which endpoint had the most 5xx responses (endpoints are paths with numeric ids "
        "replaced by {id}, e.g. /invoices/{id}), and what was the 95th percentile response time of that endpoint (nearest-rank, in ms)? "
        "End your answer with exactly three lines: `error rate: X%`, `worst endpoint: /path`, `p95: N ms`.",
    },
}

# --------------------------------------------------------------------------------------------------------------------
# Grading
# --------------------------------------------------------------------------------------------------------------------


def clean_env():
    env = {k: v for k, v in os.environ.items() if k not in ("TALLY_CONFIG", "TALLY_PORT", "TALLY_LOG_LEVEL")}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def sh(argv, cwd, timeout=120):
    try:
        return subprocess.run(argv, cwd=cwd, env=clean_env(), capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(argv, 124, "", "timeout")


def listening(port) -> bool:
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", port)) == 0


def config_of(repo: Path) -> dict:
    try:
        return tomllib.loads((repo / "config/service.toml").read_text())
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def config_port(repo: Path):
    return config_of(repo).get("server", {}).get("port")


@contextlib.contextmanager
def serve(repo: Path):
    """Starts the server of `repo` in a new session; yields its /health (None if it did not answer within 45 s);
    the process group is killed on the way out. Python's HTTP server looks up the host's name as it binds: behind a
    VPN's name servers that took 35 s on 28 Oct, and a 10 s wait graded every working fix as a server that never
    started."""
    port = config_port(repo) or PORT
    (repo / "logs").mkdir(exist_ok=True)
    out = open(repo / "logs/server.log", "ab")
    proc = subprocess.Popen([sys.executable, "-m", "tally.server"], cwd=repo, env=clean_env(), stdout=out, stderr=out, start_new_session=True)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    health = None
    try:
        deadline = time.time() + 45
        while time.time() < deadline and proc.poll() is None:
            try:
                health = json.load(opener.open(f"http://127.0.0.1:{port}/health", timeout=2))
                break
            except Exception:
                time.sleep(0.2)
        yield health
    finally:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
        out.close()


def scratch(repo: Path, tmp: Path) -> Path:
    dest = tmp / "copy"
    shutil.copytree(repo, dest, symlinks=True, ignore=shutil.ignore_patterns("__pycache__"))
    (dest / "var").mkdir(exist_ok=True)
    return dest


def stop_leftover(repo: Path):
    pid = repo / "var/tally.pid"
    if pid.is_file():
        with contextlib.suppress(Exception):
            os.kill(int(pid.read_text().strip()), signal.SIGKILL)
        time.sleep(0.3)


def grade_1(repo: Path) -> dict:
    import sqlite3
    c = {}
    data = gen_invoices()
    with tempfile.TemporaryDirectory() as t:
        w = scratch(repo, Path(t))
        (w / "var/tally.db").unlink(missing_ok=True)
        sh(["make", "init"], w)
        r = sh(["make", "import"], w)
        c["import_ok"] = r.returncode == 0
        rows = {}
        if (w / "var/tally.db").is_file():
            conn = sqlite3.connect(w / "var/tally.db")
            try:
                rows = {r[0]: r[1] for r in conn.execute("SELECT id, issued_on FROM invoices")}
            except sqlite3.Error:
                pass
            conn.close()
        c["all_rows"] = len(rows) == sum(len(v) for v in data.values())
        b = [x for x in data["partner_b.csv"] if x[2] >= SWITCH and x[2].day <= 12 and x[2].day != x[2].month][:3]
        c["day_first"] = len(b) == 3 and all(rows.get(inv) == d.isoformat() for inv, _, d, _ in b)
        a = [data["partner_a.csv"][i] for i in (4, 500, 1500)]
        c["other_dates"] = all(rows.get(inv) == d.isoformat() for inv, _, d, _ in a)
        c["tests_ok"] = sh(["make", "test"], w).returncode == 0
    return c


def grade_2(repo: Path) -> dict:
    c = {}
    c["left_stopped"] = not listening(PORT)
    if not c["left_stopped"]:
        stop_leftover(repo)
    cfg = config_of(repo)
    sh(["make", "init"], repo)
    threads = cfg.get("server", {}).get("threads")
    c["threads_valid"] = isinstance(threads, int) and 1 <= threads <= 64
    cache = repo / cfg.get("cache", {}).get("dir", "-")
    c["cache_usable"] = cache.is_dir() and os.access(cache, os.W_OK)
    c["source_exists"] = (repo / cfg.get("import", {}).get("source", "-")).is_dir()
    with serve(repo) as health:
        c["starts"] = health is not None
        c["healthy"] = bool(health) and health.get("status") == "ok" and all(health.get("checks", {}).get(k) is True for k in ("db", "cache", "import_source"))
    diff = sh(["git", "diff", "base", "--", "tally", "scripts", "Makefile"], repo)
    c["code_untouched"] = diff.returncode == 0 and diff.stdout.strip() == ""
    c["port_kept"] = cfg.get("server", {}).get("port") == PORT
    return c


def grade_3(repo: Path) -> dict:
    c = {}
    c["config_port"] = config_port(repo) == 8742
    texts = []
    for rel in ("config", "scripts", "deploy", "tests"):
        for p in sorted((repo / rel).rglob("*")) if (repo / rel).is_dir() else []:
            if p.is_file() and p.suffix != ".pyc" and "__pycache__" not in p.parts:
                texts.append(p.read_text(errors="replace"))
    for rel in ("README.md", "docs/operations.md"):
        p = repo / rel
        texts.append(p.read_text(errors="replace").replace("E-8731", "") if p.is_file() else "")
    c["no_old_port"] = not any("8731" in t for t in texts)
    docs = (repo / "docs/operations.md").read_text(errors="replace") if (repo / "docs/operations.md").is_file() else ""
    fix = (repo / "data/fixtures/invoices.csv").read_text(errors="replace") if (repo / "data/fixtures/invoices.csv").is_file() else ""
    c["decoys_kept"] = "E-8731: duplicate invoice id" in docs and re.search(r"^8731,acme,", fix, re.M) is not None
    try:
        comp = yaml.safe_load((repo / "deploy/docker-compose.yml").read_text())["services"]["tally"]
        hc = comp["healthcheck"]["test"]
        hc = " ".join(hc) if isinstance(hc, list) else str(hc)
        c["compose_ok"] = (comp["ports"] == ["8742:8742"] and str(comp["environment"]["TALLY_PORT"]) == "8742"
                           and "localhost:8742/health" in hc and "8731" not in hc)
    except Exception:
        c["compose_ok"] = False
    ng = (repo / "deploy/nginx.conf").read_text(errors="replace") if (repo / "deploy/nginx.conf").is_file() else ""
    targets = re.findall(r"127\.0\.0\.1:(\d+)", ng)
    c["nginx_ok"] = bool(targets) and set(targets) == {"8742"} and "proxy_pass" in ng
    unit = (repo / "deploy/tally.service").read_text(errors="replace") if (repo / "deploy/tally.service").is_file() else ""
    c["unit_ok"] = re.search(r"^Environment=TALLY_PORT=8742\s*$", unit, re.M) is not None and "8731" not in unit
    with tempfile.TemporaryDirectory() as t:
        w = scratch(repo, Path(t))
        sh(["make", "init"], w)
        with serve(w):
            r = sh(["scripts/healthcheck.sh"], w, 30)
        c["healthcheck_ok"] = config_port(w) == 8742 and r.returncode == 0
        c["tests_ok"] = sh(["make", "test"], w).returncode == 0
    return c


def grade_4(repo: Path, answer: str) -> dict:
    truth = access_truth(repo)
    rate = re.findall(r"error rate:\s*([\d.]+)\s*%", answer, re.I)
    ep = re.findall(r"worst endpoint:\s*(\S+)", answer, re.I)
    p95 = re.findall(r"p95:\s*(\d+)\s*ms", answer, re.I)
    c = {
        "rate": bool(rate) and abs(float(rate[-1]) - truth["rate"]) <= 0.1 + 1e-9,
        "endpoint": bool(ep) and ep[-1].strip("`") == truth["endpoint"],
        "p95": bool(p95) and abs(int(p95[-1]) - truth["p95"]) <= 0.02 * truth["p95"],
    }
    return c


def grade(task: str, answer: str, repo: Path) -> dict:
    checks = {"ops-1-logs": lambda: grade_1(repo), "ops-2-health": lambda: grade_2(repo), "ops-3-port": lambda: grade_3(repo),
              "ops-4-monitor": lambda: grade_4(repo, answer)}[task]()
    passed = sum(1 for v in checks.values() if v)
    return {"score": passed / len(checks), "checks": checks, "failed": sorted(k for k, v in checks.items() if not v)}


def selftest():
    """The base scores <= 0.5 on every task; hidden/ops_reference/<task>/ (files laid over the base, ANSWER.txt for answer tasks) scores 1.0."""
    bad = False
    for task, spec in TASKS.items():
        for label in ("base", "reference"):
            with tempfile.TemporaryDirectory() as t:
                repo = Path(t) / "repo"
                build(repo)
                plant(task, repo)
                answer = ""
                if label == "reference":
                    ref = REFERENCE / task
                    if not ref.is_dir():
                        print(f"{task:14} {label:9} (no reference)")
                        bad = True
                        continue
                    if spec["kind"] == "answer":
                        answer = (ref / "ANSWER.txt").read_text()
                    else:
                        shutil.copytree(ref, repo, dirs_exist_ok=True)
                try:
                    g = grade(task, answer, repo)
                finally:
                    if listening(PORT) or listening(8742):
                        print("warning: something still listens", file=sys.stderr)
                print(f"{task:14} {label:9} {g['score']:.2f}  failed: {', '.join(g['failed']) or '-'}")
                if (label == "reference" and g["score"] < 1.0) or (label == "base" and g["score"] > 0.5):
                    bad = True
    if bad:
        sys.exit(1)


if __name__ == "__main__":
    if sys.argv[1:2] == ["build"]:
        build(Path(sys.argv[2]))
    elif sys.argv[1:2] == ["selftest"]:
        selftest()
    else:
        sys.exit(__doc__)
