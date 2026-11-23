import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { celulaDoTurno, grelhaDoPdf, horarioPrompt } from '../src/lib/horarioPdf.js'
import { contarHorario, lerOrdenados } from '../src/lib/ordenados.js'
import { readSchedule } from '../netlify/functions/ler-horario.mjs'

// Outubro de 2026 como o modelo o devolve: a folha começa a 28/09 e acaba a 01/11.
const dias = [28, 29, 30, ...Array.from({ length: 31 }, (_, i) => i + 1), 1]
const linha = d => d + 2
function lida() {
  const galia = dias.map(() => '07:00-15:30')
  const fabio = dias.map(() => '23:00-07:00')
  galia[linha(1)] = 'FERIAS'; galia[linha(2)] = 'Férias'; galia[linha(9)] = 'FALTA'; galia[linha(5)] = 'FERIADO'
  galia[0] = 'FERIAS' // 28/09 não conta para outubro
  fabio[linha(10)] = 'FOLGA'; fabio[linha(11)] = ''; fabio[linha(20)] = '15h-23h'; fabio[linha(27)] = '15:00 - 23:00'
  return { meses: [{ ano: 2026, mes: 9 }, { ano: 2026, mes: 10 }], ano: 2026, mes: 10, dias, funcionarios: [{ nome: 'Galia', turnos: galia }, { nome: 'Fábio', turnos: fabio }, { nome: '?', turnos: [] }] }
}

async function ordenados() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('salarios para contabilidade 1')
  ws.getCell('B1').value = 'Empresa, Lda.'
  ;[null, null, 'Venc.', 'Admissao', 130, 126, 181, 416, 413, 417, 170, null, 'IRS'].forEach((t, i) => { ws.getCell(3, i + 1).value = t })
  ;['Codigo', 'Nome', '', 'Data', 'Ajud. Custo', 'Feriado', 'Noites', 'Bx. Medica', 'Bx.Parentalid', 'Bx. Seguro', 'Ferias', 'Notas'].forEach((t, i) => { ws.getCell(4, i + 1).value = t || null })
  ws.getRow(5).values = [27, 'Galina Sabaeva', 1150]
  ws.getRow(6).values = [124, 'Fábio Carvalho', 920]
  const b = await wb.xlsx.writeBuffer()
  return { name: 'o.xlsx', arrayBuffer: async () => b }
}

describe('horário em PDF', () => {
  it('converte os códigos do modelo nas células do Excel', () => {
    expect(celulaDoTurno('23:00-07:00')).toMatchObject({ entrada: '23:00', saida: '07:00' })
    expect(celulaDoTurno('7h00 - 15h30')).toMatchObject({ entrada: '7h00', saida: '15h30' })
    expect(celulaDoTurno('Férias').texto).toBe('ferias')
    expect(celulaDoTurno('FOLGA')).toMatchObject({ entrada: null, texto: '' })
    expect(celulaDoTurno(undefined)).toMatchObject({ entrada: null, texto: '' })
  })

  it('conta como o Excel: férias, faltas, feriados, noites e dias de horário diurno', () => {
    const r = grelhaDoPdf(lida())
    expect(r.meses.map(m => m.folha)).toEqual(['Setembro 2026', 'Outubro 2026'])
    expect(r.grelha.funcionarios.map(f => f.nome)).toEqual(['Galia', 'Fábio'])
    const h = contarHorario(r.grelha, 2026, 10)
    const [galia, fabio] = h.funcionarios
    expect(galia).toMatchObject({ ferias: [1, 2], faltas: [9], feriados: [] })
    expect(fabio.noites).toBe(31 - 4)
    expect(fabio.diurnos).toEqual([20, 27])
    // 5/10 é feriado: o Fábio trabalhou nesse dia
    expect(fabio.feriados).toContain(5)
  })

  it('monta a folha da contabilidade a partir da grelha', async () => {
    const { grelha } = grelhaDoPdf(lida())
    const d = await lerOrdenados({ grelha }, await ordenados(), 2026, 10)
    expect(d.folhaHorario).toBe('Outubro 2026 (PDF)')
    const [galina, fabio] = d.linhas
    expect(galina).toMatchObject({ ferias: [1, 2], faltas: [9], noHorario: true })
    expect(fabio.noites).toBe(0) // recepcionista nocturno
    expect(fabio.nota).toContain('Horário diurno: 20, 27/10')
  })

  it('conta o feriado escrito ao lado do dia para quem trabalhou', () => {
    const l = lida()
    l.feriado = dias.map((_, i) => i === linha(12))
    const [galia] = contarHorario(grelhaDoPdf(l).grelha, 2026, 10).funcionarios
    expect(galia.feriados).toEqual([12])
  })

  it('recusa respostas sem mês, dias ou funcionários', () => {
    expect(() => grelhaDoPdf({ ...lida(), mes: 13 })).toThrow(/mês/)
    expect(() => grelhaDoPdf({ ...lida(), dias: [] })).toThrow(/dias/)
    expect(() => grelhaDoPdf({ ...lida(), funcionarios: [] })).toThrow(/funcionários/)
  })

  it('o pedido diz que mês transcrever', () => {
    expect(horarioPrompt(2026, 11)).toContain('Novembro 2026')
    expect(horarioPrompt(null, null)).toContain('o mês mais recente')
    expect(horarioPrompt(2026, 11)).toContain('blocos lado a lado')
  })
})

describe('função ler-horario', () => {
  const pdf = { media_type: 'application/pdf', data: 'AAAA' }
  const supa = role => ({
    auth: { getUser: async t => (t === 'ok' ? { data: { user: { id: 'u1' } } } : { error: { message: 'x' } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null }) }) }) }),
  })
  const claude = (reply, calls = []) => ({ messages: { create: async p => { calls.push(p); return reply } } })
  const ok = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(lida()) }] }

  it('só a administração pode ler e só aceita PDF', async () => {
    expect((await readSchedule({ supabase: supa('admin'), anthropic: claude(ok), token: '', body: { file: pdf } })).status).toBe(401)
    expect((await readSchedule({ supabase: supa('rececao'), anthropic: claude(ok), token: 'ok', body: { file: pdf } })).status).toBe(403)
    expect((await readSchedule({ supabase: supa('admin'), anthropic: claude(ok), token: 'ok', body: { file: { media_type: 'image/png', data: 'A' } } })).status).toBe(400)
  })

  it('devolve a grelha do mês pedido', async () => {
    const calls = []
    const r = await readSchedule({ supabase: supa('admin'), anthropic: claude(ok, calls), token: 'ok', body: { file: pdf, ano: 2026, mes: 10 } })
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b).toMatchObject({ ano: 2026, mes: 10 })
    expect(b.grelha.dias).toHaveLength(dias.length)
    expect(calls[0].messages[0].content[0].type).toBe('document')
    expect(calls[0].messages[0].content[1].text).toContain('Outubro 2026')
    expect(calls[0].output_config.format.type).toBe('json_schema')
  })

  it('responde 422 quando o modelo não devolve uma grelha', async () => {
    const r = await readSchedule({ supabase: supa('admin'), anthropic: claude({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"meses":[],"ano":2026,"mes":10,"dias":[],"funcionarios":[]}' }] }), token: 'ok', body: { file: pdf } })
    expect(r.status).toBe(422)
  })
})
