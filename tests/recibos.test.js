import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { casarFolhaBanco, conferirRecibos, gerarFolhaBanco, lerRecibosDeLinhas, tsvBanco, mesDosRecibos, noitesDoSubsidio, numero, preencherFolhaBanco } from '../src/lib/recibos.js'

// Linhas de texto como saem do PDF do contabilista (dados fictícios).
const recibo = (via, cod, nome, base, itens, pago) => [
  'EMPRESA FICTÍCIA, LDA', 'RECIBO DE REMUNERAÇÕES', via, 'Data', '28 de Outubro de 2026',
  'Trabalhador Nome Tipo de IRS', `${cod} ${nome} Não Casado 1 dependente`,
  'Categoria Profissão Secção Vencimento Base', `Rececionista ${base} €`,
  'Descrição Quantidade Valor Unitário Descontos Abonos', ...itens,
  'Descontos 100 . 00 Abonos 1 , 200 . 00', `Valor pago em Euro ${pago}`, 'Assinatura: Total do recibo de remunerações 1 , 000 . 00',
]
const ana = ['110 Vencimento Base 30 . 00D 32 . 67 980 . 00', '126 Feriado dia 1 . 00 65 . 33 65 . 33', '181 Subsidio de noite 50% 11 . 43D 16 . 33 186 . 66', '720 IRS Automático 50 . 00']
const rui = ['110 Vencimento Base 30 . 00D 30 . 67 920 . 00', '181 Subsidio de noite 50% 20 . 00D 15 . 33 306 . 60', '415 Falta Justificada/Dia 1 . 00D 30 . 67 30 . 67']
const linhasPdf = [
  ...recibo('Original', 7, 'Ana Maria Silva', '980 . 00', ana, '1 , 193 . 72'),
  ...recibo('Duplicado', 7, 'Ana Maria Silva', '980 . 00', ana, '1 , 193 . 72'),
  ...recibo('Original', 9, 'Rui Costa', '920 . 00', rui, '1 , 288 . 92'),
  ...recibo('Duplicado', 9, 'Rui Costa', '920 . 00', rui, '1 , 288 . 92'),
]


function folhaBanco() {
  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('salarios para contabilidade 1')
  const ws = wb.addWorksheet('Ordenados_Chalet')
  ws.getRow(1).values = ['PT50 0000 0000 0000 0000 0000 1', 'Ana Silva', 'BICXPTPL', null, null, 'Setembro', 'check']
  ws.getRow(2).values = ['PT50 0000 0000 0000 0000 0000 2', 'Marta Sousa', 'BICXPTPL', null, null, 'Setembro']
  ws.getRow(3).values = ['LT00 0000 0000 0000 0003', 'Rui Costa', 'BICXLT2X', null, null, 'Setembro']
  for (const r of [1, 2, 3]) ws.getCell(`E${r}`).value = { formula: `CONCAT(CONCAT(B${r}, " Ordenado "), F${r})` }
  ws.getCell('D4').value = { formula: 'SUM(D1:D3)' }
  ws.getCell('D1').numFmt = '#,##0.00'
  return wb
}

const linha = (codigo, nome, vencimento, extra = {}) => ({ codigo, nome, vencimento, feriados: [], noites: 0, diurnos: [], faltas: [], nocturno: false, ...extra })

describe('recibos de remunerações', () => {
  it('lê só os originais, com vencimento, rubricas e valor pago', () => {
    const r = lerRecibosDeLinhas(linhasPdf)
    expect(r.map(x => [x.codigo, x.nome, x.vencimento, x.pago])).toEqual([[7, 'Ana Maria Silva', 980, 1193.72], [9, 'Rui Costa', 920, 1288.92]])
    expect(r[0].rubricas[126]).toMatchObject({ descricao: 'Feriado dia', qtd: 1, valor: 65.33 })
    expect(r[0].rubricas[181].qtd).toBe(11.43)
    expect(r[0].rubricas[720]).toMatchObject({ qtd: 0, valor: 50 })
    expect(r[1].rubricas[415].qtd).toBe(1)
  })

  it('converte números e noites', () => {
    expect(numero('3 , 000 . 00')).toBe(3000)
    expect(numero('11 . 43D')).toBe(11.43)
    expect([4.29, 10, 11.43, 20].map(noitesDoSubsidio)).toEqual([3, 7, 8, 14])
    expect(mesDosRecibos(linhasPdf)).toEqual({ ano: 2026, mes: 10 })
  })

  it('avisa quando o recibo não bate com o que foi enviado', () => {
    const recibos = lerRecibosDeLinhas(linhasPdf)
    const c = conferirRecibos(recibos, [
      linha(7, 'Ana Silva', 980, { feriados: [5], noites: 8 }),
      linha(9, 'Rui Costa', 1050, { faltas: [] }),
      linha(11, 'Marta Sousa', 900),
    ])
    expect(c.linhas[0].problemas).toEqual([])
    expect(c.linhas[1].problemas).toEqual([
      'Noites: enviaste 0, pagou 14.',
      'Faltas justificadas: no horário 0, no recibo 1.',
      'Vencimento base: na folha 1050, no recibo 920.',
    ])
    expect(c.linhas[2].problemas).toEqual(['Não tem recibo no PDF.'])
    expect(c.total).toBe(2482.64)
  })

  it('não compara as noites do recepcionista nocturno', () => {
    const recibos = lerRecibosDeLinhas(linhasPdf)
    const c = conferirRecibos(recibos, [linha(9, 'Rui Costa', 920, { nocturno: true, faltas: [3] })])
    expect(c.linhas[0].problemas).toEqual([])
  })

  it('preenche a folha do banco com o valor pago e o mês, sem mexer no resto', async () => {
    const wb = folhaBanco()
    const out = await preencherFolhaBanco(await wb.xlsx.writeBuffer(), lerRecibosDeLinhas(linhasPdf), 'Outubro')
    expect(out.semRecibo).toEqual(['Marta Sousa'])
    expect(out.semLinha).toEqual([])
    // TSV para o banco: só quem tem recibo, com as colunas da folha
    expect(out.tsv).toBe([
      ['PT50 0000 0000 0000 0000 0000 1', 'Ana Silva', 'BICXPTPL', '1193.72', 'Ana Silva Ordenado Outubro', 'Outubro', 'check'].join('\t'),
      ['LT00 0000 0000 0000 0003', 'Rui Costa', 'BICXLT2X', '1288.92', 'Rui Costa Ordenado Outubro', 'Outubro', ''].join('\t'),
      '',
    ].join('\r\n'))
    const lido = new ExcelJS.Workbook()
    await lido.xlsx.load(out.ficheiro)
    const f = lido.getWorksheet('Ordenados_Chalet')
    expect([f.getCell('D1').value, f.getCell('D2').value, f.getCell('D3').value]).toEqual([1193.72, null, 1288.92])
    expect(f.getCell('F2').value).toBe('Outubro')
    expect(f.getCell('E1').formula).toBe('CONCAT(CONCAT(B1, " Ordenado "), F1)')
    expect(f.getCell('D1').numFmt).toBe('#,##0.00')
    expect(f.getCell('G1').value).toBe('check')
  })

  it('PDF só com alguns recibos e linhas editadas: o ficheiro leva só quem fica marcado', async () => {
    const buffer = await folhaBanco().xlsx.writeBuffer()
    const soRui = lerRecibosDeLinhas(linhasPdf).filter(r => r.codigo === 9)
    const { folha, pagamentos } = await casarFolhaBanco(buffer, soRui)
    expect(pagamentos.map(p => [p.nome, p.incluir, p.valor])).toEqual([['Ana Silva', false, null], ['Marta Sousa', false, null], ['Rui Costa', true, 1288.92]])
    expect(tsvBanco(pagamentos, 'Outubro').split('\r\n').filter(Boolean).map(l => l.split('\t')[1])).toEqual(['Rui Costa'])
    // Retirar o Rui e pagar à Marta à mão
    const editados = pagamentos.map(p => (p.nome === 'Rui Costa' ? { ...p, incluir: false } : p.nome === 'Marta Sousa' ? { ...p, incluir: true, valor: 500 } : p))
    expect(tsvBanco(editados, 'Outubro')).toBe(['PT50 0000 0000 0000 0000 0000 2', 'Marta Sousa', 'BICXPTPL', '500.00', 'Marta Sousa Ordenado Outubro', 'Outubro', ''].join('\t') + '\r\n')
    const lido = new ExcelJS.Workbook()
    await lido.xlsx.load(gerarFolhaBanco(buffer, folha, editados, 'Outubro'))
    const f = lido.getWorksheet('Ordenados_Chalet')
    expect([f.getCell('D1').value, f.getCell('D2').value, f.getCell('D3').value]).toEqual([null, 500, null])
  })
})
