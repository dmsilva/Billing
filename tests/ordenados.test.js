import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { casarNome, feriados, gerarOrdenados, hora } from '../src/lib/ordenados.js'

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
  const linha = (dia, mesAnterior = false) => (mesAnterior ? dia - 28 + 3 : dia + 5)
  // Galia: férias a 1 e 2, falta justificada a 9 (vermelho), feriado de 5/10 gozado
  for (const d of [1, 2]) { ws.getCell(linha(d), 4).value = 'Férias '; ws.getCell(linha(d), 4).fill = fill('FF0000FF'); ws.getCell(linha(d), 5).value = null }
  ws.getCell(linha(9), 4).fill = fill('FFFF0000')
  ws.getCell(linha(5), 4).value = 'feriado'; ws.getCell(linha(5), 5).value = null
  // Fábio: folga (verde, vazio) a 10 e 11; noites nos restantes dias de outubro
  for (const d of [10, 11]) { ws.getCell(linha(d), 6).value = null; ws.getCell(linha(d), 7).value = null; ws.getCell(linha(d), 6).fill = fill('FF00CC33') }
  // Mel não está na folha da contabilidade
  ws.getCell(linha(3), 8).value = 'Férias'
  // Férias em setembro (28/09) não contam para outubro
  ws.getCell(3, 4).value = 'Férias'
  return ficheiro(wb)
}

async function ordenados() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('salarios para contabilidade 1')
  ;['Codigo', 'Nome', '', 'Data', 'Ajud. Custo', 'Feriado', 'Noites', 'Bx. Medica', 'Bx.Parentalid', 'Bx. Seguro', 'Ferias', 'Notas'].forEach((t, i) => { ws.getCell(4, i + 1).value = t || null })
  ws.getCell('B5').value = 'Galina Sabaeva'
  ws.getCell('B6').value = 'Fábio Carvalho'; ws.getCell('L6').value = 'nota antiga'
  ws.getCell('B7').value = 'Patricia de Jesus Pereira'
  ws.getCell('F5').fill = fill('FFCCCCCC')
  ws.getCell('C8').value = { formula: 'SUM(C5:C7)' }
  const outra = wb.addWorksheet('Ordenados_Chalet')
  outra.getCell('A1').value = 'PT50 0000'
  return ficheiro(wb)
}

describe('ordenados para a contabilidade', () => {
  it('preenche feriados, noites, férias e faltas do mês certo', async () => {
    const r = await gerarOrdenados(await horario(), await ordenados(), 2026, 10)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(r.buffer)
    const ws = wb.getWorksheet('salarios para contabilidade 1')
    // Galina: trabalhou de manhã todos os dias exceto férias (1, 2), falta (9) e o feriado gozado (5)
    expect(ws.getCell('F5').value).toBeNull()
    expect(ws.getCell('G5').value).toBeNull()
    expect(ws.getCell('K5').value).toBe(2)
    expect(ws.getCell('L5').value).toBe('Férias: 1, 2/10; Falta justificada (1): 9/10')
    // Fábio: 31 dias − 2 folgas = 29 noites; trabalhou no feriado de 5/10
    expect(ws.getCell('F6').value).toBe(1)
    expect(ws.getCell('G6').value).toBe(29)
    expect(ws.getCell('L6').value).toBe('Recepcionista nocturno; Feriado trabalhado: 5/10')
    // Patrícia não está no horário: fica em branco
    expect(ws.getCell('F7').value).toBeNull()
    expect(ws.getCell('B2').value).toBe('Mês: Outubro 2026')
    // O resto do ficheiro fica igual
    expect(ws.getCell('F5').fill.fgColor.argb).toBe('FFCCCCCC')
    expect(ws.getCell('C8').value.formula).toBe('SUM(C5:C7)')
    expect(wb.getWorksheet('Ordenados_Chalet').getCell('A1').value).toBe('PT50 0000')
    expect(r.semPar.map(f => f.nome)).toEqual(['Mel'])
  })

  it('cria o ficheiro para a contabilidade só com a folha preenchida e o mesmo aspeto', async () => {
    const r = await gerarOrdenados(await horario(), await ordenados(), 2026, 10)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(r.contabilidade)
    expect(wb.worksheets.map(w => w.name)).toEqual(['Outubro 2026'])
    const ws = wb.worksheets[0]
    expect(ws.getCell('A4').value).toBe('Codigo')
    expect(ws.getCell('B5').value).toBe('Galina Sabaeva')
    expect(ws.getCell('K5').value).toBe(2)
    expect(ws.getCell('G6').value).toBe(29)
    expect(ws.getCell('L6').value).toBe('Recepcionista nocturno; Feriado trabalhado: 5/10')
    expect(ws.getCell('F5').fill.fgColor.argb).toBe('FFCCCCCC')
    expect(ws.rowCount).toBe(7)
  })

  it('avisa quando falta a folha do mês', async () => {
    await expect(gerarOrdenados(await horario(), await ordenados(), 2026, 11)).rejects.toThrow('Novembro 2026')
  })

  it('feriados de Portugal (incluindo Páscoa e Santo António)', () => {
    const f = feriados(2026)
    for (const d of ['2026-04-03', '2026-04-05', '2026-06-04', '2026-06-13', '2026-10-05', '2026-12-08']) expect(f.has(d)).toBe(true)
    expect(f.has('2026-10-31')).toBe(false)
  })

  it('lê horas em vários formatos e casa nomes', () => {
    expect(hora('23h00')).toBe(23)
    expect(hora('7h30')).toBe(7.5)
    expect(hora(23)).toBe(23)
    expect(hora(0.5)).toBe(12)
    expect(hora('*')).toBeNull()
    const nomes = [{ nome: 'Galina Sabaeva' }, { nome: 'João Sal Coxinho' }]
    expect(casarNome('Galia', nomes).nome).toBe('Galina Sabaeva')
    expect(casarNome('Joao', nomes).nome).toBe('João Sal Coxinho')
    expect(casarNome('Mel', nomes)).toBeUndefined()
  })
})
