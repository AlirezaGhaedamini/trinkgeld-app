#!/usr/bin/env bash
# Local only: drop, recreate and rebuild the test database from scratch,
# then run the security tests. Never point this at a remote project.
set -euo pipefail
export PATH=/usr/lib/postgresql/16/bin:$PATH
export PGHOST=${PGHOST:-/tmp/pgrun} PGPORT=${PGPORT:-5433} PGUSER=${PGUSER:-postgres}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

psql -q -d postgres -c "drop database if exists tipcrew;" -c "create database tipcrew;"
# Mirror Supabase's database-level search_path so extension operators resolve.
psql -q -d postgres -c "alter database tipcrew set search_path to \"\$user\", public, extensions;"

export PGDATABASE=tipcrew
psql -v ON_ERROR_STOP=1 -q -f "$ROOT/tests/00_local_supabase_shim.sql"
for f in "$ROOT"/migrations/*.sql; do
  printf '  applying %s\n' "$(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "migrations applied"

if [ "${1:-}" = "--test" ]; then
  for f in "$ROOT"/tests/[0-9][0-9]_*.sql; do
    case "$(basename "$f")" in 00_*) continue;; esac
    printf '\n── %s\n' "$(basename "$f")"
    psql -v ON_ERROR_STOP=1 -q -f "$f"
  done
fi
