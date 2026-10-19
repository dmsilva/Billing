import { join } from 'node:path'
import { loadLegacyData } from '../scripts/lib/legacy.mjs'

export const legacy = loadLegacyData(join(import.meta.dirname, '..', 'legacy', 'index.html'))

// Reproduz em memória o que o 03_seed_legacy.sql grava no Supabase.
export function legacyAsDb() {
  const propNames = ["Chalet D'Ávila", 'Chalet do Lago']
  const catNames = [...new Set(['Por classificar', ...legacy.transactions.map(t => t.categoria), ...legacy.cashInvoices.map(t => t.categoria)])]
  const categories = catNames.map((nome, i) => ({ id: i + 1, nome, conta_como_despesa: nome !== 'Transferência — empresa', ativo: true }))
  const properties = propNames.map((nome, i) => ({ id: i + 1, nome, ativo: true }))
  const catId = n => categories.find(c => c.nome === n)?.id
  const propId = n => properties.find(p => p.nome === n)?.id
  const bank = legacy.transactions.map((t, i) => ({ id: i + 1, legacy_idx: i, data_mov: t.data_mov, data_valor: t.data_valor, descricao: t.descricao, valor: t.valor, saldo: t.saldo, categoria_id: catId(t.categoria), categoria_original: t.categoria, imovel_id: propId(t.imovel), origem: 'legado' }))
  const invoices = legacy.cashInvoices.map((t, i) => ({ id: i + 1, legacy_idx: i, data: t.data, fornecedor: t.fornecedor, documento: t.documento, descricao: t.descricao, categoria_id: catId(t.categoria), imovel_id: propId(t.imovel), pagamento: t.pagamento, valor: t.valor, estado: 'Por validar', origem: 'legado' }))
  const lines = legacy.items.map((it, i) => ({ id: i + 1, legacy_idx: i, invoice_id: null, produto: it.item, unidade: it.unidade, quantidade: it.quantidade, valor: it.gasto, tipo: it.tipo, observacao: it.observacao }))
  const closes = legacy.cashCloses.map((c, i) => ({ id: i + 1, data: c.date, turno: c.shift, dinheiro: c.money, cv: c.cv, mb: c.mb, city_mb: c.cityMB, registos: c.records, origem: 'legado' }))
  return { categories, properties, bank, invoices, lines, closes, catsById: new Map(categories.map(c => [c.id, c])), propsById: new Map(properties.map(p => [p.id, p.nome])) }
}
