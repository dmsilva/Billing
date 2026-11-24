import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { diasMakro, gerarExcel, gerarMapa, gerarPdf, semanasDoMes, trocarPessoa } from '../src/lib/mapaKms.js'

const faturas = [
  { data: '2026-11-20', fornecedor: 'MAKRO Cash & Carry Portugal', estado: 'Validada' },
  { data: '2026-11-20', fornecedor: 'Makro', estado: 'Por validar' },
  { data: '2026-11-13', fornecedor: 'Makro', estado: 'Validada' },
  { data: '2026-11-09', fornecedor: 'Makro', estado: 'Validada' },
  { data: '2026-11-03', fornecedor: 'Makro', estado: 'Validada' },
  { data: '2026-11-05', fornecedor: 'Makro', estado: 'Rejeitada' },
  { data: '2026-10-27', fornecedor: 'Makro', estado: 'Validada' },
  { data: '2026-11-10', fornecedor: 'Continente', estado: 'Validada' },
]

describe('mapa de kms', () => {
  it('lê os dias da Makro do mês (sem repetidos nem rejeitadas)', () => {
    expect(diasMakro(faturas, 2026, 11)).toEqual([3, 9, 13, 20])
  })

  it('semanas de segunda a sábado', () => {
    const s = semanasDoMes(2026, 11) // 1/11/2026 é domingo
    expect(s[0]).toEqual([2, 3, 4, 5, 6, 7])
    expect(s.flat()).not.toContain(1)
    expect(s.flat()).toHaveLength(25)
  })

  const mapa = gerarMapa({ ano: 2026, mes: 11, makro: diasMakro(faturas, 2026, 11) })

  it('cada dia útil é de uma só pessoa e os dias ficam repartidos', () => {
    const dias = mapa.registos.map(r => r.dia)
    expect(new Set(dias).size).toBe(dias.length)
    for (const d of semanasDoMes(2026, 11).flat()) expect(dias).toContain(d)
    const [a, b] = mapa.recibos.map(r => r.dias)
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1)
    const diasA = new Set(mapa.recibos[0].linhas.map(l => l.dia))
    for (const l of mapa.recibos[1].linhas) expect(diasA.has(l.dia)).toBe(false)
  })

  it('Ponte de Sor 2 vezes por semana e Makro nos dias das faturas', () => {
    const linhas = mapa.recibos.flatMap(r => r.linhas)
    for (const s of semanasDoMes(2026, 11)) {
      const ps = linhas.filter(l => l.local === 'Ponte de Sor' && s.includes(l.dia))
      expect(ps).toHaveLength(s.length >= 3 ? 2 : 1)
      expect(ps.every(l => l.kms === 284)).toBe(true)
    }
    expect(linhas.filter(l => l.local === 'Makro').map(l => l.dia).sort((a, b) => a - b)).toEqual([3, 9, 13, 20])
    // No dia da Makro também vão ao Chalet do Lago (mesma pessoa).
    for (const d of [3, 9, 13, 20]) expect(linhas.filter(l => l.dia === d && l.local.includes('Chalet'))).toHaveLength(1)
  })

  it('os dois recebem quase o mesmo (no máximo 50 € de diferença) em vários meses', () => {
    for (let mes = 1; mes <= 12; mes++) for (let v = 0; v < 5; v++) {
      const m = gerarMapa({ ano: 2027, mes, makro: [3, 9, 13, 20].slice(0, (mes + v) % 5), variante: v })
      const [a, b] = m.recibos
      expect(Math.abs(a.total - b.total)).toBeLessThanOrEqual(50)
      expect(Math.abs(a.dias - b.dias)).toBeLessThanOrEqual(1)
    }
    expect(Math.abs(mapa.recibos[0].total - mapa.recibos[1].total)).toBeLessThanOrEqual(50)
  })

  it('matrícula do Joel', () => {
    expect(mapa.recibos[1].viatura).toBe('AR-65-LL')
  })

  it('totais a 0,40 €/km', () => {
    for (const r of mapa.recibos) {
      expect(r.totalKms).toBe(r.linhas.reduce((s, l) => s + l.kms, 0))
      expect(r.total).toBeCloseTo(r.totalKms * 0.4, 2)
    }
  })

  it('meses diferentes dão mapas diferentes e o mesmo mês dá sempre o mesmo', () => {
    const dono = m => m.registos.map(r => `${r.dia}:${r.pessoa}`).join(',')
    expect(dono(gerarMapa({ ano: 2026, mes: 11, makro: [3, 9, 13, 20] }))).toBe(dono(mapa))
    expect(dono(gerarMapa({ ano: 2026, mes: 11, makro: [3, 9, 13, 20], variante: 1 }))).not.toBe(dono(mapa))
    const dez = gerarMapa({ ano: 2026, mes: 12 })
    const ps = m => m.recibos.flatMap(r => r.linhas).filter(l => l.local === 'Ponte de Sor').map(l => new Date(Date.UTC(m.ano, m.mes - 1, l.dia)).getUTCDay()).sort().join()
    expect(ps(dez)).not.toBe(ps(mapa))
  })

  it('trocar um dia passa-o para a outra pessoa', () => {
    const r = mapa.registos[0]
    const t = trocarPessoa(mapa, r.dia)
    expect(t.registos[0].pessoa).toBe(1 - r.pessoa)
    expect(t.recibos[0].totalKms + t.recibos[1].totalKms).toBe(mapa.recibos[0].totalKms + mapa.recibos[1].totalKms)
  })

  it('gera Excel e PDF', async () => {
    const buf = await gerarExcel(mapa)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.worksheets[0]
    expect(ws.name).toBe('Novembro 2026')
    expect(ws.getCell('A1').value).toBe('Compensação por deslocação em viatura própria')
    expect(ws.getCell('B2').value).toBe('Patricia Jesus Pereira Unip Lda')
    const pdf = new Uint8Array(await gerarPdf(mapa))
    expect(String.fromCharCode(...pdf.slice(0, 4))).toBe('%PDF')
  })
})
