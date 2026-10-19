// Dados que o HTML legado guardava apenas no navegador (localStorage).
// O botão "Exportar dados deste navegador" do legado gera um JSON com estas chaves.
import { parseMoney, sameAmount } from './money.js'
import { diffCashImport } from './cashImport.js'

export const LEGACY_KEYS = {
  categories: 'despesas_app_categories_v2',
  cashCloses: 'faturaclaro_cash_closes_v1',
  tpa: 'faturaclaro_tpa_v1',
  envelopes: 'faturaclaro_envelopes_v2',
}

function parseMaybe(v, fallback) {
  if (v == null) return fallback
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return fallback }
}

export function readLegacyExport(json) {
  const ls = json?.localStorage || json || {}
  return {
    categories: parseMaybe(ls[LEGACY_KEYS.categories], {}) || {},
    cashCloses: parseMaybe(ls[LEGACY_KEYS.cashCloses], []) || [],
    tpa: parseMaybe(ls[LEGACY_KEYS.tpa], []) || [],
    envelopes: parseMaybe(ls[LEGACY_KEYS.envelopes], []) || [],
  }
}

const num = v => parseMoney(v) ?? 0
const legacyType = t => (t === 'money' ? 'dinheiro' : t)

// Calcula o que vai ser aplicado, sem gravar nada.
// db: { bank, categories, closes, checks, tpa }
export function planLegacyImport(data, db) {
  const catByName = new Map(db.categories.map(c => [c.nome, c]))
  const bankByIdx = new Map(db.bank.filter(t => t.legacy_idx != null).map(t => [String(t.legacy_idx), t]))
  const categoryChanges = []
  const newCategories = new Set()
  const skipped = []
  for (const [idx, nome] of Object.entries(data.categories)) {
    const t = bankByIdx.get(String(idx))
    if (!t) { skipped.push(`Movimento ${idx} não existe`); continue }
    const current = db.categories.find(c => c.id === t.categoria_id)?.nome
    if (current === nome) continue
    // Só aplica se a categoria ainda não foi mudada na nova aplicação.
    if (current !== t.categoria_original) { skipped.push(`${t.descricao}: já foi reclassificado na nova aplicação`); continue }
    if (!catByName.has(nome)) newCategories.add(nome)
    categoryChanges.push({ bank_transaction_id: t.id, legacy_idx: Number(idx), descricao: t.descricao, de: current, para: nome })
  }

  const closes = data.cashCloses
    .filter(c => c && c.date && c.shift)
    .map(c => ({ data: c.date, turno: c.shift, dinheiro: num(c.money), cv: num(c.cv), mb: num(c.mb), city_mb: num(c.cityMB), registos: c.records ?? null }))
  const closesDiff = diffCashImport(db.closes, closes)

  const closeByKey = new Map(db.closes.map(c => [`${c.data}|${c.turno}`, c]))
  const checkKeys = new Set(db.checks.map(c => `${c.cash_close_id}|${c.tipo}`))
  const checks = []
  for (const e of data.envelopes) {
    if (!e || e.actual === undefined || e.actual === null) continue
    const close = closeByKey.get(`${e.date}|${e.shift}`)
    const tipo = legacyType(e.type)
    if (!['cv', 'mb', 'dinheiro'].includes(tipo)) continue
    const esperado = e.expected ?? (close ? close[tipo] : null)
    const row = { data: e.date, turno: e.shift, tipo, valor_esperado: Number(esperado ?? 0), valor_real: num(e.actual) }
    if (close && checkKeys.has(`${close.id}|${tipo}`)) { skipped.push(`Conferência ${e.date} ${e.shift} ${tipo} já existe`); continue }
    checks.push(row)
  }

  const tpaByKey = new Map(db.tpa.map(t => [`${t.data}|${t.turno}`, t]))
  const tpa = data.tpa
    .filter(t => t && t.date && t.shift)
    .map(t => ({ data: t.date, turno: t.shift, cv: num(t.cv), mb: num(t.mb) }))
    .filter(t => {
      const cur = tpaByKey.get(`${t.data}|${t.turno}`)
      return !cur || !sameAmount(cur.cv, t.cv) || !sameAmount(cur.mb, t.mb)
    })

  return { categoryChanges, newCategories: [...newCategories], closesDiff, checks, tpa, skipped }
}
