"""
Prune Cursor AI chat history older than N days, then reclaim the disk space.

WHY THIS SHAPE
--------------
state.vscdb grows without bound because Cursor never evicts old agent
conversations. A bare VACUUM does nothing useful here — only ~25 MB of the
13 GB was free pages; the rest is live rows. So rows must be deleted first,
and VACUUM afterwards is what actually shrinks the file on disk.

WHAT IT DELETES  (only rows attributable to a dated conversation)
    composerData:<id>        the conversation record
    bubbleId:<id>:*          its individual messages
    checkpointId:<id>:*      its workspace snapshots
    composerHeaders row      so the sidebar stays consistent

WHAT IT DELIBERATELY DOES NOT TOUCH
    agentKv:blob:<sha256>    ~6 GB of content-addressed blobs. The key carries
                             only a hash — no date, no conversation reference —
                             so there is no safe way to tell which belong to an
                             old chat and which a recent one still needs.

A conversation whose timestamp will not parse is KEPT. This never deletes on doubt.

IRREVERSIBLE. No full backup is taken: the database is ~13 GB and copying it
needs that much free space again, which is the problem being solved. A manifest
of every deleted conversation (id, date, title) is written next to the database
so there is a record of what went. Use --backup if you have the space and want
the belt-and-braces version.

USAGE  (Cursor must be fully closed for a real run)
    python prune-cursor-history.py --dry-run
    python prune-cursor-history.py --days 30
    python prune-cursor-history.py --days 30 --backup
"""
import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone

DEFAULT_DB = os.path.expandvars(r"%APPDATA%\Cursor\User\globalStorage\state.vscdb")
MB = 1024 * 1024
CHUNK = 200          # conversations per SQL statement, to bound statement size


def cursor_running():
    """True if any Cursor process is alive. Falsy on error — the sqlite lock
    check is the real guard; this is just a friendlier early message."""
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "@(Get-Process Cursor -ErrorAction SilentlyContinue).Count"],
            capture_output=True, text=True, timeout=30).stdout.strip()
        return bool(out) and out not in ("0", "")
    except Exception:
        return False


def connect(db_path, read_only):
    if read_only:
        # mode=ro + immutable=1 takes no locks and cannot write, so this is
        # safe even while Cursor holds the database open.
        return sqlite3.connect(
            "file:" + db_path.replace("\\", "/") + "?mode=ro&immutable=1", uri=True)
    # Plain path. Prefixing "file:" WITHOUT uri=True makes sqlite look for a
    # file literally named "file:C:/..." — that is what broke the first run.
    return sqlite3.connect(db_path)


def classify(cur, cutoff_ms):
    """Split conversations into (old_ids, kept_count, manifest)."""
    old, kept, manifest = set(), 0, []
    for key, value in cur.execute(
            "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'"):
        cid = key.split(":", 1)[1]
        try:
            data = json.loads(value)
            ts = data.get("lastUpdatedAt") or data.get("createdAt")
            if ts is None or ts >= cutoff_ms:
                kept += 1
                continue
            old.add(cid)
            manifest.append({
                "composerId": cid,
                "date": datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m-%d"),
                "title": (data.get("name") or data.get("title") or "")[:120],
            })
        except Exception:
            kept += 1        # unparseable -> keep, never delete on doubt
    return old, kept, manifest


def measure(cur, old_ids):
    """Bytes and row count that deleting old_ids would remove."""
    total_bytes = rows = 0
    for prefix in ("composerData", "bubbleId", "checkpointId"):
        for key, size in cur.execute(
                "SELECT key, LENGTH(value) FROM cursorDiskKV WHERE key LIKE ?",
                (prefix + ":%",)):
            parts = key.split(":")
            if len(parts) > 1 and parts[1] in old_ids:
                total_bytes += (size or 0)
                rows += 1
    return total_bytes, rows


def delete_conversations(con, cur, ids):
    deleted = 0
    for start in range(0, len(ids), CHUNK):
        chunk = ids[start:start + CHUNK]
        marks = ",".join("?" * len(chunk))

        # composerData keys are exact: composerData:<id>
        cur.execute("DELETE FROM cursorDiskKV WHERE key IN (%s)" % marks,
                    ["composerData:" + cid for cid in chunk])
        deleted += max(cur.rowcount, 0)

        # bubbleId / checkpointId are prefixes: <prefix>:<id>:<child>
        for prefix in ("bubbleId", "checkpointId"):
            clause = " OR ".join(["key LIKE ?"] * len(chunk))
            cur.execute("DELETE FROM cursorDiskKV WHERE " + clause,
                        ["%s:%s:%%" % (prefix, cid) for cid in chunk])
            deleted += max(cur.rowcount, 0)

        con.commit()
        done = min(start + CHUNK, len(ids))
        sys.stdout.write("\r  %d/%d conversations" % (done, len(ids)))
        sys.stdout.flush()
    sys.stdout.write("\n")
    return deleted


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30,
                    help="retain conversations newer than this many days")
    ap.add_argument("--dry-run", action="store_true", help="report only, change nothing")
    ap.add_argument("--backup", action="store_true",
                    help="copy the database first (needs ~13 GB free)")
    ap.add_argument("--db", default=DEFAULT_DB)
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print("Database not found: %s" % args.db)
        return 1

    if not args.dry_run and cursor_running():
        print("ABORT: Cursor is running. Close it completely (check the system tray),")
        print("then re-run. Writing to a live SQLite database risks corrupting it.")
        return 1

    db_dir = os.path.dirname(args.db)
    size_before = os.path.getsize(args.db)
    free_before = shutil.disk_usage(db_dir).free
    print("database : %8.0f MB" % (size_before / MB))
    print("free disk: %8.0f MB" % (free_before / MB))

    con = connect(args.db, read_only=args.dry_run)
    cur = con.cursor()

    cutoff = int(time.time() * 1000) - args.days * 86400 * 1000
    old, kept, manifest = classify(cur, cutoff)
    print("\nconversations: %d older than %dd (delete), %d retained"
          % (len(old), args.days, kept))
    if not old:
        print("Nothing to prune.")
        con.close()
        return 0

    freed, rows = measure(cur, old)
    print("rows to delete: %d  (~%.0f MB)" % (rows, freed / MB))

    if args.dry_run:
        print("\nDRY RUN - nothing changed.")
        con.close()
        return 0

    # VACUUM rebuilds into a new file, so it needs roughly the FINAL size free.
    need = (size_before - freed) * 1.1
    if free_before < need:
        print("\nABORT: VACUUM needs ~%.0f MB free, only %.0f MB available."
              % (need / MB, free_before / MB))
        con.close()
        return 1

    if args.backup:
        if free_before < size_before + need:
            print("\nABORT: --backup needs ~%.0f MB free." % ((size_before + need) / MB))
            con.close()
            return 1
        dest = args.db + ".bak-" + datetime.now().strftime("%Y%m%d-%H%M%S")
        print("\nbacking up to %s ..." % dest)
        con.close()
        shutil.copy2(args.db, dest)
        con = connect(args.db, read_only=False)
        cur = con.cursor()
        print("backup complete")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    man_path = os.path.join(db_dir, "pruned-conversations-%s.json" % stamp)
    with open(man_path, "w", encoding="utf-8") as fh:
        json.dump(sorted(manifest, key=lambda m: m["date"]), fh, indent=2)
    print("manifest : %s" % man_path)

    print("\ndeleting...")
    ids = sorted(old)
    deleted = delete_conversations(con, cur, ids)
    print("  deleted %d rows" % deleted)

    try:
        cur.execute("DELETE FROM composerHeaders WHERE composerId IN (%s)"
                    % ",".join("?" * len(ids)), ids)
        con.commit()
        print("  removed %d composerHeaders rows" % max(cur.rowcount, 0))
    except sqlite3.Error as exc:
        print("  composerHeaders skipped (%s)" % exc)

    print("\ncompacting (VACUUM) - a few minutes on a file this size...")
    sys.stdout.flush()
    con.isolation_level = None          # VACUUM cannot run inside a transaction
    cur.execute("VACUUM")
    con.close()

    size_after = os.path.getsize(args.db)
    print("\ndatabase : %8.0f MB  (was %.0f MB)" % (size_after / MB, size_before / MB))
    print("reclaimed: %8.0f MB" % ((size_before - size_after) / MB))
    print("free disk: %8.0f MB" % (shutil.disk_usage(db_dir).free / MB))
    return 0


if __name__ == "__main__":
    sys.exit(main())
