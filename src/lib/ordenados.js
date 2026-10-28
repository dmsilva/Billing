import { parseMoney } from './money.js'

// Preenche a folha "Ordenados para contabilidade" a partir do horário dos funcionários.
// Horário: uma folha por mês ("Outubro 2026"), nomes na linha 1 (entrada/saída em duas colunas),
// dia do mês na coluna a seguir a "DIA". Cores: azul = férias, vermelho = falta justificada,
// verde = folga. Noite = turno das 23h às 7h. Feriados = calendário português (com Santo António, Lisboa).

export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const AZUL = 'FF0000FF'
const VERMELHOS = ['FFFF0000', 'FFE06666']

export function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function valor(cell) {
  const v = cell.value
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('')
    if ('result' in v) return v.result
    if ('text' in v) return v.text
  }
  return v
}

const texto = cell => norm(valor(cell) instanceof Date ? '' : valor(cell))
const cor = cell => (cell.fill?.type === 'pattern' && cell.fill.fgColor?.argb ? cell.fill.fgColor.argb.toUpperCase() : '')

function pascoa(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  return new Date(Date.UTC(y, Math.floor(n / 31) - 1, (n % 31) + 1))
}

const iso = d => d.toISOString().slice(0, 10)
const maisDias = (d, n) => new Date(d.getTime() + n * 86400000)

export function feriados(ano) {
  const fixos = [[1, 1], [4, 25], [5, 1], [6, 10], [6, 13], [8, 15], [10, 5], [11, 1], [12, 1], [12, 8], [12, 25]]
  const p = pascoa(ano)
  return new Set([...fixos.map(([m, d]) => iso(new Date(Date.UTC(ano, m - 1, d)))), iso(maisDias(p, -2)), iso(p), iso(maisDias(p, 60))])
}

export function hora(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v < 1 ? v * 24 : v // 0,2916 = 7h00 numa célula de hora do Excel
  if (v instanceof Date) return v.getUTCHours() + v.getUTCMinutes() / 60
  const m = String(v).match(/^\s*(\d{1,2})\s*(?:h|:)?\s*(\d{2})?/)
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0) : null
}

// Folhas do horário que correspondem a um mês ("Outubro 2026" → { ano: 2026, mes: 10 }).
export function mesesDoHorario(wb) {
  return wb.worksheets.map(ws => {
    const t = norm(ws.name)
    const mes = MESES.findIndex(m => t.startsWith(norm(m))) + 1
    const ano = Number(t.match(/\d{4}/)?.[0])
    return mes && ano ? { folha: ws.name, ano, mes } : null
  }).filter(Boolean)
}

const principal = cell => !cell.isMerged || cell.master === cell

export function lerHorario(wb, ano, mes) {
  const ws = wb.worksheets.find(w => { const t = norm(w.name); return t.startsWith(norm(MESES[mes - 1])) && t.includes(String(ano)) })
  if (!ws) throw new Error(`Não encontrei a folha "${MESES[mes - 1][0].toUpperCase()}${MESES[mes - 1].slice(1)} ${ano}" no horário.`)
  const linha1 = ws.getRow(1)
  let diaCol = null
  const funcionarios = []
  linha1.eachCell((cell, col) => {
    const t = texto(cell)
    if (!t || !principal(cell)) return
    if (t === 'dia') { diaCol ??= col + 1; return }
    if (t !== '?' && typeof valor(cell) === 'string') funcionarios.push({ col, nome: String(valor(cell)).trim() })
  })
  if (!diaCol) throw new Error(`A folha "${ws.name}" não tem a coluna "DIA" na primeira linha.`)

  const linhas = []
  for (let r = 3; r <= ws.rowCount; r++) {
    const d = valor(ws.getCell(r, diaCol))
    if (typeof d === 'number') linhas.push({ r, dia: d })
  }
  if (!linhas.length) throw new Error(`A folha "${ws.name}" não tem dias.`)
  // A folha começa no fim do mês anterior (ex.: 28, 29, 30, 1, 2…).
  let data = linhas[0].dia === 1 ? new Date(Date.UTC(ano, mes - 1, 1)) : new Date(Date.UTC(ano, mes - 1, 0))
  if (linhas[0].dia !== 1) data = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), linhas[0].dia))
  const fer = feriados(ano)
  const datas = linhas.map((l, i) => ({ ...l, data: maisDias(data, i) }))

  return {
    folha: ws.name,
    mes,
    funcionarios: funcionarios.map(({ col, nome }) => {
      const res = { nome, feriados: [], noites: 0, diurnos: [], ferias: [], faltas: [] }
      for (const { r, data: d } of datas) {
        if (d.getUTCMonth() !== mes - 1 || d.getUTCFullYear() !== ano) continue
        const dia = d.getUTCDate()
        const e = ws.getCell(r, col), s = ws.getCell(r, col + 1)
        const txt = `${texto(e)} ${texto(s)}`
        if (/\bferias\b/.test(txt) || cor(e) === AZUL) { res.ferias.push(dia); continue }
        if (txt.includes('falta') || VERMELHOS.includes(cor(e))) { res.faltas.push(dia); continue }
        const hi = hora(valor(e)), hf = hora(valor(s))
        if (hi === null || txt.includes('feriado')) continue // folga, feriado gozado ou vazio
        const marcadoFeriado = ws.getRow(r).values.some(v => typeof v === 'string' && norm(v) === 'feriado')
        if (fer.has(iso(d)) || marcadoFeriado) res.feriados.push(dia)
        if (hi >= 22 && hf !== null && hf <= 8) res.noites++
        else res.diurnos.push(dia)
      }
      return res
    }),
  }
}

// Recepcionistas nocturnos (pelo primeiro nome): a contabilidade já conta as noites deles,
// por isso não se põem noites; a nota diz quais os dias em que fizeram horário de dia.
// As outras notas escreve-as o Daniel na página.
export const NOCTURNOS = ['fabio']
const nocturno = nome => NOCTURNOS.includes(norm(nome).split(' ')[0])

// "Galia" no horário corresponde a "Galina Sabaeva" na contabilidade.
export function casarNome(nomeHorario, nomes) {
  const a = norm(nomeHorario).split(' ')[0]
  const primeiro = n => norm(n).split(' ')[0]
  return nomes.find(n => primeiro(n.nome) === a)
    || (a.length >= 4 ? nomes.find(n => { const b = primeiro(n.nome); return b.startsWith(a.slice(0, 4)) || a.startsWith(b.slice(0, 4)) }) : undefined)
}

// "€3.000.00" → 3000; "1150" → 1150.
export function lerVencimento(v) {
  if (typeof v === 'number') return v
  const s = String(v ?? '').replace(/[^\d.,]/g, '')
  const m = s.match(/^(.*)[.,](\d{2})$/)
  return m ? Number(m[1].replace(/[.,]/g, '') + '.' + m[2]) : parseMoney(s)
}

// Data de admissão tal como aparece no Excel: as datas foram escritas dia/mês mas o Excel guardou-as
// como mês/dia (ex.: "12/3/2026" fica 3 de dezembro), por isso mostra-se o texto como está à vista.
export function lerData(v) {
  if (v instanceof Date) return `${v.getUTCMonth() + 1}/${v.getUTCDate()}/${v.getUTCFullYear()}`
  return v === null || v === undefined ? '' : String(v).trim()
}

// Lê a folha "para contabilidade": empresa, códigos das colunas (linha acima dos títulos) e funcionários.
export function lerFolhaContabilidade(wb) {
  const ws = wb.worksheets.find(w => norm(w.name).includes('contabilidade'))
  if (!ws) throw new Error('O Excel dos ordenados não tem a folha "para contabilidade".')
  let hdr = null
  const cols = {}
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !hdr; r++) {
    ws.getRow(r).eachCell((cell, col) => { const t = texto(cell); if (['codigo', 'nome', 'feriado', 'noites', 'ferias', 'notas'].includes(t)) cols[t] = col })
    if (cols.feriado && cols.noites) hdr = r
  }
  if (!hdr) throw new Error('Não encontrei as colunas Feriado e Noites na folha da contabilidade.')
  const nomeCol = cols.nome || 2
  const codigoCol = cols.codigo || 1
  const linhaAcima = ws.getRow(hdr - 1)
  const venCol = [...Array(20).keys()].map(i => i + 1).find(c => texto(linhaAcima.getCell(c)).startsWith('venc')) || nomeCol + 1
  const admCol = [...Array(20).keys()].map(i => i + 1).find(c => texto(linhaAcima.getCell(c)).startsWith('admiss')) || nomeCol + 2
  // Códigos das rubricas (130 = Ajud. Custo, 126 = Feriado, …), na linha acima dos títulos.
  const codigos = {}
  linhaAcima.eachCell((cell, col) => { const v = valor(cell); if (typeof v === 'number') codigos[col] = v })
  const ajud = Object.keys(codigos).map(Number).find(c => texto(ws.getCell(hdr, c)).startsWith('ajud'))
  const titulo = c => texto(ws.getCell(hdr, c))
  const codigoDe = pref => { const c = Object.keys(codigos).map(Number).find(col => titulo(col).replace(/[^a-z]/g, '').startsWith(pref)); return c ? codigos[c] : null }
  const funcionarios = []
  for (let r = hdr + 1; r <= ws.rowCount; r++) {
    const nome = valor(ws.getCell(r, nomeCol))
    if (typeof nome !== 'string' || !nome.trim()) continue
    funcionarios.push({
      codigo: valor(ws.getCell(r, codigoCol)) ?? null,
      nome: nome.trim(),
      vencimento: lerVencimento(valor(ws.getCell(r, venCol))),
      admissao: lerData(valor(ws.getCell(r, admCol))),
    })
  }
  return {
    empresa: String(valor(ws.getCell(1, nomeCol)) ?? '').trim(),
    codigos: {
      ajudCusto: ajud ? codigos[ajud] : codigoDe('ajud'), feriado: codigoDe('feriado'), noites: codigoDe('noites'),
      bxMedica: codigoDe('bxmedica'), bxParentalidade: codigoDe('bxparental'), bxSeguro: codigoDe('bxseguro'), ferias: codigoDe('ferias'),
    },
    funcionarios,
  }
}

// Junta a folha da contabilidade ao horário do mês.
export function montarOrdenados(folha, horario) {
  const linhas = folha.funcionarios.map(f => ({
    ...f, feriados: [], noites: 0, diurnos: [], ferias: [], faltas: [], noHorario: false,
    nocturno: nocturno(f.nome), nota: nocturno(f.nome) ? 'Recepcionista nocturno' : '',
  }))
  const semPar = []
  for (const h of horario.funcionarios) {
    const alvo = casarNome(h.nome, linhas)
    if (!alvo) { if (h.feriados.length || h.noites || h.ferias.length || h.faltas.length) semPar.push(h); continue }
    Object.assign(alvo, { feriados: h.feriados, noites: h.noites, diurnos: h.diurnos, ferias: h.ferias, faltas: h.faltas, noHorario: true, nomeHorario: h.nome })
    if (alvo.nocturno) {
      alvo.noites = 0
      if (h.diurnos.length) alvo.nota = `Recepcionista nocturno. Horário diurno: ${h.diurnos.join(', ')}/${String(horario.mes).padStart(2, '0')} (${h.diurnos.length} ${h.diurnos.length === 1 ? 'dia' : 'dias'})`
    }
  }
  return { linhas, semPar }
}

export async function lerOrdenados(ficheiroHorario, ficheiroOrdenados, ano, mes) {
  const { default: ExcelJS } = await import('exceljs')
  const wbH = new ExcelJS.Workbook()
  await wbH.xlsx.load(await ficheiroHorario.arrayBuffer())
  const wbO = new ExcelJS.Workbook()
  await wbO.xlsx.load(await ficheiroOrdenados.arrayBuffer())
  const horario = lerHorario(wbH, ano, mes)
  const folha = lerFolhaContabilidade(wbO)
  return { ...folha, ...montarOrdenados(folha, horario), folhaHorario: horario.folha, ano, mes }
}

export async function lerMesesDoFicheiro(ficheiro) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await ficheiro.arrayBuffer())
  return mesesDoHorario(wb)
}

export const nomeMes = (ano, mes) => `${MESES[mes - 1][0].toUpperCase()}${MESES[mes - 1].slice(1)} ${ano}`

// Colunas do ficheiro para a contabilidade (iguais às da folha original).
export const COLUNAS = [
  { titulo: 'Codigo', largura: 9, mm: 13, campo: 'codigo' },
  { titulo: 'Nome', largura: 38, mm: 58, campo: 'nome', esquerda: true },
  { titulo: 'Venc.', largura: 12, mm: 20, campo: 'vencimento' },
  { titulo: 'Data', cima: 'Admissão', largura: 12, mm: 19, campo: 'admissao' },
  { titulo: 'Ajud. Custo', codigo: 'ajudCusto', largura: 11, mm: 17 },
  { titulo: 'Feriado', codigo: 'feriado', largura: 9, mm: 14, campo: l => l.feriados.length || null },
  { titulo: 'Noites', codigo: 'noites', largura: 9, mm: 14, campo: l => l.noites || null },
  { titulo: 'Bx. Médica', codigo: 'bxMedica', largura: 11, mm: 17 },
  { titulo: 'Bx. Parentalid.', codigo: 'bxParentalidade', largura: 14, mm: 21 },
  { titulo: 'Bx. Seguro', codigo: 'bxSeguro', largura: 11, mm: 17 },
  { titulo: 'Férias', codigo: 'ferias', largura: 9, mm: 13, campo: l => l.ferias.length || null },
  { titulo: 'Notas', largura: 45, campo: 'nota', esquerda: true },
  { titulo: 'IRS', largura: 9, mm: 11 },
]

const valorDe = (l, c) => (typeof c.campo === 'function' ? c.campo(l) : c.campo ? l[c.campo] : null)
const AZUL_CAB = 'FF99CCFF', CINZA = 'FFE5E5E5', BORDA = 'FF9AA5B1'
const fmtEuro = v => (v === null || v === undefined ? '' : `${v.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`)

export async function gerarExcel(dados) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(nomeMes(dados.ano, dados.mes), { views: [{ state: 'frozen', ySplit: 4 }] })
  COLUNAS.forEach((c, i) => { ws.getColumn(i + 1).width = c.largura })
  const n = COLUNAS.length
  const borda = { style: 'thin', color: { argb: BORDA } }
  const bordas = { top: borda, left: borda, bottom: borda, right: borda }

  ws.mergeCells(1, 1, 1, n)
  Object.assign(ws.getCell(1, 1), { value: dados.empresa, font: { bold: true, size: 14 } })
  ws.mergeCells(2, 1, 2, n)
  Object.assign(ws.getCell(2, 1), { value: `Ordenados de ${nomeMes(dados.ano, dados.mes)}`, font: { size: 11, color: { argb: 'FF555555' } } })
  ws.getRow(1).height = 22

  COLUNAS.forEach((c, i) => {
    const cima = ws.getCell(3, i + 1)
    cima.value = c.cima || (c.codigo ? dados.codigos[c.codigo] ?? null : null)
    const tit = ws.getCell(4, i + 1)
    tit.value = c.titulo
    for (const cell of [cima, tit]) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_CAB } }
      cell.font = { bold: true }
      cell.alignment = { horizontal: c.esquerda ? 'left' : 'center', vertical: 'middle' }
      cell.border = bordas
    }
  })

  dados.linhas.forEach((l, k) => {
    const r = 5 + k
    const row = ws.getRow(r)
    row.height = 18
    COLUNAS.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      const v = valorDe(l, c)
      cell.value = v === '' || v === undefined ? null : v
      if (c.campo === 'vencimento') cell.numFmt = '#,##0.00 "€"'
      cell.alignment = { horizontal: c.esquerda ? 'left' : 'center', vertical: 'middle', wrapText: c.campo === 'nota' }
      if (c.campo === 'vencimento') cell.alignment = { horizontal: 'right', vertical: 'middle' }
      cell.border = bordas
      if (k % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA } }
    })
  })
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
  return wb.xlsx.writeBuffer()
}

export async function gerarPdf(dados) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.setFontSize(13); doc.setFont('helvetica', 'bold')
  doc.text(dados.empresa, 10, 12)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  doc.text(`Ordenados de ${nomeMes(dados.ano, dados.mes)}`, 10, 18)
  const formatar = (l, c) => {
    const v = valorDe(l, c)
    if (c.campo === 'vencimento') return fmtEuro(v)
    return v === null || v === undefined ? '' : String(v)
  }
  const azul = [153, 204, 255]
  autoTable(doc, {
    startY: 22,
    head: [
      COLUNAS.map(c => c.cima || (c.codigo ? String(dados.codigos[c.codigo] ?? '') : '')),
      COLUNAS.map(c => c.titulo),
    ],
    body: dados.linhas.map(l => COLUNAS.map(c => formatar(l, c))),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.4, lineColor: [154, 165, 177], lineWidth: 0.1, textColor: 20, halign: 'center', valign: 'middle' },
    headStyles: { fillColor: azul, textColor: 20, fontStyle: 'bold' },
    // Branco, cinza, branco… como no Excel.
    didParseCell: h => { if (h.section === 'body') h.cell.styles.fillColor = h.row.index % 2 ? [229, 229, 229] : [255, 255, 255] },
    columnStyles: Object.fromEntries(COLUNAS.map((c, i) => [i, {
      cellWidth: c.mm ?? 'auto',
      halign: c.esquerda ? 'left' : c.campo === 'vencimento' ? 'right' : 'center',
    }])),
    margin: { left: 10, right: 10 },
  })
  return doc.output('arraybuffer')
}
