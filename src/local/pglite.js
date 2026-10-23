// Carregado só em modo local: PostgreSQL em WebAssembly e os mesmos SQL que se executam no Supabase.
import stubSql from '../../supabase/test/00_stub_supabase.sql?raw'
import schemaSql from '../../supabase/01_schema.sql?raw'
import policiesSql from '../../supabase/02_policies.sql?raw'
import paymentsSql from '../../supabase/05_faturas_por_pagar.sql?raw'
import creditsSql from '../../supabase/06_entradas_transferencias.sql?raw'
import encargosSql from '../../supabase/07_encargos_pessoal.sql?raw'
import grantsSql from '../../supabase/test/01_grants.sql?raw'
import seedSql from '../../supabase/03_seed_legacy.sql?raw'

export { PGlite } from '@electric-sql/pglite'
export { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
export const SETUP_SQL = [stubSql, schemaSql, policiesSql, paymentsSql, creditsSql, encargosSql, grantsSql, seedSql]
// Bases locais criadas antes das faturas por pagar recebem só esta atualização.
export const PAYMENTS_UPDATE_SQL = [paymentsSql, grantsSql]
// Bases locais criadas antes das entradas do extrato recebem só esta atualização.
export const CREDITS_UPDATE_SQL = [creditsSql, grantsSql]
// Bases locais criadas antes dos encargos com pessoal recebem só esta atualização.
export const ENCARGOS_UPDATE_SQL = [encargosSql, grantsSql]
