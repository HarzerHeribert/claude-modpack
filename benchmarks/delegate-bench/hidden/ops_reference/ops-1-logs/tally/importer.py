"""Imports every *.csv of the import source (columns invoice_id,customer,date,amount) into the database."""
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


def parse_date(text, formats):
    """The ISO date of `text`, read with the first of `formats` (one format or a list) that fits; a partner may change its
    export mid-file."""
    for fmt in [formats] if isinstance(formats, str) else formats:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"time data {text!r} matches none of the formats {formats}")


def import_file(conn, path, formats):
    """Inserts the rows of one file; returns their number. A bad row is logged with file name and line, then raised."""
    path = Path(path)
    log.info("%s: start", path.name)
    n = 0
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        try:
            for row in reader:
                issued = parse_date(row["date"], formats)
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
        formats = icfg.get("date_formats") or [icfg["date_format"]]
        try:
            total += import_file(conn, path, formats)
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
