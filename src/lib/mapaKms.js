import { MESES, nomeMes } from './ordenados.js'

// Mapa de kms (compensação por deslocação em viatura própria) dos sócios.
// Regras (Daniel, 2026-11-24):
// - vão de segunda a sábado ao Chalet do Lago (Montargil);
// - dois dias por semana vão também a Ponte de Sor (284 km desde Lisboa);
// - os dias em que há fatura da Makro têm de aparecer no mapa;
// - cada dia é de uma só pessoa (Patrícia e Joel nunca no mesmo dia);
// - cada mês tem de ser diferente: o sorteio depende do mês (e de "baralhar outra vez").

export const CONFIG_PADRAO = {
  firma: 'Patricia Jesus Pereira Unip Lda',
  nif: '513102914',
  localAssinatura: 'Lisboa',
  precoKm: 0.4,
  ponteSorPorSemana: 2,
  makroLinhaAParte: true,
  diferencaMaxima: 50, // € entre o que cada um recebe (Daniel, 2026-11-24)
  pessoas: [
    { nome: 'Patricia Jesus Pereira', viatura: 'AG-44-IG' },
    { nome: 'Joel Matias Santos Mendes', viatura: 'AR-65-LL' },
  ],
  destinos: {
    chalet: { local: 'Unidade Chalet do Lago', cidade: 'Montargil', kms: 214, tempos: ['4 horas', '5 horas'], objetivo: 'Trabalho' },
    ponteSor: { local: 'Ponte de Sor', cidade: '', kms: 284, tempos: ['3 horas', '4 horas'], objetivo: 'Trabalho' },
  },
  // Lojas: quando há fatura de uma destas lojas na app, a ida entra no mapa (Daniel, 2026-11-24).
  // `procura` = palavra que aparece no fornecedor da fatura. Kms = ida e volta desde Lisboa.
  lojas: [
    { chave: 'makro', procura: 'makro', local: 'Makro', cidade: 'Lisboa', kms: 20, tempos: ['1 hora', '1,5 horas', '2 horas'], objetivo: 'Compras' },
    { chave: 'ikea', procura: 'ikea', local: 'IKEA', cidade: 'Alfragide', kms: 15, tempos: ['1 hora', '1,5 horas', '2 horas'], objetivo: 'Compras' },
    { chave: 'lidl', procura: 'lidl', local: 'Lidl', cidade: 'Lisboa', kms: 10, tempos: ['1 hora'], objetivo: 'Compras' },
    { chave: 'leroy', procura: 'leroy', local: 'Leroy Merlin', cidade: 'Telheiras', kms: 10, tempos: ['1 hora', '1,5 horas'], objetivo: 'Compras' },
  ],
}

// Junta a configuração guardada com a padrão (campos novos ficam com o valor padrão).
export function juntarConfig(guardada) {
  const g = guardada && typeof guardada === 'object' ? guardada : {}
  const destinos = Object.fromEntries(Object.entries(CONFIG_PADRAO.destinos).map(([k, d]) => [k, { ...d, ...(g.destinos?.[k] || {}) }]))
  const pessoas = CONFIG_PADRAO.pessoas.map((p, i) => ({ ...p, ...(g.pessoas?.[i] || {}) }))
  let lojas = Array.isArray(g.lojas) ? g.lojas : CONFIG_PADRAO.lojas.map(l => ({ ...l }))
  // Configuração antiga: a Makro estava em destinos.makro.
  if (!Array.isArray(g.lojas) && g.destinos?.makro) lojas = lojas.map(l => (l.chave === 'makro' ? { ...l, ...g.destinos.makro } : l))
  lojas = lojas.map(l => ({ tempos: ['1 hora'], objetivo: 'Compras', ...l }))
  return { ...CONFIG_PADRAO, ...g, pessoas, destinos, lojas }
}

// Gerador pseudo-aleatório com semente (o mesmo mês dá sempre o mesmo mapa).
function hashTexto(s) {
  let h = 2166136261
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  return h >>> 0
}
export function sorteio(semente) {
  let a = hashTexto(semente)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const baralhar = (lista, rnd) => {
  const l = [...lista]
  for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[l[i], l[j]] = [l[j], l[i]] }
  return l
}
const escolher = (lista, rnd) => lista[Math.floor(rnd() * lista.length)]

const pad = n => String(n).padStart(2, '0')
export const isoDia = (ano, mes, dia) => `${ano}-${pad(mes)}-${pad(dia)}`
const diaSemana = (ano, mes, dia) => new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay() // 0 = domingo
export const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

// Dias de segunda a sábado do mês, agrupados por semana (a semana começa à segunda).
export function semanasDoMes(ano, mes) {
  const total = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  const semanas = []
  let atual = []
  for (let d = 1; d <= total; d++) {
    const w = diaSemana(ano, mes, d)
    if (w === 0) { if (atual.length) semanas.push(atual); atual = []; continue }
    atual.push(d)
  }
  if (atual.length) semanas.push(atual)
  return semanas
}

// Idas à Makro já conhecidas (lista de faturas da app da Makro enviada pelo Daniel em 2026-11-24; 25/11 dito por ele).
export const MAKRO_CONHECIDAS = ['2026-10-23', '2026-10-27', '2026-11-03', '2026-11-09', '2026-11-13', '2026-11-20', '2026-11-25']

// Leitura automática de um print da lista de faturas da Makro (função ler-makro).
export const MAKRO_SCHEMA = {
  type: 'object',
  properties: { datas: { type: 'array', items: { type: 'string', description: 'Data da fatura no formato AAAA-MM-DD' } } },
  required: ['datas'],
  additionalProperties: false,
}
export const makroPrompt = hoje => `Isto é uma lista de faturas da Makro (print da app da Makro) ou faturas da Makro em PDF.
Devolve a data de cada fatura, no formato AAAA-MM-DD (nas imagens aparecem como DD.MM.AAAA). Inclui todas as datas visíveis, mesmo repetidas; ignora as que estão cortadas e não se leem bem.
Hoje é ${hoje}.`
export function datasMakroLidas(r) {
  const ok = (r?.datas || []).map(d => String(d).trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)))
  return [...new Set(ok)].sort()
}
// Dias do mês (números) a partir de uma lista de datas AAAA-MM-DD.
export const diasDoMes = (datas, ano, mes) => [...new Set((datas || []).filter(d => d.startsWith(`${ano}-${pad(mes)}-`)).map(d => Number(d.slice(8, 10))))].sort((a, b) => a - b)

const normal = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Loja de uma fatura (pelo fornecedor ou descrição), ou null.
export function lojaDaFatura(f, lojas) {
  const texto = `${normal(f.fornecedor)} ${normal(f.descricao)}`
  return lojas.find(l => l.procura && texto.includes(normal(l.procura))) || null
}

// Idas às lojas no mês: { dia: [chave da loja, …] } (várias faturas da mesma loja no mesmo dia = uma ida).
export function idasDasFaturas(faturas, ano, mes, lojas = CONFIG_PADRAO.lojas) {
  const prefixo = `${ano}-${pad(mes)}-`
  const idas = {}
  for (const f of faturas || []) {
    if (f.estado === 'Rejeitada') continue
    const data = String(f.data || '').slice(0, 10)
    if (!data.startsWith(prefixo)) continue
    const loja = lojaDaFatura(f, lojas)
    if (!loja) continue
    const d = Number(data.slice(8, 10))
    idas[d] = [...new Set([...(idas[d] || []), loja.chave])]
  }
  return idas
}

// Junta vários { dia: [lojas] }.
export function juntarIdas(...listas) {
  const r = {}
  for (const l of listas) for (const [d, ks] of Object.entries(l || {})) r[d] = [...new Set([...(r[d] || []), ...ks])]
  return r
}
export const idasDeDias = (dias, chave) => Object.fromEntries((dias || []).map(d => [d, [chave]]))

// Datas (dias do mês) com fatura da Makro.
export const diasMakro = (faturas, ano, mes) => Object.entries(idasDasFaturas(faturas, ano, mes)).filter(([, ks]) => ks.includes('makro')).map(([d]) => Number(d)).sort((a, b) => a - b)

function linha(destino, rnd) {
  return { local: destino.local, cidade: destino.cidade, tempo: escolher(destino.tempos, rnd), objetivo: destino.objetivo, kms: Number(destino.kms) || 0 }
}

// Gera o mapa do mês. `idas` = { dia: [chaves das lojas] }; `makro` = dias com Makro (atalho).
export function gerarMapa({ ano, mes, idas = {}, makro = [], config = CONFIG_PADRAO, variante = 0 }) {
  const cfg = juntarConfig(config)
  const rnd = sorteio(`mapa-kms-${ano}-${mes}-${variante}`)
  const semanas = semanasDoMes(ano, mes)
  const uteis = semanas.flat()
  const total = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  const todas = juntarIdas(idas, idasDeDias(makro, 'makro'))
  const lojaPor = new Map(cfg.lojas.map(l => [l.chave, l]))
  const idasDia = new Map(Object.entries(todas).map(([d, ks]) => [Number(d), ks.filter(k => lojaPor.has(k))]).filter(([d, ks]) => d >= 1 && d <= total && ks.length))
  const makroSet = new Set(idasDia.keys())

  // Ponte de Sor: 2 dias por semana (1 se a semana do mês tiver menos de 3 dias), nunca em dia de Makro.
  const ponteSor = new Set()
  for (const s of semanas) {
    const n = s.length >= 3 ? cfg.ponteSorPorSemana : Math.min(1, cfg.ponteSorPorSemana)
    const livres = baralhar(s.filter(d => !makroSet.has(d)), rnd)
    // Evita dois dias seguidos de Ponte de Sor quando há alternativa.
    const escolhidos = []
    for (const d of livres) {
      if (escolhidos.length >= n) break
      if (escolhidos.some(e => Math.abs(e - d) === 1) && livres.filter(x => !escolhidos.includes(x) && !escolhidos.some(e => Math.abs(e - x) === 1)).length > 0) continue
      escolhidos.push(d)
    }
    for (const d of livres) { if (escolhidos.length >= n) break; if (!escolhidos.includes(d)) escolhidos.push(d) }
    escolhidos.forEach(d => ponteSor.add(d))
  }

  // Todos os dias (seg–sáb, e domingos com Makro) repartidos entre os dois, metade para cada.
  const dias = [...new Set([...uteis, ...makroSet])].sort((a, b) => a - b)
  const ordem = baralhar(dias, rnd)
  const primeiroFica = rnd() < 0.5 ? Math.ceil(dias.length / 2) : Math.floor(dias.length / 2)
  const dono = new Map(ordem.map((d, i) => [d, i < primeiroFica ? 0 : 1]))

  const registos = dias.map(dia => {
    const linhas = []
    const domingo = diaSemana(ano, mes, dia) === 0
    if (makroSet.has(dia)) {
      for (const k of idasDia.get(dia)) linhas.push(linha(lojaPor.get(k), rnd))
      if (cfg.makroLinhaAParte && !domingo) linhas.push(linha(cfg.destinos.chalet, rnd))
    } else {
      linhas.push(linha(ponteSor.has(dia) ? cfg.destinos.ponteSor : cfg.destinos.chalet, rnd))
    }
    return { dia, pessoa: dono.get(dia), linhas }
  })
  return montar({ ano, mes, cfg, registos: equilibrar(registos, cfg, rnd), variante })
}

const kmsDia = r => r.linhas.reduce((s, l) => s + (Number(l.kms) || 0), 0)

// Troca dias entre os dois até a diferença do que cada um recebe ficar dentro do limite
// (por defeito 50 €), mantendo o número de dias de cada um igual (±1).
export function equilibrar(registos, cfg, rnd = Math.random) {
  const regs = registos.map(r => ({ ...r }))
  const limiteKm = (Number(cfg.diferencaMaxima) || 0) / (Number(cfg.precoKm) || 1)
  const soma = i => regs.filter(r => r.pessoa === i).reduce((s, r) => s + kmsDia(r), 0)
  const conta = i => regs.filter(r => r.pessoa === i).length
  for (let volta = 0; volta < 60; volta++) {
    const dif = soma(0) - soma(1)
    if (Math.abs(dif) <= limiteKm) break
    const cands = []
    const a = regs.filter(r => r.pessoa === 0), b = regs.filter(r => r.pessoa === 1)
    for (const x of a) for (const y of b) {
      const nova = dif - 2 * (kmsDia(x) - kmsDia(y))
      if (Math.abs(nova) < Math.abs(dif)) cands.push({ mover: [x, y], nova })
    }
    // Passar um dia só de um para o outro, se o número de dias continuar equilibrado.
    const dc = conta(0) - conta(1)
    for (const x of regs) {
      const dcNovo = dc + (x.pessoa === 0 ? -2 : 2)
      if (Math.abs(dcNovo) > 1) continue
      const nova = dif + (x.pessoa === 0 ? -2 : 2) * kmsDia(x)
      if (Math.abs(nova) < Math.abs(dif)) cands.push({ mover: [x], nova })
    }
    if (!cands.length) break
    const bons = cands.filter(c => Math.abs(c.nova) <= limiteKm)
    const escolha = bons.length ? bons[Math.floor(rnd() * bons.length)] : cands.reduce((m, c) => (Math.abs(c.nova) < Math.abs(m.nova) ? c : m))
    for (const r of escolha.mover) r.pessoa = 1 - r.pessoa
  }
  return regs
}

// Recalcula os recibos a partir dos registos (usado também depois de trocar um dia de pessoa).
export function montar({ ano, mes, cfg, registos, variante = 0 }) {
  const recibos = cfg.pessoas.map((p, i) => {
    const meus = registos.filter(r => r.pessoa === i)
    const linhas = meus.flatMap(r => r.linhas.map(l => ({ ...l, dia: r.dia })))
    const totalKms = linhas.reduce((s, l) => s + (Number(l.kms) || 0), 0)
    const total = Math.round(totalKms * Number(cfg.precoKm) * 100) / 100
    return { ...p, dias: meus.length, linhas, totalKms, total }
  })
  return { ano, mes, cfg, registos, recibos, variante }
}

export function trocarPessoa(mapa, dia) {
  const registos = mapa.registos.map(r => (r.dia === dia ? { ...r, pessoa: 1 - r.pessoa } : r))
  return montar({ ...mapa, registos })
}

// Data do recibo: dia 1 do mês seguinte, como no modelo ("Fátima, 1 / Setembro / 2022").
export function dataRecibo(ano, mes) {
  const m = mes === 12 ? 1 : mes + 1
  const a = mes === 12 ? ano + 1 : ano
  return { dia: 1, mes: cap(MESES[m - 1]), ano: a }
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1)

// Assinatura guardada nas definições: { src: 'data:image/png;base64,…', ratio: largura/altura }.
export function assinaturaValida(a) {
  if (!a || typeof a.src !== 'string' || !a.src.startsWith('data:image/png;base64,')) return null
  const ratio = Number(a.ratio)
  return { src: a.src, ratio: ratio > 0.2 && ratio < 20 ? ratio : 3 }
}

export const nomeFicheiro = mapa => `Mapa_de_Kms_${nomeMes(mapa.ano, mapa.mes).replace(' ', '_')}`
const euro = v => Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const kmTxt = v => Number(v).toLocaleString('pt-PT')

// ---------- Excel (dois recibos lado a lado, como no modelo) ----------
const COLS = [
  { titulo: 'Dia', largura: 6 },
  { titulo: 'Local de Destino', largura: 24 },
  { titulo: 'Tempo de Permanência', largura: 13 },
  { titulo: 'Objetivo da Deslocação', largura: 22 },
  { titulo: 'Kms. Percorridos', largura: 11 },
]
const VERDE = 'FF8EA65B', VERDE_CLARO = 'FFEBF1DE'

export async function gerarExcel(mapa) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(nomeMes(mapa.ano, mapa.mes))
  const fino = { style: 'thin', color: { argb: 'FF555555' } }
  const caixa = { top: fino, left: fino, bottom: fino, right: fino }
  const largura = COLS.length + 1 // uma coluna vazia entre os recibos
  for (let r = 0; r < mapa.recibos.length; r++) COLS.forEach((c, i) => { ws.getColumn(r * largura + i + 1).width = c.largura })
  ws.getColumn(COLS.length + 1).width = 3
  const nomeMesSo = cap(MESES[mapa.mes - 1])
  const assin = dataRecibo(mapa.ano, mapa.mes)
  const maxLinhas = Math.max(...mapa.recibos.map(r => r.linhas.length))

  mapa.recibos.forEach((rec, k) => {
    const c0 = k * largura + 1
    const cel = (r, c) => ws.getCell(r, c0 + c)
    ws.mergeCells(1, c0, 1, c0 + 4)
    Object.assign(cel(1, 0), { value: 'Compensação por deslocação em viatura própria', font: { bold: true, underline: true, size: 12 }, alignment: { horizontal: 'center' } })
    ws.mergeCells(2, c0 + 1, 2, c0 + 2)
    cel(2, 0).value = 'Firma:'
    Object.assign(cel(2, 1), { value: mapa.cfg.firma, font: { italic: true, bold: true } })
    Object.assign(cel(2, 4), { value: 'RECIBO', font: { bold: true, underline: true, size: 12 }, alignment: { horizontal: 'center' } })
    cel(3, 0).value = 'Contribuinte nº'
    cel(3, 1).value = mapa.cfg.nif
    cel(3, 1).alignment = { horizontal: 'right' }
    Object.assign(cel(3, 3), { value: `Mês: ${nomeMesSo.toUpperCase()}`, font: { bold: true }, alignment: { horizontal: 'right' } })
    Object.assign(cel(3, 4), { value: `Ano: ${mapa.ano}`, alignment: { horizontal: 'center' } })
    COLS.forEach((c, i) => {
      Object.assign(cel(4, i), { value: c.titulo, font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: caixa })
    })
    ws.getRow(4).height = 30
    for (let j = 0; j < maxLinhas; j++) {
      const l = rec.linhas[j]
      const r = 5 + j * 2
      for (const i of [0, 2, 3, 4]) ws.mergeCells(r, c0 + i, r + 1, c0 + i)
      const vals = l ? [l.dia, l.local, l.tempo, l.objetivo, l.kms] : [null, null, null, null, null]
      vals.forEach((v, i) => { const c = cel(r, i); c.value = v; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.border = caixa })
      Object.assign(cel(r + 1, 1), { value: l ? l.cidade : null, alignment: { horizontal: 'center', vertical: 'middle' }, border: caixa })
      cel(r, 0).font = { bold: true, size: 13 }
      cel(r, 4).font = { bold: true }
      if (j % 2 === 1) for (let i = 0; i < 5; i++) { cel(r, i).fill = cel(r + 1, i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_CLARO } } }
    }
    const rf = 5 + maxLinhas * 2 + 1
    ws.mergeCells(rf, c0, rf, c0 + 2)
    cel(rf, 0).value = `Nome: ${rec.nome.toUpperCase()}`
    cel(rf, 3).value = 'Total de Kms.'
    Object.assign(cel(rf, 4), { value: rec.totalKms, font: { bold: true }, border: caixa, alignment: { horizontal: 'right' } })
    ws.mergeCells(rf + 1, c0, rf + 1, c0 + 2)
    cel(rf + 1, 0).value = `Viatura: ${rec.viatura}`
    cel(rf + 1, 3).value = 'Preço por Km.'
    Object.assign(cel(rf + 1, 4), { value: Number(mapa.cfg.precoKm), numFmt: '0.00 "€"', border: caixa, alignment: { horizontal: 'right' } })
    cel(rf + 2, 3).value = 'Total a Receber'
    Object.assign(cel(rf + 2, 4), { value: { formula: `${cel(rf, 4).address}*${cel(rf + 1, 4).address}`, result: rec.total }, numFmt: '#,##0.00 "€"', font: { bold: true }, border: caixa, alignment: { horizontal: 'right' } })
    for (const r of [rf, rf + 1, rf + 2]) cel(r, 3).alignment = { horizontal: 'right' }
    ws.mergeCells(rf + 4, c0, rf + 4, c0 + 2)
    Object.assign(cel(rf + 4, 0), { value: `${mapa.cfg.localAssinatura}, ${assin.dia} / ${assin.mes} / ${assin.ano}`, alignment: { horizontal: 'center' } })
    ws.mergeCells(rf + 4, c0 + 3, rf + 4, c0 + 4)
    Object.assign(cel(rf + 4, 3), { value: '______________________', alignment: { horizontal: 'center', vertical: 'bottom' } })
    cel(rf + 4, 0).alignment = { horizontal: 'center', vertical: 'bottom' }
    const a = assinaturaValida(rec.assinatura)
    if (a) {
      // Assinatura de quem recebe, por cima da linha.
      ws.getRow(rf + 4).height = 42
      const alt = 38, larg = Math.min(170, alt * a.ratio)
      const id = wb.addImage({ base64: a.src, extension: 'png' })
      ws.addImage(id, { tl: { col: c0 + 3 - 1 + 0.15, row: rf + 4 - 1 + 0.02 }, ext: { width: larg, height: Math.min(alt, larg / a.ratio) } })
    }
  })
  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
  return wb.xlsx.writeBuffer()
}

// ---------- PDF (uma página A4 ao alto com os dois recibos lado a lado) ----------
export async function gerarPdf(mapa) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const margem = 7, espaco = 5
  const larg = (210 - 2 * margem - espaco) / 2
  const nomeMesSo = cap(MESES[mapa.mes - 1])
  const assin = dataRecibo(mapa.ano, mapa.mes)
  const maxLinhas = Math.max(...mapa.recibos.map(r => r.linhas.length))
  // Encolhe a letra quando há muitas linhas para caber tudo numa página.
  const fonte = maxLinhas > 26 ? 5.6 : maxLinhas > 20 ? 6.2 : 7
  const verde = [142, 166, 91]

  mapa.recibos.forEach((rec, k) => {
    const x = margem + k * (larg + espaco)
    doc.setFont('times', 'bold'); doc.setFontSize(10)
    doc.text('Compensação por deslocação em viatura própria', x + larg / 2, 11, { align: 'center' })
    doc.setLineWidth(0.2); doc.line(x + 8, 12, x + larg - 8, 12)
    doc.setFontSize(7.5); doc.setFont('times', 'normal')
    doc.text('Firma:', x, 18)
    doc.setFont('times', 'bolditalic'); doc.text(mapa.cfg.firma, x + 9, 18)
    doc.setFont('times', 'bold'); doc.setFontSize(10); doc.text('RECIBO', x + larg - 4, 18, { align: 'right' })
    doc.setFontSize(7.5); doc.setFont('times', 'normal')
    doc.text(`Contribuinte nº  ${mapa.cfg.nif}`, x, 23)
    doc.text(`Mês: ${nomeMesSo.toUpperCase()}   Ano: ${mapa.ano}`, x + larg, 23, { align: 'right' })
    const body = rec.linhas.map(l => [String(l.dia), l.cidade ? `${l.local}\n${l.cidade}` : l.local, l.tempo, l.objetivo, kmTxt(l.kms)])
    autoTable(doc, {
      startY: 26,
      margin: { left: x },
      tableWidth: larg,
      head: [COLS.map(c => (c.titulo === 'Kms. Percorridos' ? 'Kms.' : c.titulo))],
      body,
      theme: 'grid',
      styles: { font: 'times', fontSize: fonte, cellPadding: 0.8, halign: 'center', valign: 'middle', lineColor: [90, 90, 90], lineWidth: 0.15, textColor: 20 },
      headStyles: { fillColor: verde, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 8, fontStyle: 'bold', fontSize: fonte + 2 }, 1: { cellWidth: 30 }, 2: { cellWidth: 16 }, 3: { cellWidth: 'auto' }, 4: { cellWidth: 13, fontStyle: 'bold' } },
      didParseCell: h => { if (h.section === 'body') h.cell.styles.fillColor = h.row.index % 2 ? [235, 241, 222] : [255, 255, 255] },
    })
    let y = doc.lastAutoTable.finalY + 6
    doc.setFontSize(7.5); doc.setFont('times', 'normal')
    const linhaTotal = (rot, val, negrito) => {
      doc.setFont('times', 'normal'); doc.text(rot, x + larg - 16, y, { align: 'right' })
      doc.setFont('times', negrito ? 'bold' : 'normal'); doc.rect(x + larg - 15, y - 3.2, 15, 4.4); doc.text(val, x + larg - 1, y, { align: 'right' })
    }
    doc.text(`NOME: ${rec.nome.toUpperCase()}`, x, y)
    linhaTotal('Total de Kms.', kmTxt(rec.totalKms), true); y += 5
    doc.setFont('times', 'normal'); doc.text(`VIATURA: ${rec.viatura}`, x, y)
    linhaTotal('Preço por Km.', `${euro(mapa.cfg.precoKm)} €`); y += 5
    linhaTotal('Total a Receber', `${euro(rec.total)} €`, true); y += assinaturaValida(rec.assinatura) ? 20 : 9
    doc.setFont('times', 'normal')
    doc.text(`${mapa.cfg.localAssinatura},   ${assin.dia} / ${assin.mes} / ${assin.ano}`, x + 2, y)
    doc.line(x + larg - 38, y, x + larg - 2, y)
    const a = assinaturaValida(rec.assinatura)
    if (a) {
      const alt = Math.min(14, 36 / a.ratio), w = alt * a.ratio
      doc.addImage(a.src, 'PNG', x + larg - 20 - w / 2, y - alt - 0.5, w, alt)
    }
  })
  return doc.output('arraybuffer')
}
