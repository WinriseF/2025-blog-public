"""Generate real SQLite fixtures outside source control; grow one file for large-file checks."""
import argparse
import pathlib
import sqlite3
import time

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--size-gb', type=float, default=0)
args = parser.parse_args()
path = pathlib.Path(args.output)
path.parent.mkdir(parents=True, exist_ok=True)
if args.size_gb and path.exists() and path.stat().st_size > int(args.size_gb * 1e9):
    path.unlink()
started = time.monotonic()
db = sqlite3.connect(path)
db.executescript('''
PRAGMA page_size=8192;
PRAGMA journal_mode=OFF;
PRAGMA synchronous=OFF;
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY, grp INTEGER REFERENCES groups(id), name TEXT, amount INTEGER, payload BLOB);
CREATE INDEX IF NOT EXISTS record_group ON records(grp, amount);
CREATE VIEW IF NOT EXISTS names AS SELECT id, name FROM records;
CREATE TABLE IF NOT EXISTS special(n INTEGER, empty TEXT, data BLOB);
''')
db.executemany('INSERT OR IGNORE INTO groups VALUES(?,?)', [(i, f'group-{i}') for i in range(100)])
if db.execute('SELECT count(*) FROM special').fetchone()[0] == 0:
    db.executemany('INSERT INTO special VALUES(?,?,?)', [(9223372036854775807, None, bytes([0, 255])), (-9223372036854775808, '', b'')])
count = db.execute('SELECT coalesce(max(id),0) FROM records').fetchone()[0]
target = int(args.size_gb * 1e9)
# Leave room for the final committed pages; do not create a >20 GB fixture.
while count < 601 or (target and path.stat().st_size < target - 32_000_000):
    batch = 1000 if target else 601 - count
    db.executemany('INSERT INTO records VALUES(?,?,?,?,?)', ((i, i % 100, f'记录 {i}', i % 10000,
        (f'{i:016d}'.encode() * 1024) if target else bytes([i % 256]) * 64) for i in range(count + 1, count + batch + 1)))
    count += batch
    db.commit()
db.close()
print(f'{path}: {count} records, {path.stat().st_size} bytes, {time.monotonic()-started:.2f}s', flush=True)
