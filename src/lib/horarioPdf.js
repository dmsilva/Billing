// Horário dos funcionários em PDF: o modelo transcreve a grelha de um mês e aqui passa-se para o
// mesmo formato que sai do Excel (ver contarHorario em ordenados.js), para as contas serem iguais.
// Lógica pura, usada no navegador e na função do Netlify ler-horario.
import { nomeMes } from './ordenados.js'

export const HORARIO_SCHEMA = {
  type: 'object',
  properties: {
    meses: {
      type: 'array',
      description: 'Todos os meses que aparecem no documento (um por folha/página de horário)',
      items: {
        type: 'object',
        properties: { ano: { type: 'integer' }, mes: { type: 'integer', description: '1 a 12' } },
        required: ['ano', 'mes'],
        additionalProperties: false,
      },
    },
    ano: { type: 'integer', description: 'Ano do mês transcrito' },
    mes: { type: 'integer', description: 'Mês transcrito, 1 a 12' },
    dias: { type: 'array', items: { type: 'integer' }, description: 'Coluna DIA, de cima para baixo, incluindo os dias do mês anterior/seguinte que a folha mostre' },
    funcionarios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome no cabeçalho da coluna, tal como está escrito' },
          turnos: { type: 'array', items: { type: 'string' }, description: 'Um código por dia, alinhado com "dias"' },
        },
        required: ['nome', 'turnos'],
        additionalProperties: false,
      },
    },
  },
  required: ['meses', 'ano', 'mes', 'dias', 'funcionarios'],
  additionalProperties: false,
}

export function horarioPrompt(ano, mes) {
  const pedido = ano && mes ? `${nomeMes(ano, mes)}` : 'o mês mais recente'
  return `Este documento é o horário dos funcionários de um alojamento local. Cada mês é uma grelha:
a coluna "DIA" tem o dia do mês (a folha costuma começar nos últimos dias do mês anterior e acabar no início do seguinte);
cada funcionário tem o nome no cabeçalho e duas colunas por baixo: hora de entrada e hora de saída.
Cores das células: azul = férias; vermelho = falta justificada; verde = folga. Ignora colunas com "?" no cabeçalho.

1. Em "meses", lista todos os meses que o documento tem.
2. Transcreve só ${pedido} (se não existir, o mais recente) e diz em "ano" e "mes" qual transcreveste.
3. Em "dias", põe cada número da coluna DIA, de cima para baixo, sem saltar nenhum.
4. Para cada funcionário, em "turnos", põe um código por linha de "dias" (o mesmo número de elementos):
   - "HH:MM-HH:MM" com as horas de entrada e saída (ex.: "07:00-15:30", "23:00-07:00");
   - "FERIAS" se a célula estiver a azul ou disser férias;
   - "FALTA" se estiver a vermelho ou disser falta;
   - "FERIADO" se disser feriado (feriado gozado, sem horas);
   - "FOLGA" se estiver a verde sem horas;
   - "" se estiver vazia.
Transcreve exatamente o que está no documento, sem inventar horas.`
}

const CODIGOS = { FERIAS: 'ferias', FALTA: 'falta', FERIADO: 'feriado' }

// Código do modelo → célula igual à que sai do Excel ({ entrada, saida, texto, cor }).
export function celulaDoTurno(turno) {
  const t = String(turno ?? '').trim()
  const codigo = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  if (CODIGOS[codigo]) return { entrada: null, saida: null, texto: CODIGOS[codigo], cor: '' }
  const m = t.match(/^(\d{1,2}(?:[:h]\d{2})?h?)\s*[-–a]\s*(\d{1,2}(?:[:h]\d{2})?h?)$/i)
  if (m) return { entrada: m[1], saida: m[2], texto: '', cor: '' }
  return { entrada: null, saida: null, texto: '', cor: '' } // folga, vazio ou ilegível
}

// Resposta do modelo → { meses, ano, mes, grelha } no formato de contarHorario.
export function grelhaDoPdf(lida) {
  const ok = n => Number.isInteger(n)
  const meses = (Array.isArray(lida?.meses) ? lida.meses : []).filter(m => ok(m?.ano) && ok(m?.mes) && m.mes >= 1 && m.mes <= 12)
  const ano = lida?.ano, mes = lida?.mes
  if (!ok(ano) || !ok(mes) || mes < 1 || mes > 12) throw new Error('Não consegui perceber de que mês é o horário.')
  if (!meses.some(m => m.ano === ano && m.mes === mes)) meses.push({ ano, mes })
  meses.sort((a, b) => a.ano - b.ano || a.mes - b.mes)
  const dias = (Array.isArray(lida.dias) ? lida.dias : []).filter(ok)
  if (!dias.length) throw new Error('Não encontrei a coluna dos dias no horário.')
  const funcionarios = (Array.isArray(lida.funcionarios) ? lida.funcionarios : [])
    .filter(f => typeof f?.nome === 'string' && f.nome.trim() && f.nome.trim() !== '?')
    .map(f => ({ nome: f.nome.trim(), turnos: Array.isArray(f.turnos) ? f.turnos : [] }))
  if (!funcionarios.length) throw new Error('Não encontrei funcionários no horário.')
  const celulas = funcionarios.map(f => dias.map((_, i) => celulaDoTurno(f.turnos[i])))
  // Como no Excel: um dia em que alguém tem "feriado" escrito conta como feriado para quem trabalhou.
  const grelha = {
    folha: `${nomeMes(ano, mes)} (PDF)`,
    dias: dias.map((dia, i) => ({ dia, feriado: celulas.some(c => c[i].texto === 'feriado') })),
    funcionarios: funcionarios.map((f, k) => ({ nome: f.nome, celulas: celulas[k] })),
  }
  return { meses: meses.map(m => ({ ...m, folha: nomeMes(m.ano, m.mes) })), ano, mes, grelha }
}

export const ePdf = file => file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '')
