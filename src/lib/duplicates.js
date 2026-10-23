// Movimentos do extrato repetidos (o mesmo extrato importado duas vezes, em formatos
// diferentes, ou um mês já migrado do legado importado outra vez).
//
// "Certo": mesmo valor e mesmo saldo depois do movimento, com datas até 5 dias de diferença
//          (o PDF e o Excel da CGD nem sempre trazem a mesma data de movimento).
// "Provável": sem saldo para comparar, mesma data, mesmo valor e mesma descrição. Pode ser um
//          pagamento repetido a sério, por isso confirma antes de apagar.
// Nada é apagado aqui: só se agrupam os movimentos e se sugere qual manter.
import { descriptionStem } from './bankImport.js'

const cents = v => Math.round(Number(v) * 100)
const day = d => Date.parse(`${d}T00:00:00Z`) / 86400000

// rows: [{ id, data_mov, descricao, valor, saldo, ... }]; score(row) maior = mais informação (fica).
export function findDuplicates(rows, score = () => 0) {
  const groups = []
  const used = new Set()
  const push = (list, certeza) => {
    const sorted = [...list].sort((a, b) => score(b) - score(a) || a.id - b.id)
    groups.push({ certeza, manter: sorted[0], repetidos: sorted.slice(1) })
    for (const r of list) used.add(r.id)
  }

  const bySaldo = new Map()
  for (const r of rows) {
    if (r.saldo == null || r.saldo === '') continue
    const k = `${cents(r.valor)}|${cents(r.saldo)}`
    bySaldo.set(k, [...(bySaldo.get(k) || []), r])
  }
  for (const list of bySaldo.values()) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => String(a.data_mov).localeCompare(String(b.data_mov)))
    // Junta só os que estão perto no tempo (o mesmo valor e saldo meses depois é coincidência).
    let cluster = [sorted[0]]
    for (const r of sorted.slice(1)) {
      if (day(r.data_mov) - day(cluster[0].data_mov) <= 5) cluster.push(r)
      else { if (cluster.length > 1) push(cluster, 'certo'); cluster = [r] }
    }
    if (cluster.length > 1) push(cluster, 'certo')
  }

  const byText = new Map()
  for (const r of rows) {
    if (used.has(r.id)) continue
    const k = `${r.data_mov}|${cents(r.valor)}|${descriptionStem(r.descricao)}`
    byText.set(k, [...(byText.get(k) || []), r])
  }
  for (const list of byText.values()) {
    // Com saldos diferentes em todos são movimentos distintos (ex.: dois pagamentos iguais no mesmo dia).
    const saldos = new Set(list.filter(r => r.saldo != null && r.saldo !== '').map(r => cents(r.saldo)))
    if (list.length > 1 && saldos.size < list.length) push(list, 'provavel')
  }

  return groups.sort((a, b) => String(b.manter.data_mov).localeCompare(String(a.manter.data_mov)))
}
