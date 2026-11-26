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
  // O mapa de "novembro" vai de 27 de outubro a 26 de novembro (Daniel, 2026-11-24: os recibos são pedidos ao
  // contabilista por volta do dia 26). 1 = mês do calendário.
  diaInicio: 27,
  // Fim de um período diferente do normal: { 'AAAA-MM': 'AAAA-MM-DD' }; o mês seguinte começa no dia a seguir.
  // Ex.: { "2027-03": "2027-03-24" } faz março acabar a 24 e abril começar a 25. Ajustável na página.
  fimPeriodos: {},
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
    { chave: 'ikea', procura: 'ikea', local: 'IKEA', cidade: 'Loures', kms: 28, tempos: ['1 hora', '1,5 horas', '2 horas'], objetivo: 'Compras' },
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
  const fimPeriodos = { ...CONFIG_PADRAO.fimPeriodos, ...(g.fimPeriodos || {}) }
  return { ...CONFIG_PADRAO, ...g, pessoas, destinos, lojas, fimPeriodos }
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

const isoUTC = d => d.toISOString().slice(0, 10)
const dataUTC = iso => new Date(`${iso}T00:00:00Z`)
const somaDias = (iso, n) => isoUTC(new Date(dataUTC(iso).getTime() + n * 86400000))
const diaSemanaIso = iso => dataUTC(iso).getUTCDay()
export const rotuloDia = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
export const semanaDe = iso => SEMANA[diaSemanaIso(iso)]

// Período do mapa de um mês: com diaInicio 27, o de novembro vai de 27/10 a 26/11; com 1, é o mês do calendário.
// `fins` = fins de período escolhidos à mão ({ 'AAAA-MM': 'AAAA-MM-DD' }): o mês seguinte começa no dia a seguir.
export function periodoDoMes(ano, mes, diaInicio = CONFIG_PADRAO.diaInicio, fins = CONFIG_PADRAO.fimPeriodos) {
  const di = Math.min(28, Math.max(1, Math.round(Number(diaInicio) || 1)))
  const anterior = mes === 1 ? `${ano - 1}-12` : `${ano}-${pad(mes - 1)}`
  const valida = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null)
  let inicio = di === 1 ? isoDia(ano, mes, 1) : isoDia(mes === 1 ? ano - 1 : ano, mes === 1 ? 12 : mes - 1, di)
  let fim = di === 1 ? isoDia(ano, mes, new Date(Date.UTC(ano, mes, 0)).getUTCDate()) : isoDia(ano, mes, di - 1)
  if (valida(fins?.[anterior])) inicio = somaDias(fins[anterior], 1)
  if (valida(fins?.[`${ano}-${pad(mes)}`])) fim = fins[`${ano}-${pad(mes)}`]
  if (fim < inicio) fim = inicio
  const datas = []
  for (let d = inicio; d <= fim; d = somaDias(d, 1)) datas.push(d)
  return { inicio, fim, datas, diaInicio: di }
}
const fmtData = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
export const textoPeriodo = p => `${fmtData(p.inicio)} a ${fmtData(p.fim)}`

// Dias de segunda a sábado do período, agrupados por semana (a semana começa à segunda).
export function semanasDoPeriodo(p) {
  const semanas = []
  let atual = []
  for (const d of p.datas) {
    if (diaSemanaIso(d) === 0) { if (atual.length) semanas.push(atual); atual = []; continue }
    atual.push(d)
  }
  if (atual.length) semanas.push(atual)
  return semanas
}

// Datas (AAAA-MM-DD) de uma lista que caem no período.
export const datasNoPeriodo = (datas, p) => [...new Set((datas || []).filter(d => d >= p.inicio && d <= p.fim))].sort()

// Idas às lojas no período: { 'AAAA-MM-DD': [chave da loja, …] }.
export function idasNoPeriodo(faturas, p, lojas = CONFIG_PADRAO.lojas) {
  const idas = {}
  for (const f of faturas || []) {
    if (f.estado === 'Rejeitada') continue
    const data = String(f.data || '').slice(0, 10)
    if (data < p.inicio || data > p.fim) continue
    const loja = lojaDaFatura(f, lojas)
    if (!loja) continue
    idas[data] = [...new Set([...(idas[data] || []), loja.chave])]
  }
  return idas
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

// Gera o mapa do mês (período de `periodoDoMes`). `idas` = { data ou dia do mês: [chaves das lojas] };
// `makro` = datas (ou dias do mês) com Makro (atalho).
export function gerarMapa({ ano, mes, idas = {}, makro = [], config = CONFIG_PADRAO, variante = 0 }) {
  const cfg = juntarConfig(config)
  const rnd = sorteio(`mapa-kms-${ano}-${mes}-${variante}`)
  const periodo = periodoDoMes(ano, mes, cfg.diaInicio, cfg.fimPeriodos)
  const semanas = semanasDoPeriodo(periodo)
  const uteis = semanas.flat()
  const chave = k => (/^\d{1,2}$/.test(String(k)) ? isoDia(ano, mes, Number(k)) : String(k))
  const todas = juntarIdas(idas, idasDeDias(makro, 'makro'))
  const lojaPor = new Map(cfg.lojas.map(l => [l.chave, l]))
  const idasDia = new Map()
  for (const [k, ks] of Object.entries(todas)) {
    const d = chave(k), validas = ks.filter(x => lojaPor.has(x))
    if (d >= periodo.inicio && d <= periodo.fim && validas.length) idasDia.set(d, [...new Set([...(idasDia.get(d) || []), ...validas])])
  }
  const makroSet = new Set(idasDia.keys())
  const ordinal = new Map(periodo.datas.map((d, i) => [d, i]))
  const seguidos = (a, b) => Math.abs(ordinal.get(a) - ordinal.get(b)) === 1

  // Ponte de Sor: 2 dias por semana (1 se a semana tiver menos de 3 dias), nunca em dia de compras.
  const ponteSor = new Set()
  for (const s of semanas) {
    const n = s.length >= 3 ? cfg.ponteSorPorSemana : Math.min(1, cfg.ponteSorPorSemana)
    const livres = baralhar(s.filter(d => !makroSet.has(d)), rnd)
    // Evita dois dias seguidos de Ponte de Sor quando há alternativa.
    const escolhidos = []
    for (const d of livres) {
      if (escolhidos.length >= n) break
      if (escolhidos.some(e => seguidos(e, d)) && livres.filter(x => !escolhidos.includes(x) && !escolhidos.some(e => seguidos(e, x))).length > 0) continue
      escolhidos.push(d)
    }
    for (const d of livres) { if (escolhidos.length >= n) break; if (!escolhidos.includes(d)) escolhidos.push(d) }
    escolhidos.forEach(d => ponteSor.add(d))
  }

  // Todos os dias (seg–sáb, e domingos com compras) repartidos entre os dois, metade para cada.
  const dias = [...new Set([...uteis, ...makroSet])].sort()
  const ordem = baralhar(dias, rnd)
  const primeiroFica = rnd() < 0.5 ? Math.ceil(dias.length / 2) : Math.floor(dias.length / 2)
  const dono = new Map(ordem.map((d, i) => [d, i < primeiroFica ? 0 : 1]))

  const registos = dias.map(data => {
    const linhas = []
    const domingo = diaSemanaIso(data) === 0
    if (makroSet.has(data)) {
      for (const k of idasDia.get(data)) linhas.push(linha(lojaPor.get(k), rnd))
      if (cfg.makroLinhaAParte && !domingo) linhas.push(linha(cfg.destinos.chalet, rnd))
    } else {
      linhas.push(linha(ponteSor.has(data) ? cfg.destinos.ponteSor : cfg.destinos.chalet, rnd))
    }
    return { data, dia: Number(data.slice(8, 10)), rotulo: rotuloDia(data), pessoa: dono.get(data), linhas }
  })
  return montar({ ano, mes, cfg, periodo, registos: equilibrar(registos, cfg, rnd), variante })
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
export function montar({ ano, mes, cfg, periodo, registos, variante = 0 }) {
  const recibos = cfg.pessoas.map((p, i) => {
    const meus = registos.filter(r => r.pessoa === i)
    const linhas = meus.flatMap(r => r.linhas.map(l => ({ ...l, data: r.data, dia: r.dia, rotulo: r.rotulo })))
    const totalKms = linhas.reduce((s, l) => s + (Number(l.kms) || 0), 0)
    const total = Math.round(totalKms * Number(cfg.precoKm) * 100) / 100
    return { ...p, dias: meus.length, linhas, totalKms, total }
  })
  return { ano, mes, cfg, periodo: periodo || periodoDoMes(ano, mes, cfg.diaInicio, cfg.fimPeriodos), registos, recibos, variante }
}

// `data` = 'AAAA-MM-DD' (ou, no formato antigo, o dia do mês).
export function trocarPessoa(mapa, data) {
  const d = /^\d{1,2}$/.test(String(data)) ? isoDia(mapa.ano, mapa.mes, Number(data)) : data
  const registos = mapa.registos.map(r => (r.data === d ? { ...r, pessoa: 1 - r.pessoa } : r))
  return montar({ ...mapa, registos })
}

// Data do recibo: último dia do período (ex.: 27 / Novembro / 2026), como no modelo ("Fátima, 1 / Setembro / 2022").
export function dataRecibo(mapa) {
  const fim = mapa.periodo.fim
  return { dia: Number(fim.slice(8, 10)), mes: cap(MESES[Number(fim.slice(5, 7)) - 1]), ano: Number(fim.slice(0, 4)) }
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1)

// Assinatura guardada nas definições: { src: 'data:image/png;base64,…', ratio: largura/altura }.
export function assinaturaValida(a) {
  if (!a || typeof a.src !== 'string' || !a.src.startsWith('data:image/png;base64,')) return null
  const ratio = Number(a.ratio)
  return { src: a.src, ratio: ratio > 0.2 && ratio < 20 ? ratio : 3 }
}

export const nomeFicheiro = (mapa, pessoa) => `Mapa_de_Kms_${nomeMes(mapa.ano, mapa.mes).replace(' ', '_')}${pessoa === 0 || pessoa === 1 ? `_${mapa.recibos[pessoa].nome.split(' ')[0]}` : ''}`
const euro = v => Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const kmTxt = v => Number(v).toLocaleString('pt-PT')

// ---------- Excel (dois recibos lado a lado, como no modelo) ----------
const COLS = [
  { titulo: 'Dia', largura: 8 },
  { titulo: 'Local de Destino', largura: 24 },
  { titulo: 'Tempo de Permanência', largura: 13 },
  { titulo: 'Objetivo da Deslocação', largura: 22 },
  { titulo: 'Kms. Percorridos', largura: 11 },
]
const VERDE = 'FF8EA65B', VERDE_CLARO = 'FFEBF1DE'

export async function gerarExcel(mapaTodo, pessoa) {
  const mapa = pessoa === 0 || pessoa === 1 ? { ...mapaTodo, recibos: [mapaTodo.recibos[pessoa]] } : mapaTodo
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(nomeMes(mapa.ano, mapa.mes))
  const fino = { style: 'thin', color: { argb: 'FF555555' } }
  const caixa = { top: fino, left: fino, bottom: fino, right: fino }
  const largura = COLS.length + 1 // uma coluna vazia entre os recibos
  for (let r = 0; r < mapa.recibos.length; r++) COLS.forEach((c, i) => { ws.getColumn(r * largura + i + 1).width = c.largura })
  ws.getColumn(COLS.length + 1).width = 3
  const nomeMesSo = cap(MESES[mapa.mes - 1])
  const assin = dataRecibo(mapa)
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
    Object.assign(cel(3, 2), { value: `${rotuloDia(mapa.periodo.inicio)} a ${rotuloDia(mapa.periodo.fim)}`, font: { size: 9 }, alignment: { horizontal: 'center' } })
    COLS.forEach((c, i) => {
      Object.assign(cel(4, i), { value: c.titulo, font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: caixa })
    })
    ws.getRow(4).height = 30
    for (let j = 0; j < maxLinhas; j++) {
      const l = rec.linhas[j]
      const r = 5 + j * 2
      for (const i of [0, 2, 3, 4]) ws.mergeCells(r, c0 + i, r + 1, c0 + i)
      const vals = l ? [l.rotulo || l.dia, l.local, l.tempo, l.objetivo, l.kms] : [null, null, null, null, null]
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
// `pessoa` (0 ou 1): só o recibo dessa pessoa, maior, numa página A4. Sem `pessoa`: os dois lado a lado.
export async function gerarPdf(mapa, pessoa) {
  const um = pessoa === 0 || pessoa === 1
  const recibos = um ? [mapa.recibos[pessoa]] : mapa.recibos
  const e = um ? 1.45 : 1 // escala da letra e das medidas
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const margem = um ? 18 : 7, espaco = 5
  const larg = um ? 210 - 2 * margem : (210 - 2 * margem - espaco) / 2
  const nomeMesSo = cap(MESES[mapa.mes - 1])
  const assin = dataRecibo(mapa)
  const maxLinhas = Math.max(...recibos.map(r => r.linhas.length))
  // Encolhe a letra quando há muitas linhas para caber tudo numa página.
  const fonte = (maxLinhas > 26 ? 5.6 : maxLinhas > 20 ? 6.2 : 7) * (um ? (maxLinhas > 26 ? 1.25 : 1.4) : 1)
  const verde = [142, 166, 91]

  recibos.forEach((rec, k) => {
    const x = margem + k * (larg + espaco)
    doc.setFont('times', 'bold'); doc.setFontSize(10 * e)
    doc.text('Compensação por deslocação em viatura própria', x + larg / 2, 11 * e, { align: 'center' })
    doc.setLineWidth(0.2); doc.line(x + 8, 12 * e, x + larg - 8, 12 * e)
    doc.setFontSize(7.5 * e); doc.setFont('times', 'normal')
    doc.text('Firma:', x, 18 * e)
    doc.setFont('times', 'bolditalic'); doc.text(mapa.cfg.firma, x + 9 * e, 18 * e)
    doc.setFont('times', 'bold'); doc.setFontSize(10 * e); doc.text('RECIBO', x + larg - 4, 18 * e, { align: 'right' })
    doc.setFontSize(7.5 * e); doc.setFont('times', 'normal')
    doc.text(`Contribuinte nº  ${mapa.cfg.nif}`, x, 23 * e)
    doc.text(`Mês: ${nomeMesSo.toUpperCase()}   Ano: ${mapa.ano}`, x + larg, 23 * e, { align: 'right' })
    doc.setFontSize(6.5 * e); doc.text(`Período: ${textoPeriodo(mapa.periodo)}`, x + larg, 25.6 * e, { align: 'right' }); doc.setFontSize(7.5 * e)
    const body = rec.linhas.map(l => [String(l.rotulo || l.dia), l.cidade ? `${l.local}\n${l.cidade}` : l.local, l.tempo, l.objetivo, kmTxt(l.kms)])
    autoTable(doc, {
      startY: 27.5 * e,
      margin: { left: x },
      tableWidth: larg,
      head: [COLS.map(c => (c.titulo === 'Kms. Percorridos' ? 'Kms.' : c.titulo))],
      body,
      theme: 'grid',
      styles: { font: 'times', fontSize: fonte, cellPadding: 0.8 * e, halign: 'center', valign: 'middle', lineColor: [90, 90, 90], lineWidth: 0.15, textColor: 20 },
      headStyles: { fillColor: verde, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 11 * e, fontStyle: 'bold', fontSize: fonte + 1 }, 1: { cellWidth: 29 * e }, 2: { cellWidth: 16 * e }, 3: { cellWidth: 'auto' }, 4: { cellWidth: 13 * e, fontStyle: 'bold' } },
      didParseCell: h => { if (h.section === 'body') h.cell.styles.fillColor = h.row.index % 2 ? [235, 241, 222] : [255, 255, 255] },
    })
    let y = doc.lastAutoTable.finalY + 6 * e
    doc.setFontSize(7.5 * e); doc.setFont('times', 'normal')
    const linhaTotal = (rot, val, negrito) => {
      doc.setFont('times', 'normal'); doc.text(rot, x + larg - 16 * e, y, { align: 'right' })
      doc.setFont('times', negrito ? 'bold' : 'normal'); doc.rect(x + larg - 15 * e, y - 3.2 * e, 15 * e, 4.4 * e); doc.text(val, x + larg - 1, y, { align: 'right' })
    }
    doc.text(`NOME: ${rec.nome.toUpperCase()}`, x, y)
    linhaTotal('Total de Kms.', kmTxt(rec.totalKms), true); y += 5 * e
    doc.setFont('times', 'normal'); doc.text(`VIATURA: ${rec.viatura}`, x, y)
    linhaTotal('Preço por Km.', `${euro(mapa.cfg.precoKm)} €`); y += 5 * e
    linhaTotal('Total a Receber', `${euro(rec.total)} €`, true); y += (assinaturaValida(rec.assinatura) ? 20 : 9) * e
    doc.setFont('times', 'normal')
    doc.text(`${mapa.cfg.localAssinatura},   ${assin.dia} / ${assin.mes} / ${assin.ano}`, x + 2, y)
    doc.line(x + larg - 38 * e, y, x + larg - 2, y)
    const a = assinaturaValida(rec.assinatura)
    if (a) {
      const alt = Math.min(14 * e, 36 * e / a.ratio), w = alt * a.ratio
      doc.addImage(a.src, 'PNG', x + larg - 2 - 18 * e - w / 2, y - alt - 0.5, w, alt)
    }
  })
  return doc.output('arraybuffer')
}

// ---------- Estado guardado no navegador (página Mapa de kms) ----------
export const CHAVE_GUARDADO = 'faturaclaro-mapa-kms'
export function lerGuardado(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(CHAVE_GUARDADO) || '{}') || {} } catch { return {} }
}

// O mapa do mês tal como aparece na página: faturas das lojas + datas da Makro + idas à mão + trocas.
export function calcularMapa({ invoices, ano, mes, guardado = {} }) {
  const cfg = juntarConfig(guardado.config)
  const doMes = guardado.meses?.[`${ano}-${pad(mes)}`] || {}
  const periodo = periodoDoMes(ano, mes, cfg.diaInicio, cfg.fimPeriodos)
  // Formato antigo: dias do mês (números) em vez de datas.
  const data = d => (/^\d{1,2}$/.test(String(d)) ? isoDia(ano, mes, Number(d)) : String(d))
  const automaticas = juntarIdas(
    idasNoPeriodo(invoices, periodo, cfg.lojas),
    idasDeDias(datasNoPeriodo(MAKRO_CONHECIDAS, periodo), 'makro'),
    idasDeDias(datasNoPeriodo(guardado.makroDatas, periodo), 'makro'),
  )
  // Idas juntadas/tiradas à mão.
  const extra = [...(doMes.idasExtra || []).map(x => ({ data: data(x.data ?? x.dia), loja: x.loja })), ...(doMes.makroExtra || []).map(d => ({ data: data(d), loja: 'makro' }))]
  const tirar = [...(doMes.idasTirar || []), ...(doMes.makroTirar || []).map(d => `${d}:makro`)].map(t => { const [d, k] = t.split(':'); return `${data(d)}:${k}` })
  const idas = juntarIdas(automaticas, ...extra.map(x => ({ [x.data]: [x.loja] })))
  for (const t of tirar) { const [d, k] = t.split(':'); if (idas[d]) idas[d] = idas[d].filter(x => x !== k) }
  const base = gerarMapa({ ano, mes, idas, config: cfg, variante: doMes.variante || 0 })
  const mapa = (doMes.trocas || []).reduce((r, d) => trocarPessoa(r, d), base)
  return { cfg, doMes, periodo, automaticas, idas, mapa }
}

// A pessoa do mapa corresponde a um nome da folha de ordenados? (primeiro e último nome iguais;
// "Joel Matias Santos Mendes" casa com "Joel Matias dos Santos Mendes" mas não com "Joelma …")
export function mesmaPessoa(nomeFolha, nomeMapa) {
  const t = n => normal(n).split(/[^a-z]+/).filter(Boolean)
  const a = t(nomeFolha), b = t(nomeMapa)
  if (!a.length || !b.length) return false
  return a.includes(b[0]) && a.includes(b[b.length - 1])
}
