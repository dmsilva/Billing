// Gera o SQL de migração dos dados legados (usado por scripts/build-seed.mjs e pelos testes).
import { legacySummary } from './legacy.mjs'
import { bankHash } from '../../src/lib/bankImport.js'

export function buildSeedSql(data) {
  const summary = legacySummary(data)
const q = v => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replaceAll("'", "''")}'`)
const n = v => (v === null || v === undefined || v === '' ? 'null' : String(Number(v)))
const PROPERTIES = ["Chalet D'Ávila", 'Chalet do Lago']
const NON_EXPENSE = new Set(['Transferência — empresa'])

const categories = [...new Set([
  'Por classificar',
  ...data.transactions.map(t => t.categoria || 'Por classificar'),
  ...data.cashInvoices.map(t => t.categoria || 'Por classificar'),
])].sort((a, b) => a.localeCompare(b, 'pt'))

const out = []
out.push(`-- =====================================================================
-- FaturaClaro — 3/3 Migração dos dados reais do HTML legado (V36)
-- GERADO AUTOMATICAMENTE por scripts/build-seed.mjs — não editar à mão.
-- Idempotente: pode ser executado mais do que uma vez sem duplicar registos.
-- No fim verifica contagens e totais; se algo não bater certo, nada é gravado.
--
-- Origem: ${data.transactions.length} movimentos CGD (${data.month}), ${data.cashInvoices.length} faturas em numerário,
--         ${data.items.length} linhas de produtos, ${data.cashCloses.length} fechos de caixa (${summary.cashCloses.firstDate} a ${summary.cashCloses.lastDate}).
-- =====================================================================

begin;
`)

out.push('insert into public.properties (nome) values')
out.push(PROPERTIES.map(p => `  (${q(p)})`).join(',\n') + '\non conflict (nome) do nothing;\n')

out.push('insert into public.categories (nome, conta_como_despesa) values')
out.push(categories.map(c => `  (${q(c)}, ${NON_EXPENSE.has(c) ? 'false' : 'true'})`).join(',\n') + '\non conflict (nome) do nothing;\n')

out.push(`-- Movimentos CGD (valores positivos = saídas da conta)
insert into public.bank_transactions (legacy_idx, import_hash, data_mov, data_valor, descricao, valor, saldo, categoria_id, categoria_original, imovel_id, origem)
select v.legacy_idx, v.import_hash, v.data_mov::date, v.data_valor::date, v.descricao, v.valor, v.saldo,
       c.id, v.categoria, p.id, 'legado'
from (values`)
out.push(data.transactions.map((t, i) => `  (${i}, ${q(bankHash(t))}, ${q(t.data_mov)}, ${q(t.data_valor)}, ${q(t.descricao)}, ${n(t.valor)}::numeric, ${n(t.saldo)}::numeric, ${q(t.categoria || 'Por classificar')}, ${q(t.imovel)})`).join(',\n'))
out.push(`) as v(legacy_idx, import_hash, data_mov, data_valor, descricao, valor, saldo, categoria, imovel)
left join public.categories c on c.nome = v.categoria
left join public.properties p on p.nome = v.imovel
on conflict (legacy_idx) do nothing;
`)

out.push(`-- Faturas / recibos pagos em numerário
insert into public.invoices (legacy_idx, data, fornecedor, documento, descricao, categoria_id, imovel_id, pagamento, valor, iva_estado, estado, origem, submitted_by)
select v.legacy_idx, v.data::date, v.fornecedor, v.documento, v.descricao, c.id, p.id, v.pagamento, v.valor, 'A apurar', 'Por validar', 'legado', null
from (values`)
out.push(data.cashInvoices.map((t, i) => `  (${i}, ${q(t.data)}, ${q(t.fornecedor)}, ${q(t.documento)}, ${q(t.descricao)}, ${q(t.categoria || 'Por classificar')}, ${q(t.imovel)}, ${q(t.pagamento || 'Numerário')}, ${n(t.valor)}::numeric)`).join(',\n'))
out.push(`) as v(legacy_idx, data, fornecedor, documento, descricao, categoria, imovel, pagamento, valor)
left join public.categories c on c.nome = v.categoria
left join public.properties p on p.nome = v.imovel
on conflict (legacy_idx) do nothing;
`)

out.push(`-- Linhas de produtos identificadas nos talões/faturas (sem fatura associada no legado)
insert into public.invoice_lines (legacy_idx, produto, unidade, quantidade, valor, tipo, observacao)
values`)
out.push(data.items.map((it, i) => `  (${i}, ${q(it.item)}, ${q(it.unidade)}, ${n(it.quantidade)}, ${n(it.gasto)}, ${q(it.tipo)}, ${q(it.observacao)})`).join(',\n'))
out.push('on conflict (legacy_idx) do nothing;\n')

out.push(`-- Fechos da Caixa Diária 2026 (valores exatamente como no Excel, incluindo 3 casas decimais)
insert into public.cash_closes (data, turno, dinheiro, cv, mb, city_mb, registos, origem, updated_by)
values`)
out.push(data.cashCloses.map(c => `  (${q(c.date)}, ${q(c.shift)}, ${n(c.money)}, ${n(c.cv)}, ${n(c.mb)}, ${n(c.cityMB)}, ${n(c.records)}, 'legado', null)`).join(',\n'))
out.push('on conflict (data, turno) do nothing;\n')

const s = summary
out.push(`-- ---------- Verificação da migração ----------
do $$
declare
  v_count int; v_sum numeric;
begin
  select count(*), coalesce(sum(valor), 0) into v_count, v_sum from public.bank_transactions where origem = 'legado';
  if v_count <> ${s.bank.count} or v_sum <> ${s.bank.total} then
    raise exception 'Movimentos CGD: esperado % / %, obtido % / %', ${s.bank.count}, ${s.bank.total}, v_count, v_sum;
  end if;
  select count(*) into v_count from public.bank_transactions where origem = 'legado' and categoria_id is null;
  if v_count <> 0 then raise exception 'Há % movimentos legados sem categoria', v_count; end if;
  select count(*), coalesce(sum(valor), 0) into v_count, v_sum from public.invoices where origem = 'legado';
  if v_count <> ${s.cashInvoices.count} or v_sum <> ${s.cashInvoices.total} then
    raise exception 'Faturas numerário: esperado % / %, obtido % / %', ${s.cashInvoices.count}, ${s.cashInvoices.total}, v_count, v_sum;
  end if;
  select count(*), coalesce(sum(valor), 0) into v_count, v_sum from public.invoice_lines where legacy_idx is not null;
  if v_count <> ${s.items.count} or v_sum <> ${s.items.total} then
    raise exception 'Produtos: esperado % / %, obtido % / %', ${s.items.count}, ${s.items.total}, v_count, v_sum;
  end if;
  select count(*), coalesce(sum(dinheiro + cv + mb + city_mb), 0) into v_count, v_sum from public.cash_closes where origem = 'legado';
  if v_count <> ${s.cashCloses.count} or v_sum <> ${s.cashCloses.total} then
    raise exception 'Fechos de caixa: esperado % / %, obtido % / % (se já importou um Excel por cima, isto é normal: veja o histórico de importações)',
      ${s.cashCloses.count}, ${s.cashCloses.total}, v_count, v_sum;
  end if;
  if not exists (select 1 from public.cash_closes where data = '2026-07-02' and turno = '23h' and dinheiro = 251.95 and cv = 1192.18 and mb = 364.92) then
    raise exception 'Verificação pontual falhou: 02/07/2026 23h';
  end if;
  if not exists (select 1 from public.cash_closes where data = '2026-01-01' and turno = '7h' and dinheiro = 16 and cv = 210.68 and mb = 262) then
    raise exception 'Verificação pontual falhou: 01/01/2026 7h';
  end if;
  raise notice 'Migração verificada: % movimentos, % faturas, % produtos, % fechos.', ${s.bank.count}, ${s.cashInvoices.count}, ${s.items.count}, ${s.cashCloses.count};
end $$;

commit;
`)

  return { sql: out.join('\n'), summary }
}
