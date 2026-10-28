import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { casarNome, feriados, gerarExcel, gerarPdf, hora, lerData, lerOrdenados, lerVencimento } from '../src/lib/ordenados.js'

const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const ficheiro = async wb => { const b = await wb.xlsx.writeBuffer(); return { name: 'x.xlsx', arrayBuffer: async () => b } }

// Horário de outubro de 2026: começa a segunda 28/09 e acaba no domingo 01/11.
async function horario() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Outubro 2026')
  ws.getCell('B1').value = 'DIA'; ws.mergeCells('B1:C2')
  ws.getCell('D1').value = 'Galia'; ws.mergeCells('D1:E1')
  ws.getCell('F1').value = 'Fábio'; ws.mergeCells('F1:G1')
  ws.getCell('H1').value = 'Mel'; ws.mergeCells('H1:I1')
  const dias = [28, 29, 30, ...Array.from({ length: 31 }, (_, i) => i + 1), 1]
  dias.forEach((d, i) => {
    const r = i + 3
    ws.getCell(r, 3).value = d
    ws.getCell(r, 4).value = '7h00'; ws.getCell(r, 5).value = '15h30'
    ws.getCell(r, 6).value = 23; ws.getCell(r, 7).value = 7
  })
  const linha = dia => dia + 5
  // Galia: férias a 1 e 2, falta justificada a 9 (vermelho), feriado de 5/10 gozado
  for (const d of [1, 2]) { ws.getCell(linha(d), 4).value = 'Férias '; ws.getCell(linha(d), 4).fill = fill('FF0000FF'); ws.getCell(linha(d), 5).value = null }
  ws.getCell(linha(9), 4).fill = fill('FFFF0000')
  ws.getCell(linha(5), 4).value = 'feriado'; ws.getCell(linha(5), 5).value = null
  // Fábio: folga (verde, vazio) a 10 e 11; noites nos restantes dias de outubro
  for (const d of [10, 11]) { ws.getCell(linha(d), 6).value = null; ws.getCell(linha(d), 7).value = null; ws.getCell(linha(d), 6).fill = fill('FF00CC33') }
  // … e horário de dia a 20 e 27
  for (const d of [20, 27]) { ws.getCell(linha(d), 6).value = 15; ws.getCell(linha(d), 7).value = 23 }
  // Mel não está na folha da contabilidade
  ws.getCell(linha(3), 8).value = 'Férias'
  // Férias em setembro (28/09) não contam para outubro
  ws.getCell(3, 4).value = 'Férias'
  return ficheiro(wb)
}

async function ordenados() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('salarios para contabilidade 1')
  ws.getCell('B1').value = 'Empresa, Lda.'
  ;[null, null, 'Venc.', 'Admissao', 130, 126, 181, 416, 413, 417, 170, null, 'IRS'].forEach((t, i) => { ws.getCell(3, i + 1).value = t })
  ;['Codigo', 'Nome', '', 'Data', 'Ajud. Custo', 'Feriado', 'Noites', 'Bx. Medica', 'Bx.Parentalid', 'Bx. Seguro', 'Ferias', 'Notas'].forEach((t, i) => { ws.getCell(4, i + 1).value = t || null })
  ws.getRow(5).values = [27, 'Galina Sabaeva', 1150, new Date(Date.UTC(2019, 0, 1))]
  ws.getRow(6).values = [124, 'Fábio Carvalho', 920, '16/10/2025', null, null, null, null, null, null, null, 'nota antiga']
  ws.getRow(7).values = [1, 'Patricia de Jesus Pereira', '€3.000.00', '11/01/2014']
  const outra = wb.addWorksheet('Ordenados_Chalet')
  outra.getCell('A1').value = 'PT50 0000'
  return ficheiro(wb)
}

describe('ordenados para a contabilidade', () => {
  it('conta feriados, noites, férias e faltas do mês e lê os dados da folha', async () => {
    const d = await lerOrdenados(await horario(), await ordenados(), 2026, 10)
    expect(d.empresa).toBe('Empresa, Lda.')
    expect(d.codigos).toMatchObject({ ajudCusto: 130, feriado: 126, noites: 181, bxMedica: 416, bxParentalidade: 413, bxSeguro: 417, ferias: 170 })
    const [galina, fabio, patricia] = d.linhas
    expect(galina).toMatchObject({ codigo: 27, vencimento: 1150, feriados: [], noites: 0, ferias: [1, 2], faltas: [9], nota: '' })
    // Recepcionista nocturno: sem noites, com os dias de horário de dia nas notas
    expect(fabio).toMatchObject({ codigo: 124, vencimento: 920, feriados: [5], noites: 0, diurnos: [20, 27], nota: 'Recepcionista nocturno. Horário diurno: 20, 27/10 (2 dias)' })
    expect(fabio.admissao).toBe('16/10/2025')
    expect(galina.admissao).toBe('1/1/2019')
    expect(patricia).toMatchObject({ vencimento: 3000, noHorario: false })
    expect(d.semPar.map(f => f.nome)).toEqual(['Mel'])
  })

  it('gera o Excel com cabeçalho, linhas alternadas e só as notas escritas', async () => {
    const d = await lerOrdenados(await horario(), await ordenados(), 2026, 10)
    d.linhas[0].nota = 'Falta justificada a 9/10'
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await gerarExcel(d))
    expect(wb.worksheets.map(w => w.name)).toEqual(['Outubro 2026'])
    const ws = wb.worksheets[0]
    expect(ws.getRow(4).values.slice(1)).toEqual(['Codigo', 'Nome', 'Venc.', 'Data', 'Ajud. Custo', 'Feriado', 'Noites', 'Bx. Médica', 'Bx. Parentalid.', 'Bx. Seguro', 'Férias', 'Notas', 'IRS'])
    expect(ws.getRow(3).values.slice(4, 11)).toEqual(['Admissão', 130, 126, 181, 416, 413, 417])
    expect(ws.getRow(5).values.slice(1, 3)).toEqual([27, 'Galina Sabaeva'])
    expect(ws.getCell('K5').value).toBe(2)
    expect(ws.getCell('L5').value).toBe('Falta justificada a 9/10')
    expect(ws.getCell('G6').value).toBeNull()
    expect(ws.getCell('L6').value).toBe('Recepcionista nocturno. Horário diurno: 20, 27/10 (2 dias)')
    expect(ws.getCell('L7').value).toBeNull()
    // Linhas alternadas: branco, cinza, branco
    expect(ws.getCell('A5').fill?.fgColor?.argb).toBeUndefined()
    expect(ws.getCell('L6').fill.fgColor.argb).toBe('FFE5E5E5')
    expect(ws.getCell('A7').fill?.fgColor?.argb).toBeUndefined()
  })

  it('gera o PDF', async () => {
    const d = await lerOrdenados(await horario(), await ordenados(), 2026, 10)
    const pdf = new Uint8Array(await gerarPdf(d))
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
  })

  it('avisa quando falta a folha do mês', async () => {
    await expect(lerOrdenados(await horario(), await ordenados(), 2026, 11)).rejects.toThrow('Novembro 2026')
  })

  it('feriados de Portugal (incluindo Páscoa e Santo António)', () => {
    const f = feriados(2026)
    for (const d of ['2026-04-03', '2026-04-05', '2026-06-04', '2026-06-13', '2026-10-05', '2026-12-08']) expect(f.has(d)).toBe(true)
    expect(f.has('2026-10-31')).toBe(false)
  })

  it('lê horas, vencimentos, datas e casa nomes', () => {
    expect(hora('23h00')).toBe(23)
    expect(hora('7h30')).toBe(7.5)
    expect(hora(0.5)).toBe(12)
    expect(hora('*')).toBeNull()
    expect(lerVencimento('€3.000.00')).toBe(3000)
    expect(lerVencimento(980)).toBe(980)
    expect(lerData('18/2/2025')).toBe('18/2/2025')
    expect(lerData(new Date(Date.UTC(2026, 11, 3)))).toBe('12/3/2026')
    const nomes = [{ nome: 'Galina Sabaeva' }, { nome: 'João Sal Coxinho' }]
    expect(casarNome('Galia', nomes).nome).toBe('Galina Sabaeva')
    expect(casarNome('Joao', nomes).nome).toBe('João Sal Coxinho')
    expect(casarNome('Mel', nomes)).toBeUndefined()
  })
})
