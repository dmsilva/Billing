// Carregado só em modo local: PostgreSQL em WebAssembly e os mesmos SQL que se executam no Supabase.
import stubSql from '../../supabase/test/00_stub_supabase.sql?raw'
import schemaSql from '../../supabase/01_schema.sql?raw'
import policiesSql from '../../supabase/02_policies.sql?raw'
import paymentsSql from '../../supabase/05_faturas_por_pagar.sql?raw'
import creditsSql from '../../supabase/06_entradas_transferencias.sql?raw'
import encargosSql from '../../supabase/07_encargos_pessoal.sql?raw'
import saftSql from '../../supabase/16_saft_invoicexpress.sql?raw'
import salariosSql from '../../supabase/09_salarios_banco.sql?raw'
import ordenadosSql from '../../supabase/10_ordenados_envios.sql?raw'
import artigosSql from '../../supabase/11_artigos_faturas.sql?raw'
import emailSql from '../../supabase/12_faturas_email.sql?raw'
import emailDetalheSql from '../../supabase/13_faturas_email_sem_detalhe.sql?raw'
import regrasSql from '../../supabase/14_regras_fornecedor.sql?raw'
import caixasAppSql from '../../supabase/15_caixas_app.sql?raw'
import grantsSql from '../../supabase/test/01_grants.sql?raw'
import seedSql from '../../supabase/03_seed_legacy.sql?raw'

export { PGlite } from '@electric-sql/pglite'
export { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
export const SETUP_SQL = [stubSql, schemaSql, policiesSql, paymentsSql, creditsSql, encargosSql, salariosSql, ordenadosSql, artigosSql, emailSql, emailDetalheSql, regrasSql, caixasAppSql, saftSql, grantsSql, seedSql]
// Bases locais criadas antes das faturas por pagar recebem só esta atualização.
export const PAYMENTS_UPDATE_SQL = [paymentsSql, grantsSql]
// Bases locais criadas antes das entradas do extrato recebem só esta atualização.
export const CREDITS_UPDATE_SQL = [creditsSql, grantsSql]
// Bases locais criadas antes dos encargos com pessoal recebem só esta atualização.
export const ENCARGOS_UPDATE_SQL = [encargosSql, grantsSql]
// Bases locais criadas antes do SAF-T recebem só esta atualização.
export const SAFT_UPDATE_SQL = [saftSql, grantsSql]
// Bases locais criadas antes do histórico de salários para o banco recebem só esta atualização.
export const SALARIOS_UPDATE_SQL = [salariosSql, grantsSql]
// Bases locais criadas antes do histórico de ordenados recebem só esta atualização.
export const ORDENADOS_UPDATE_SQL = [ordenadosSql, grantsSql]
// Bases locais criadas antes dos artigos lidos das faturas recebem só esta atualização.
export const ARTIGOS_UPDATE_SQL = [artigosSql, grantsSql]
// Bases locais criadas antes das faturas do email recebem só esta atualização.
export const EMAIL_UPDATE_SQL = [emailSql, emailDetalheSql, grantsSql]
// Bases locais criadas antes das regras por fornecedor recebem só esta atualização.
export const REGRAS_UPDATE_SQL = [regrasSql, grantsSql]
// Bases locais criadas antes das caixas da app da receção recebem só esta atualização.
export const CAIXAS_APP_UPDATE_SQL = [caixasAppSql, grantsSql]
