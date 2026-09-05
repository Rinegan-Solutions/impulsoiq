#!/usr/bin/env python3
"""
Lint SQL files against Aurora DSQL's documented grammar.

WHY THIS EXISTS
The DSQL schema failed to apply four times in a row, each time on a different
incompatibility, each one only discovered when the migration stage hit that
line in production:

    ERROR: unsupported mode. please use CREATE INDEX ASYNC.
    ERROR: specifying sort order not supported for index keys
    ERROR: ALTER TABLE ADD COLUMN with constraint not supported

Every one of those is statically detectable. Discovering them one per deploy is
a workflow bug, not bad luck, so the rules below encode what the Aurora DSQL SQL
reference actually permits and run in the validate stage — before anything
reaches a cluster.

RULES AND THEIR SOURCES
  CREATE INDEX ......... "index creation is always asynchronous, so you must
                          specify the ASYNC keyword"
                         Supported: CREATE [UNIQUE] INDEX ASYNC [IF NOT EXISTS]
                           name ON table (col | (expr)) [NULLS {FIRST|LAST}]
                           [INCLUDE (...)] [NULLS [NOT] DISTINCT]
                         => no ASC/DESC, no WHERE (partial), no USING <method>
  ALTER TABLE .......... ADD [COLUMN] [IF NOT EXISTS] name data_type
                           [STORAGE {...}]
                         => no NOT NULL / DEFAULT / CHECK / UNIQUE / REFERENCES
                         ADD <table_constraint> must carry NOT VALID
                         There is no SET NOT NULL action, only DROP NOT NULL
  Transactions ......... one DDL statement per transaction; DDL and DML must be
                         in separate transactions => no BEGIN/COMMIT here, psql
                         autocommit gives each statement its own transaction
  Not supported ........ triggers, PL/pgSQL, TRUNCATE, temp tables, sequences
                         via SERIAL (identity columns are bigint-only and need
                         an explicit CACHE)

Usage:  python scripts/check-dsql-schema.py <file.sql> [...]
Exit:   0 clean, 1 violations found
"""
from __future__ import annotations

import re
import sys

# (compiled pattern, short name, explanation)
RULES: list[tuple[re.Pattern[str], str, str]] = [
    (
        re.compile(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX(?!\s+ASYNC\b)\s", re.I),
        "index-not-async",
        "CREATE INDEX must be CREATE INDEX ASYNC — DSQL builds every secondary "
        "index asynchronously and rejects the synchronous form.",
    ),
    (
        re.compile(r"\bINDEX\s+ASYNC\b[^;]*?\b(?:ASC|DESC)\b", re.I | re.S),
        "index-sort-order",
        "Sort order is not supported for index keys. Drop ASC/DESC; use "
        "NULLS FIRST/LAST if null placement is what you need.",
    ),
    (
        re.compile(r"\bINDEX\s+ASYNC\b[^;]*?\bWHERE\b", re.I | re.S),
        "partial-index",
        "Partial indexes (WHERE) are not in DSQL's CREATE INDEX grammar.",
    ),
    (
        re.compile(r"\bINDEX\s+ASYNC\b[^;]*?\bUSING\s+\w+", re.I | re.S),
        "index-using-method",
        "USING <method> is not in DSQL's CREATE INDEX grammar.",
    ),
    (
        # ADD COLUMN carrying anything beyond `name type [STORAGE ...]`
        re.compile(
            r"\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\w+\s+[\w()\[\], ]*?"
            r"\b(NOT\s+NULL|DEFAULT|CHECK|UNIQUE|REFERENCES|PRIMARY\s+KEY)\b",
            re.I,
        ),
        "add-column-constraint",
        "ALTER TABLE ADD COLUMN takes only `name data_type [STORAGE ...]`. "
        "Declare constraints on CREATE TABLE, or add the column bare and follow "
        "with ALTER COLUMN ... SET DEFAULT. NOT NULL cannot be added at all — "
        "DSQL has DROP NOT NULL and no SET NOT NULL.",
    ),
    (
        re.compile(r"\bALTER\s+(?:COLUMN\s+)?\w+\s+SET\s+NOT\s+NULL\b", re.I),
        "set-not-null",
        "SET NOT NULL is not a DSQL ALTER TABLE action.",
    ),
    (
        re.compile(r"\bADD\s+CONSTRAINT\b(?:(?!NOT\s+VALID)[^;])*;", re.I | re.S),
        "constraint-not-valid",
        "ALTER TABLE ADD CONSTRAINT must use NOT VALID, then "
        "ALTER TABLE ASYNC ... VALIDATE CONSTRAINT.",
    ),
    (re.compile(r"\bCREATE\s+TRIGGER\b", re.I), "trigger", "Triggers are not supported."),
    (re.compile(r"\bLANGUAGE\s+plpgsql\b", re.I), "plpgsql",
     "PL/pgSQL is not supported; SQL-language functions only."),
    (re.compile(r"^\s*DO\s+\$\$", re.I | re.M), "do-block",
     "DO blocks require PL/pgSQL, which is not supported."),
    (re.compile(r"\bTRUNCATE\b", re.I), "truncate", "Use DELETE FROM instead of TRUNCATE."),
    (re.compile(r"\bCREATE\s+(?:GLOBAL\s+|LOCAL\s+)?TEMP(?:ORARY)?\s+TABLE\b", re.I),
     "temp-table", "Temporary tables are not supported; use a CTE."),
    (re.compile(r"\b(?:BIG)?SERIAL\b", re.I), "serial",
     "SERIAL is not supported. Use GENERATED ... AS IDENTITY on a bigint with "
     "an explicit CACHE, or a UUID."),
    (re.compile(r"^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;", re.I | re.M), "explicit-transaction",
     "A transaction may contain only one DDL statement. Let psql autocommit "
     "give each statement its own transaction."),
    (re.compile(r"\bCREATE\s+(?:MATERIALIZED\s+)?VIEW\b", re.I), "view",
     "Views are not part of the supported DDL surface."),
]


def strip_noise(sql: str) -> str:
    """Blank out comments and string literals so they cannot trip a rule."""
    sql = re.sub(r"/\*.*?\*/", lambda m: " " * len(m.group(0)), sql, flags=re.S)
    sql = re.sub(r"--[^\n]*", lambda m: " " * len(m.group(0)), sql)
    return re.sub(r"'(?:[^']|'')*'", lambda m: "'" + " " * (len(m.group(0)) - 2) + "'", sql)


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def check(path: str) -> list[str]:
    raw = open(path, encoding="utf-8").read()
    clean = strip_noise(raw)
    lines = raw.splitlines()
    found = []
    for pattern, name, why in RULES:
        for m in pattern.finditer(clean):
            n = line_of(clean, m.start())
            src = lines[n - 1].strip() if n <= len(lines) else ""
            found.append(f"{path}:{n}: [{name}] {why}\n    {src[:120]}")
    return found


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    problems: list[str] = []
    for path in argv[1:]:
        problems.extend(check(path))

    if problems:
        print(f"Aurora DSQL schema check FAILED — {len(problems)} violation(s):\n")
        for p in problems:
            print(p + "\n")
        return 1

    print(f"Aurora DSQL schema check passed ({len(argv) - 1} file(s)).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
