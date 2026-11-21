#!/bin/bash
# Runs the hosted SQL against a throwaway local Postgres (needs psql + a server on PGHOST/PGPORT). Usage: PGHOST=/tmp PGPORT=5544 PGUSER=postgres bash hosted/test/sql-test.sh
set -e
export PGOPTIONS="-c client_min_messages=warning"
D=$(cd "$(dirname "$0")/.." && pwd)
P="psql -v ON_ERROR_STOP=1 -q -X -o /dev/null"
$P -d postgres -c "drop database if exists tt_test" -c "create database tt_test"
P="$P -d tt_test"
$P -f "$D/test/stub-supabase.sql" 2>&1 | grep -v NOTICE || true
$P -f "$D/sql/001_init.sql"
$P -f "$D/sql/001_init.sql"
$P -f "$D/sql/002_owner.sql"
echo "migration (twice) + owner seed OK"
PGOPTIONS="-c client_min_messages=notice" psql -v ON_ERROR_STOP=1 -q -X -d tt_test -f "$D/test/sql-checks.sql" 2>&1 | grep -v "^$" | grep -v "^SET$"
