import { describe, expect, it } from 'vitest'
import { alertas, diasDaResposta, estadoEnvelope, estadoTpa, hojeLisboa, partirPeriodo, periodoEmFalta, resumoPendentes } from '../src/lib/caixaApp.js'
import { importarCaixas } from '../netlify/functions/caixas-app.mjs'

describe('período a importar', () => {
  it('começa em 06/11/2026 e nunca antes', () => {
    expect(periodoEmFalta([], '2026-11-10')).toEqual({ from: '2026-11-06', to: '2026-11-10' })
    expect(periodoEmFalta([], '2026-11-05')).toBeNull()
  })
  it('retoma no primeiro dia ainda aberto ou no dia a seguir ao último', () => {
    const dias = [{ data: '2026-11-06', dia_fechado: true }, { data: '2026-11-07', dia_fechado: false }, { data: '2026-11-08', dia_fechado: true }]
    expect(periodoEmFalta(dias, '2026-11-09').from).toBe('2026-11-07')
    expect(periodoEmFalta(dias.map(d => ({ ...d, dia_fechado: true })), '2026-11-09').from).toBe('2026-11-09')
  })
  it('parte em pedidos de 92 dias', () => {
    const p = partirPeriodo('2026-11-06', '2027-05-01')
    expect(p[0]).toEqual({ from: '2026-11-06', to: '2027-02-05' })
    expect(p.at(-1).to).toBe('2027-05-01')
    expect(p).toHaveLength(2)
  })
  it('hoje em Lisboa', () => {
    expect(hojeLisboa(new Date('2026-11-06T23:30:00Z'))).toBe('2026-11-06')
    expect(hojeLisboa(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02')
  })
  it('só aceita dias a partir de 06/11/2026', () => {
    expect(diasDaResposta({ dias: [{ data: '2026-11-05' }, { data: '2026-11-06' }, { data: 'x' }] })).toEqual([{ data: '2026-11-06' }])
    expect(() => diasDaResposta({})).toThrow(/dias/)
  })
})

describe('conferências', () => {
  it('talão do TPA contra multibanco + cartão', () => {
    const dia = { totais: { multibanco: 30, cartao: 20.5, cvVirtual: 120 } }
    expect(estadoTpa(dia).estado).toBe('por_conferir')
    expect(estadoTpa({ ...dia, tpa_talao: 50.5 }).estado).toBe('ok')
    const d = estadoTpa({ ...dia, tpa_talao: 170.5 })
    expect(d).toMatchObject({ estado: 'diferente', diferenca: 120, pareceCv: true })
  })
  it('envelope recebido, diferente e mudado na app', () => {
    expect(estadoEnvelope({ fechado: false }).estado).toBe('aberto')
    expect(estadoEnvelope({ fechado: true, envelope: 75 }).estado).toBe('por_conferir')
    expect(estadoEnvelope({ fechado: true, envelope: 75, envelope_recebido: 75, envelope_esperado: 75 }).estado).toBe('ok')
    expect(estadoEnvelope({ fechado: true, envelope: 75, envelope_recebido: 70, envelope_esperado: 75 })).toMatchObject({ estado: 'diferente', diferenca: -5 })
    expect(estadoEnvelope({ fechado: true, envelope: 80, envelope_recebido: 75, envelope_esperado: 75 }).mudou).toBe(true)
  })
  it('alertas com diferenças e observações em destaque', () => {
    const a = alertas({
      hoje: '2026-11-08',
      dias: [{ data: '2026-11-06', dia_fechado: false, totais: { multibanco: 10 }, tpa_talao: 12 }],
      turnos: [{ data: '2026-11-06', turno: '7h', fechado: true, diferenca: -5, observacao: 'faltam 5', envelope: 70 }, { data: '2026-11-07', turno: '15h', fechado: true, diferenca: 0, observacao: 'cliente pagou amanhã', envelope: 10 }],
    })
    expect(a.map(x => x.tipo)).toEqual(['observacao', 'diferenca', 'tpa', 'aberto'])
  })
  it('pendentes por plataforma', () => {
    const r = resumoPendentes([{ metodo: 'expedia', valor: 200 }, { metodo: 'expedia', valor: -50 }, { metodo: 'airbnb', valor: 10, confirmado_em: 'x' }])
    expect(r.find(x => x.metodo === 'expedia').total).toBe(150)
    expect(r.find(x => x.metodo === 'airbnb').abertos).toHaveLength(0)
  })
})

describe('função caixas-app', () => {
  const supa = (role = 'admin', dias = []) => {
    const calls = []
    return {
      calls,
      auth: { getUser: async t => (t === 'ok' ? { data: { user: { id: 'u' } } } : { error: { message: 'x' } }) },
      from: t => ({
        select: () => (t === 'profiles' ? { eq: () => ({ maybeSingle: async () => ({ data: { role } }) }) } : Promise.resolve({ data: dias })),
      }),
      rpc: async (fn, args) => { calls.push(args); return { data: { dias: args.p_dias.length, turnos: 0, fechos: 1, pendentes: 0 } } },
    }
  }
  const now = () => new Date('2026-11-07T10:00:00Z')

  it('recusa sem sessão ou sem ser administradora', async () => {
    expect((await importarCaixas({ supabase: supa(), token: '', caixaUrl: 'https://c', caixaKey: 'k' })).status).toBe(401)
    expect((await importarCaixas({ supabase: supa('rececao'), token: 'ok', caixaUrl: 'https://c', caixaKey: 'k' })).status).toBe(403)
  })
  it('pede os dias em falta com a chave no cabeçalho e grava', async () => {
    const s = supa('admin', [{ data: '2026-11-06', dia_fechado: true }])
    const pedidos = []
    const fetchImpl = async (url, opts) => { pedidos.push({ url, key: opts.headers['X-Api-Key'] }); return { ok: true, status: 200, json: async () => ({ geradoEm: '2026-11-07T10:00:00Z', dias: [{ data: '2026-11-07', turnos: [] }] }) } }
    const res = await importarCaixas({ supabase: s, token: 'ok', caixaUrl: 'https://caixa/', caixaKey: 'segredo', fetchImpl, now })
    expect(res.status).toBe(200)
    expect(pedidos).toEqual([{ url: 'https://caixa/api/export?from=2026-11-07&to=2026-11-07', key: 'segredo' }])
    expect(s.calls[0].p_gerado_em).toBe('2026-11-07T10:00:00Z')
    expect((await res.json()).fechos).toBe(1)
  })
  it('nada a fazer quando já está tudo', async () => {
    const s = supa('admin', [{ data: '2026-11-07', dia_fechado: true }])
    const res = await importarCaixas({ supabase: s, token: 'ok', caixaUrl: 'https://c', caixaKey: 'k', fetchImpl: () => { throw new Error('não devia pedir') }, now })
    expect((await res.json()).periodo).toBeNull()
  })
  it('chave recusada pela app', async () => {
    const res = await importarCaixas({ supabase: supa(), token: 'ok', caixaUrl: 'https://c', caixaKey: 'k', fetchImpl: async () => ({ ok: false, status: 401 }), now })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/CAIXA_EXPORT_KEY/)
  })
})
