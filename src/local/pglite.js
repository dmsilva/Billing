// Carregado só em modo local: PostgreSQL em WebAssembly e os mesmos SQL que se executam no Supabase.
import stubSql from '../../supabase/test/00_stub_supabase.sql?raw'
import schemaSql from '../../supabase/01_schema.sql?raw'
import policiesSql from '../../supabase/02_policies.sql?raw'
import grantsSql from '../../supabase/test/01_grants.sql?raw'
import seedSql from '../../supabase/03_seed_legacy.sql?raw'

export { PGlite } from '@electric-sql/pglite'
export { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
export const SETUP_SQL = [stubSql, schemaSql, policiesSql, grantsSql, seedSql]
