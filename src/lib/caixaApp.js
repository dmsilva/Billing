// Caixas vindas da app de caixa da receção (caixa-chaletdavila.netlify.app).
// Funções puras usadas pela função do Netlify (importação) e pela página "Caixas da receção".
import { sameAmount, sub, sum, sumBy } from './money.js'

// A partir deste dia as caixas vêm da app; antes continuam as do Excel.
export const CAIXAS_APP_INICIO = '2026-11-06'
export const MAX_DIAS_PEDIDO = 92
export const METODOS = {
  numerario: 'Numerário',
  multibanco: 'Multibanco',
  cartao: 'Cartão',
  cvVirtual: 'CV virtual',
  transferencia: 'Transferência',
  expedia: 'Expedia',
  airbnb: 'Airbnb',
}
// Ficam pendentes até a plataforma pagar.
export const METODOS_PLATAFORMA = ['cvVirtual', 'expedia', 'airbnb']
const SHIFT_ORDER = { '7h': 0, '15h': 1, '23h': 2 }

const ISO = /^\d{4}-\d{2}-\d{2}$/
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Hoje em Lisboa (a função do Netlify corre em UTC).
export function hojeLisboa(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

// Que dias pedir à app: desde o primeiro dia ainda não fechado (ou o dia a seguir ao último
// importado) até hoje. Nunca antes de 06/11/2026.
export function periodoEmFalta(dias, hoje) {
  const abertos = dias.filter(d => !d.dia_fechado).map(d => d.data).sort()
  const ultimo = dias.map(d => d.data).sort().at(-1)
  let from = abertos[0] || (ultimo ? addDays(ultimo, 1) : CAIXAS_APP_INICIO)
  if (from < CAIXAS_APP_INICIO) from = CAIXAS_APP_INICIO
  if (from > hoje) return null
  return { from, to: hoje }
}

// Divide um período em pedidos de no máximo 92 dias.
export function partirPeriodo(from, to, max = MAX_DIAS_PEDIDO) {
  if (!ISO.test(from) || !ISO.test(to) || from > to) return []
  const out = []
  for (let a = from; a <= to; a = addDays(a, max)) {
    const b = addDays(a, max - 1)
    out.push({ from: a, to: b < to ? b : to })
  }
  return out
}

// Confere a resposta de /api/export e devolve só os dias a partir de 06/11/2026.
export function diasDaResposta(body) {
  if (!body || !Array.isArray(body.dias)) throw new Error('A app de caixa devolveu uma resposta sem "dias".')
  return body.dias.filter(d => d && ISO.test(String(d.data)) && d.data >= CAIXAS_APP_INICIO)
}

export const compararTurnos = (a, b) => (a.data === b.data ? SHIFT_ORDER[a.turno] - SHIFT_ORDER[b.turno] : a.data.localeCompare(b.data))
const n = v => Number(v || 0)

// Multibanco + cartão do dia: o que tem de bater com o talão de fecho do TPA.
export const tpaEsperado = dia => sum([n(dia.totais?.multibanco), n(dia.totais?.cartao)])

export function estadoTpa(dia) {
  const esperado = tpaEsperado(dia)
  if (dia.tpa_talao == null) return { estado: 'por_conferir', esperado }
  const diferenca = sub(dia.tpa_talao, esperado)
  if (sameAmount(diferenca, 0)) return { estado: 'ok', esperado, diferenca: 0 }
  // Pista: se a diferença é igual ao CV virtual, o CV foi passado no TPA.
  const cv = n(dia.totais?.cvVirtual)
  return { estado: 'diferente', esperado, diferenca, pareceCv: cv !== 0 && sameAmount(diferenca, cv) }
}

export function estadoEnvelope(t) {
  if (!t.fechado) return { estado: 'aberto' }
  if (t.envelope_recebido == null) return { estado: 'por_conferir' }
  const diferenca = sub(t.envelope_recebido, t.envelope_esperado ?? t.envelope)
  const mudou = t.envelope_esperado != null && !sameAmount(t.envelope_esperado, t.envelope)
  return { estado: sameAmount(diferenca, 0) ? 'ok' : 'diferente', diferenca, mudou }
}

// Tudo o que merece atenção, do mais recente para o mais antigo.
export function alertas({ dias, turnos, hoje }) {
  const out = []
  for (const t of turnos) {
    if (t.diferenca != null && !sameAmount(t.diferenca, 0)) out.push({ tipo: 'diferenca', data: t.data, turno: t.turno, valor: Number(t.diferenca), texto: `Diferença de caixa no fecho${t.fechado_por ? ` (${t.fechado_por})` : ''}`, observacao: t.observacao })
    else if (t.observacao) out.push({ tipo: 'observacao', data: t.data, turno: t.turno, texto: `Observação${t.fechado_por ? ` de ${t.fechado_por}` : ''}`, observacao: t.observacao })
    const env = estadoEnvelope(t)
    if (env.estado === 'diferente') out.push({ tipo: 'envelope', data: t.data, turno: t.turno, valor: env.diferenca, texto: 'O envelope não bate com a app', observacao: t.envelope_nota })
    if (env.mudou) out.push({ tipo: 'mudou', data: t.data, turno: t.turno, texto: `A app mudou o envelope depois de conferido (era ${t.envelope_esperado}, agora ${t.envelope})` })
  }
  for (const d of dias) {
    const tpa = estadoTpa(d)
    if (tpa.estado === 'diferente') out.push({ tipo: 'tpa', data: d.data, valor: tpa.diferenca, texto: tpa.pareceCv ? 'Talão do TPA não bate com MB + cartão (a diferença é igual ao CV virtual)' : 'Talão do TPA não bate com MB + cartão', observacao: d.tpa_nota })
    if (!d.dia_fechado && hoje && d.data < hoje) out.push({ tipo: 'aberto', data: d.data, texto: 'Dia com turnos por fechar na app' })
  }
  return out.sort((a, b) => b.data.localeCompare(a.data) || (SHIFT_ORDER[a.turno] ?? 3) - (SHIFT_ORDER[b.turno] ?? 3))
}

// Pendentes das plataformas agrupados por método, com totais.
export function resumoPendentes(pendentes) {
  return METODOS_PLATAFORMA.map(metodo => {
    const linhas = pendentes.filter(p => p.metodo === metodo)
    const abertos = linhas.filter(p => !p.confirmado_em)
    return { metodo, nome: METODOS[metodo], abertos, confirmados: linhas.filter(p => p.confirmado_em), total: sumBy(abertos, p => p.valor) }
  })
}

// Totais por método num conjunto de dias.
export function totaisDias(dias) {
  const out = {}
  for (const k of [...Object.keys(METODOS), 'total', 'taxaTuristica']) out[k] = sumBy(dias, d => n(d.totais?.[k]))
  return out
}

export const documentosVisiveis = dia => (Array.isArray(dia.documentos) ? dia.documentos : [])
