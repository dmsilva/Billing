import { describe, expect, it } from 'vitest'
import { findDuplicates } from '../src/lib/duplicates.js'

const rows = [
  { id: 1, data_mov: '2026-07-01', descricao: 'PAD PORT 0000833311', valor: 12.5, saldo: 1000, categoria_id: 7, origem: 'legado' },
  { id: 2, data_mov: '2026-07-02', descricao: 'PAD PORT 0000833311', valor: 12.5, saldo: 1000, categoria_id: null, origem: 'extrato' },
  { id: 3, data_mov: '2026-07-03', descricao: 'LIMPEZAS', valor: 50, saldo: 900, categoria_id: 3 },
  { id: 4, data_mov: '2026-07-03', descricao: 'LIMPEZAS', valor: 50, saldo: 850, categoria_id: 3 },
  { id: 5, data_mov: '2026-07-04', descricao: 'GASTOS MES 6709416287', valor: 300, saldo: null },
  { id: 6, data_mov: '2026-07-04', descricao: 'GASTOS MES 6709416299', valor: 300, saldo: null },
  { id: 7, data_mov: '2026-09-01', descricao: 'OUTRO', valor: 12.5, saldo: 1000 },
]
const score = r => (r.categoria_id ? 2 : 0) + (r.origem === 'legado' ? 1 : 0)

describe('movimentos duplicados', () => {
  const g = findDuplicates(rows, score)
  it('mesmo valor e saldo em datas próximas é duplicado certo e mantém o mais completo', () => {
    const certo = g.find(x => x.certeza === 'certo')
    expect(certo.manter.id).toBe(1)
    expect(certo.repetidos.map(r => r.id)).toEqual([2])
  })
  it('dois pagamentos iguais no mesmo dia com saldos diferentes não são duplicados', () => {
    expect(g.flatMap(x => [x.manter.id, ...x.repetidos.map(r => r.id)])).not.toContain(3)
  })
  it('sem saldo: mesma data, valor e descrição é provável', () => {
    const prov = g.find(x => x.certeza === 'provavel')
    expect([prov.manter.id, ...prov.repetidos.map(r => r.id)].sort()).toEqual([5, 6])
  })
  it('o mesmo valor e saldo meses depois não conta', () => {
    expect(g.flatMap(x => x.repetidos.map(r => r.id))).not.toContain(7)
    expect(g).toHaveLength(2)
  })
})
