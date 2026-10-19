import { describe, expect, it } from 'vitest'
import { diffCashImport, excelSerialToIso, parseCashSheets, parseCsvText, parseDateCell, parseDaySheet, shiftOf } from '../src/lib/cashImport.js'

// Folha de um dia como no Excel "Caixas Diárias 2026".
const daySheet = [
  ['Caixa Diária', '', '', '', '', '', ''],
  ['Data:', '02/07/2026', '', '', '', '', ''],
  ['Hóspede', 'Quarto', 'Dinheiro', 'CV', 'MB', 'city mb', 'Funcionário'],
  ['Fecho 7h', '', '12,50', '300,00', '100', '0', 'Ana'],
  ['Silva', '101', '12,50', '', '', '', 'Ana'],
  ['Fecho 15h', '', 0, 1.234, '50,5', '', 'Rui'],
  ['Costa', '102', '', '200', '', '', 'Rui'],
  ['Pereira', '103', '', '1.034', '', '', 'Rui'],
  ['Fecho 23h', '', '251,95', '1.192,18', '364,92', '4', 'Rita'],
  ['Total diário', '', '264,45', '', '', '', ''],
]

describe('datas', () => {
  it.each([
    ['02/07/2026', '2026-07-02'], ['2-7-26', '2026-07-02'], ['2026-07-02', '2026-07-02'], ['2 de julho de 2026', '2026-07-02'],
    ['02-jul-2026', '2026-07-02'], [46205, '2026-07-02'], [new Date(2026, 6, 2), '2026-07-02'], ['31/02/2026', null], ['', null],
  ])('%s → %s', (v, out) => expect(parseDateCell(v)).toBe(out))
  it('número de série do Excel', () => expect(excelSerialToIso(46023)).toBe('2026-01-01'))
})

describe('turnos', () => {
  it.each([['Fecho 7h', '7h'], ['fecho 07h', '7h'], ['FECHO 15H', '15h'], ['Fecho 23 h', '23h'], ['7h', '7h'], ['Total', null]])('%s → %s', (v, out) => expect(shiftOf(v)).toBe(out))
})

describe('folha diária', () => {
  const rows = parseDaySheet(daySheet)
  it('lê os três fechos com os valores em formato português', () => {
    expect(rows).toEqual([
      { data: '2026-07-02', turno: '7h', dinheiro: 12.5, cv: 300, mb: 100, city_mb: 0, registos: 1 },
      { data: '2026-07-02', turno: '15h', dinheiro: 0, cv: 1.234, mb: 50.5, city_mb: 0, registos: 2 },
      { data: '2026-07-02', turno: '23h', dinheiro: 251.95, cv: 1192.18, mb: 364.92, city_mb: 4, registos: 0 },
    ])
  })
  it('usa o nome da folha como data se não houver data na folha', () => {
    const noDate = daySheet.filter((_, i) => i !== 1)
    expect(parseDaySheet(noDate, '05-07-2026')[0].data).toBe('2026-07-05')
  })
})

describe('tabela simples e CSV', () => {
  it('lê Data | Turno | Dinheiro | CV | MB | City MB', () => {
    const csv = 'Data;Turno;Dinheiro;CV;MB;City MB\n01/10/2026;7h;10,00;"1.200,50";30;0\n01/10/2026;Fecho 15h;5;0;0;1,5\n'
    const { records, warnings } = parseCashSheets([{ name: 'x.csv', matrix: parseCsvText(csv) }])
    expect(warnings).toEqual([])
    expect(records).toEqual([
      { data: '2026-10-01', turno: '7h', dinheiro: 10, cv: 1200.5, mb: 30, city_mb: 0, registos: null },
      { data: '2026-10-01', turno: '15h', dinheiro: 5, cv: 0, mb: 0, city_mb: 1.5, registos: null },
    ])
  })
  it('vários dias em várias folhas e avisos para folhas sem fechos', () => {
    const d2 = daySheet.map(r => r.map(c => (c === '02/07/2026' ? '03/07/2026' : c)))
    const { records, warnings } = parseCashSheets([{ name: '02', matrix: daySheet }, { name: '03', matrix: d2 }, { name: 'Resumo', matrix: [['nada']] }])
    expect(records).toHaveLength(6)
    expect(records[0]).toMatchObject({ data: '2026-07-02', turno: '7h' })
    expect(records.at(-1)).toMatchObject({ data: '2026-07-03', turno: '23h' })
    expect(warnings).toHaveLength(1)
  })
})

describe('pré-visualização antes de gravar', () => {
  it('separa novos, alterados e iguais', () => {
    const existing = [
      { id: 1, data: '2026-07-02', turno: '7h', dinheiro: 12.5, cv: 300, mb: 100, city_mb: 0 },
      { id: 2, data: '2026-07-02', turno: '23h', dinheiro: 251.95, cv: 1192.18, mb: 300, city_mb: 4 },
    ]
    const d = diffCashImport(existing, parseDaySheet(daySheet))
    expect(d.iguais).toHaveLength(1)
    expect(d.novos.map(r => r.turno)).toEqual(['15h'])
    expect(d.alterados).toHaveLength(1)
    expect(d.alterados[0].campos).toEqual(['mb'])
    expect(d.alterados[0].antes.mb).toBe(300)
  })
})
