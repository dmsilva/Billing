import { casarNome, MESES, norm } from './ordenados.js'
import { alterarCelulas } from './xlsxPatch.js'
import { sum } from './money.js'

// Recibos de remunerações que o contabilista envia em PDF (um por trabalhador, com Original e Duplicado).
// Serve para conferir o que foi pago com o que se enviou (feriados, noites, faltas, vencimento)
// e para preencher a folha "Ordenados_Chalet" que se exporta em TSV para o banco.

export const RUBRICAS = { vencimento: 110, feriado: 126, ferias: 170, noite: 181, falta: 415 }
// O subsídio de noite vem em dias: 7 noites = 10,00 (noites × 10/7).
export const noitesDoSubsidio = qtd => Math.round((qtd * 7) / 10)

// "3 , 000 . 00" → 3000; "11 . 43D" → 11.43
export function numero(s) {
  const n = Number(String(s).replace(/\s/g, '').replace(/[D€]$/, '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const NUM = /\d{1,3}(?: , \d{3})* \. \d{2}D?/g
const TIPOS_IRS = /\s+(?:N[ãa]o Casado|Casado|Solteiro|Divorciado|Vi[úu]vo)\b.*$/i

// Lê os recibos a partir das linhas de texto do PDF (só os originais).
export function lerRecibosDeLinhas(linhas) {
  const recibos = []
  let atual = null
  let duplicado = false
  let proxima = ''
  for (const bruta of linhas) {
    const l = bruta.trim()
    if (l === 'Duplicado') { duplicado = true; atual = null; continue }
    if (l === 'Original') { duplicado = false; continue }
    if (duplicado) continue
    if (proxima === 'trabalhador') {
      proxima = ''
      const m = l.match(/^(\d+)\s+(.+)$/)
      if (m && !recibos.some(r => r.codigo === Number(m[1]))) {
        atual = { codigo: Number(m[1]), nome: m[2].replace(TIPOS_IRS, '').trim(), vencimento: null, rubricas: {}, pago: null }
        recibos.push(atual)
      }
      continue
    }
    if (/^Trabalhador\s+Nome/.test(l)) { proxima = 'trabalhador'; continue }
    if (!atual) continue
    if (proxima === 'vencimento') {
      proxima = ''
      const nums = l.match(NUM)
      if (nums) atual.vencimento = numero(nums.at(-1))
      continue
    }
    if (/Vencimento Base$/.test(l)) { proxima = 'vencimento'; continue }
    const pago = l.match(/Valor pago em Euro\s+(.+)$/)
    if (pago) { atual.pago = numero(pago[1].match(NUM)?.[0] ?? ''); continue }
    const item = l.match(/^(\d{3})\s+(.+)$/)
    if (item) {
      const nums = item[2].match(NUM) || []
      const descricao = item[2].slice(0, item[2].search(NUM) >= 0 ? item[2].search(NUM) : undefined).trim()
      const cod = Number(item[1])
      const r = atual.rubricas[cod] || (atual.rubricas[cod] = { descricao, qtd: 0, valor: 0 })
      if (nums.length > 1) r.qtd += numero(nums[0])
      r.valor = sum([r.valor, numero(nums.at(-1) ?? 0)])
    }
  }
  return recibos
}

// Mês dos recibos, pela data no cabeçalho ("28 de Outubro de 2026").
export function mesDosRecibos(linhas) {
  for (const l of linhas) {
    const m = norm(l).match(/^\d{1,2} de ([a-z]+) de (\d{4})$/)
    const mes = m ? MESES.map(x => norm(x)).indexOf(m[1]) + 1 : 0
    if (mes) return { ano: Number(m[2]), mes }
  }
  return null
}

export async function lerRecibos(ficheiro, pdfjs) {
  const { pdfTextItems } = await import('./pdfLoader.js')
  const { toLines, toWords } = await import('./pdfStatement.js')
  const paginas = await pdfTextItems(await ficheiro.arrayBuffer(), pdfjs)
  const linhas = paginas.flatMap(p => toLines(toWords(p)).map(l => l.words.map(w => w.s).join(' ')))
  const recibos = lerRecibosDeLinhas(linhas)
  if (!recibos.length) throw new Error('Não encontrei recibos de remunerações neste PDF.')
  return { recibos, ...mesDosRecibos(linhas) }
}

const qtd = (recibo, cod) => recibo.rubricas[cod]?.qtd ?? 0

// Compara cada recibo com a linha enviada à contabilidade (montarOrdenados).
export function conferirRecibos(recibos, linhas) {
  const usados = new Set()
  const resultado = linhas.map(linha => {
    const recibo = recibos.find(r => linha.codigo != null && r.codigo === Number(linha.codigo))
      || casarNome(linha.nome, recibos.filter(r => !usados.has(r)))
    if (recibo) usados.add(recibo)
    const enviado = { feriados: linha.feriados.length, noites: linha.noites, faltas: linha.faltas.length, vencimento: linha.vencimento }
    if (!recibo) return { linha, recibo: null, enviado, pago: null, problemas: ['Não tem recibo no PDF.'] }
    const pago = {
      feriados: qtd(recibo, RUBRICAS.feriado),
      noites: noitesDoSubsidio(qtd(recibo, RUBRICAS.noite)),
      faltas: qtd(recibo, RUBRICAS.falta),
      vencimento: recibo.vencimento,
    }
    const problemas = []
    if (pago.feriados !== enviado.feriados) problemas.push(`Feriados: enviaste ${enviado.feriados}, pagou ${pago.feriados}.`)
    // O recepcionista nocturno não leva noites na folha (a contabilidade já sabe), por isso não se comparam.
    if (!linha.nocturno && pago.noites !== enviado.noites) problemas.push(`Noites: enviaste ${enviado.noites}, pagou ${pago.noites}.`)
    if (pago.faltas !== enviado.faltas) problemas.push(`Faltas justificadas: no horário ${enviado.faltas}, no recibo ${pago.faltas}.`)
    if (enviado.vencimento != null && pago.vencimento != null && Math.round(enviado.vencimento * 100) !== Math.round(pago.vencimento * 100)) {
      problemas.push(`Vencimento base: na folha ${enviado.vencimento}, no recibo ${pago.vencimento}.`)
    }
    return { linha, recibo, enviado, pago, problemas }
  })
  const semLinha = recibos.filter(r => !usados.has(r))
  return { linhas: resultado, semLinha, total: sum(recibos.map(r => r.pago ?? 0)) }
}

// Folha "Ordenados_Chalet": A IBAN, B nome, C BIC, D valor, E descrição (fórmula), F mês.
export async function lerFolhaBanco(buffer) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets.find(w => norm(w.name).replace(/[^a-z]/g, '').includes('ordenadoschalet'))
  if (!ws) throw new Error('O Excel dos ordenados não tem a folha "Ordenados_Chalet".')
  const linhas = []
  ws.eachRow((row, r) => {
    const nome = row.getCell(2).value
    const iban = row.getCell(1).value
    if (typeof nome === 'string' && nome.trim() && typeof iban === 'string' && /^[A-Z]{2}\d{2}/.test(iban.replace(/\s/g, ''))) {
      const texto = c => { const v = row.getCell(c).value; return v == null || typeof v === 'object' ? '' : String(v).trim() }
      linhas.push({ linha: r, nome: nome.trim(), iban: texto(1), bic: texto(3), extra: texto(7) })
    }
  })
  return { folha: ws.name, linhas }
}

// Num TSV os campos não levam aspas: tabs e mudanças de linha passam a espaço.
const campoTsv = v => String(v ?? '').replace(/[\t\r\n]+/g, ' ')

// Só se paga a quem está marcado e tem valor.
export const aPagar = pagamentos => pagamentos.filter(p => p.incluir && p.valor != null && p.valor > 0)

// TSV (separado por tabs) como sai ao exportar a folha (A IBAN, B nome, C BIC, D valor, E descrição, F mês, G).
export function tsvBanco(pagamentos, mes) {
  return aPagar(pagamentos)
    .map(p => [p.iban, p.nome, p.bic, p.valor.toFixed(2), `${p.nome} Ordenado ${mes}`, mes, p.extra].map(campoTsv).join('\t'))
    .join('\r\n') + '\r\n'
}

// Junta cada linha da folha do banco ao seu recibo. Quem não tem recibo neste PDF fica desmarcado,
// por isso um PDF só com alguns recibos dá um ficheiro só com essas pessoas.
export async function casarFolhaBanco(buffer, recibos) {
  const { folha, linhas } = await lerFolhaBanco(buffer)
  const usados = new Set()
  const pagamentos = linhas.map(l => {
    const recibo = casarNome(l.nome, recibos.filter(r => !usados.has(r)))
    if (recibo) usados.add(recibo)
    return { ...l, recibo: recibo || null, valor: recibo?.pago ?? null, incluir: Boolean(recibo) }
  })
  return { folha, pagamentos, semLinha: recibos.filter(r => !usados.has(r)).map(r => r.nome) }
}

// Põe o valor (coluna D) e o mês (coluna F) na folha do banco, sem mexer no resto do ficheiro.
// Quem não vai ser pago fica com o valor em branco.
export function gerarFolhaBanco(buffer, folha, pagamentos, mes) {
  const pagos = new Set(aPagar(pagamentos))
  const alteracoes = pagamentos.flatMap(p => [
    { linha: p.linha, coluna: 4, valor: pagos.has(p) ? p.valor : null },
    { linha: p.linha, coluna: 6, valor: mes },
  ])
  return alterarCelulas(buffer, folha, alteracoes, { recalcular: true })
}

export async function preencherFolhaBanco(buffer, recibos, mes) {
  const { folha, pagamentos, semLinha } = await casarFolhaBanco(buffer, recibos)
  return {
    ficheiro: gerarFolhaBanco(buffer, folha, pagamentos, mes),
    tsv: tsvBanco(pagamentos, mes),
    pagamentos,
    semRecibo: pagamentos.filter(p => !p.recibo).map(p => p.nome),
    semLinha,
  }
}
