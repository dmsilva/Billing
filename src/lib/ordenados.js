import { alterarCelulas } from './xlsxPatch.js'

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
    funcionarios: funcionarios.map(({ col, nome }) => {
      const res = { nome, feriados: [], noites: 0, ferias: [], faltas: [] }
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
      }
      return res
    }),
  }
}

// "Galia" no horário corresponde a "Galina Sabaeva" na contabilidade.
export function casarNome(nomeHorario, nomes) {
  const a = norm(nomeHorario).split(' ')[0]
  const primeiro = n => norm(n).split(' ')[0]
  return nomes.find(n => primeiro(n.nome) === a)
    || (a.length >= 4 ? nomes.find(n => { const b = primeiro(n.nome); return b.startsWith(a.slice(0, 4)) || a.startsWith(b.slice(0, 4)) }) : undefined)
}

export function preencherOrdenados(wbOrdenados, horario, ano, mes) {
  const ws = wbOrdenados.worksheets.find(w => norm(w.name).includes('contabilidade'))
  if (!ws) throw new Error('O Excel dos ordenados não tem a folha "para contabilidade".')
  let hdrRow = null
  const cols = {}
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !hdrRow; r++) {
    ws.getRow(r).eachCell((cell, col) => { const t = texto(cell); if (['feriado', 'noites', 'ferias', 'notas', 'nome'].includes(t)) cols[t] = col })
    if (cols.feriado && cols.noites) hdrRow = r
  }
  if (!hdrRow || !cols.ferias || !cols.notas) throw new Error('Não encontrei as colunas Feriado, Noites, Ferias e Notas na folha da contabilidade.')
  const nomeCol = cols.nome || 2
  const nomes = []
  for (let r = hdrRow + 1; r <= ws.rowCount; r++) {
    const n = valor(ws.getCell(r, nomeCol))
    if (typeof n === 'string' && n.trim()) nomes.push({ r, nome: n.trim() })
  }
  const alteracoes = [] // { linha, coluna, valor } a escrever no ficheiro original
  const escrever = (linha, coluna, v) => alteracoes.push({ linha, coluna, valor: v })
  escrever(2, nomeCol, `Mês: ${MESES[mes - 1][0].toUpperCase()}${MESES[mes - 1].slice(1)} ${ano}`)

  const resumo = [], semPar = []
  const dias = l => `${l.join(', ')}/${String(mes).padStart(2, '0')}`
  for (const f of horario.funcionarios) {
    const alvo = casarNome(f.nome, nomes)
    const temAlgo = f.feriados.length || f.noites || f.ferias.length || f.faltas.length
    if (!alvo) { if (temAlgo) semPar.push(f); continue }
    escrever(alvo.r, cols.feriado, f.feriados.length || null)
    escrever(alvo.r, cols.noites, f.noites || null)
    escrever(alvo.r, cols.ferias, f.ferias.length || null)
    const notas = []
    if (f.feriados.length) notas.push(`Feriado trabalhado: ${dias(f.feriados)}`)
    if (f.ferias.length) notas.push(`Férias: ${dias(f.ferias)}`)
    if (f.faltas.length) notas.push(`Falta justificada (${f.faltas.length}): ${dias(f.faltas)}`)
    const antiga = String(valor(ws.getCell(alvo.r, cols.notas)) ?? '').trim()
    escrever(alvo.r, cols.notas, [antiga, ...notas].filter(Boolean).join('; ') || null)
    resumo.push({ ...f, nomeContabilidade: alvo.nome })
  }
  return { folha: ws.name, resumo, semPar, alteracoes }
}

export async function gerarOrdenados(ficheiroHorario, ficheiroOrdenados, ano, mes) {
  const { default: ExcelJS } = await import('exceljs')
  const wbH = new ExcelJS.Workbook()
  await wbH.xlsx.load(await ficheiroHorario.arrayBuffer())
  const wbO = new ExcelJS.Workbook()
  await wbO.xlsx.load(await ficheiroOrdenados.arrayBuffer())
  const horario = lerHorario(wbH, ano, mes)
  const resultado = preencherOrdenados(wbO, horario, ano, mes)
  // Escreve só as células alteradas no ficheiro original, para não perder formatação nem fórmulas.
  const buffer = await alterarCelulas(await ficheiroOrdenados.arrayBuffer(), resultado.folha, resultado.alteracoes)
  return { ...resultado, folhaHorario: horario.folha, buffer }
}

export async function lerMesesDoFicheiro(ficheiro) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await ficheiro.arrayBuffer())
  return mesesDoHorario(wb)
}
