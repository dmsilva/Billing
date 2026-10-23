#!/usr/bin/env bash
# Testa os ficheiros SQL num PostgreSQL local descartável (com uma simulação do Supabase).
# Requer os binários do PostgreSQL (initdb, pg_ctl, psql). Uso: npm run test:sql
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
cleanup() { pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

initdb -D "$TMP/data" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -f "$ROOT/supabase/test/00_stub_supabase.sql"
"${PSQL[@]}" -f "$ROOT/supabase/01_schema.sql"
"${PSQL[@]}" -f "$ROOT/supabase/02_policies.sql"
"${PSQL[@]}" -f "$ROOT/supabase/05_faturas_por_pagar.sql"
"${PSQL[@]}" -f "$ROOT/supabase/06_entradas_transferencias.sql"
"${PSQL[@]}" -f "$ROOT/supabase/07_encargos_pessoal.sql"
"${PSQL[@]}" -f "$ROOT/supabase/test/01_grants.sql"
"${PSQL[@]}" -f "$ROOT/supabase/03_seed_legacy.sql"
echo "Seed aplicado. A repetir para confirmar que é idempotente…"
"${PSQL[@]}" -f "$ROOT/supabase/01_schema.sql"
"${PSQL[@]}" -f "$ROOT/supabase/02_policies.sql"
"${PSQL[@]}" -f "$ROOT/supabase/03_seed_legacy.sql"
"${PSQL[@]}" -f "$ROOT/supabase/05_faturas_por_pagar.sql"
"${PSQL[@]}" -f "$ROOT/supabase/06_entradas_transferencias.sql"
"${PSQL[@]}" -f "$ROOT/supabase/07_encargos_pessoal.sql"
"${PSQL[@]}" -f "$ROOT/supabase/04_verificacao.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/test/02_rls_and_functions_test.sql"
"${PSQL[@]}" -f "$ROOT/supabase/test/03_pagamentos_test.sql"
"${PSQL[@]}" -f "$ROOT/supabase/test/04_entradas_test.sql"
"${PSQL[@]}" -f "$ROOT/supabase/test/05_encargos_test.sql"
