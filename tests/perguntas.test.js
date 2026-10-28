import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalClient } from '../src/local/localClient'
import expected from '../src/data/legacyExpected.json'
import { legacyAsDb } from './helpers.js'
import { cashEntries } from '../src/lib/finance.js'
import { TOOLS, consultar, correrFerramenta, resultados, validarConsulta, validarHistorico } from '../src/lib/perguntas.js'
import { parseBlocks, parseInline } from '../src/lib/markdownLite.js'
import { answerQuestion } from '../netlify/functions/perguntar.mjs'

const memoryStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) } }
const db = legacyAsDb()

describe('validação das consultas', () => {
  it('só aceita tabelas, colunas e operadores conhecidos', () => {
    expect(validarConsulta({ tabela: 'profiles' }).error).toMatch(/Tabela desconhecida/)
    expect(validarConsulta({ tabela: 'faturas', filtros: [{ coluna: 'submitted_by', op: 'eq', valor: 'x' }] }).error).toMatch(/Coluna desconhecida/)
    expect(validarConsulta({ tabela: 'faturas', filtros: [{ coluna: 'valor', op: 'or', valor: 1 }] }).error).toMatch(/Operador/)
    expect(validarConsulta({ tabela: 'faturas', colunas: ['id', 'storage_path'] }).error).toMatch(/storage_path/)
    expect(validarConsulta({ tabela: 'faturas', filtros: [{ coluna: 'valor', op: 'gt' }] }).error).toMatch(/Falta o valor/)
    expect(validarConsulta({ tabela: 'categorias', agrupar_por: 'mes' }).error).toMatch(/não tem data/)
  })
  it('limita o número de linhas e ordena pela data mais recente por omissão', () => {
    const { value } = validarConsulta({ tabela: 'movimentos_cgd', limite: 5000 })
    expect(value).toMatchObject({ limite: 100, ordenar: 'data_mov', descendente: true })
  })
  it('as ferramentas descrevem todas as tabelas', () => {
    expect(TOOLS.map(t => t.name)).toEqual(['consultar', 'resultados'])
    expect(TOOLS[0].description).toContain('caixa_diaria')
  })
})

describe('histórico da conversa', () => {
  it('aceita só texto e acaba sempre numa pergunta', () => {
    expect(validarHistorico([]).error).toBeTruthy()
    expect(validarHistorico([{ role: 'user', content: 'olá' }, { role: 'assistant', content: 'resposta' }]).error).toBeTruthy()
    expect(validarHistorico([{ role: 'user', content: 'a' }, { role: 'system', content: 'x' }, { role: 'user', content: 'olá' }]).error).toBeTruthy()
    expect(validarHistorico([{ role: 'user', content: [{ type: 'text', text: 'x' }] }]).error).toBeTruthy()
    const longa = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }))
    const { value } = validarHistorico([...longa, { role: 'user', content: 'última' }])
    expect(value[0].role).toBe('user')
    expect(value.at(-1).content).toBe('última')
    expect(value.length).toBeLessThanOrEqual(12)
  })
})

describe('consultas sobre os dados reais (modo local)', () => {
  let sb
  beforeAll(async () => {
    sb = createLocalClient({ dataDir: 'memory://', storage: memoryStorage() })
    await sb.auth.signInWithPassword({ email: 'admin@local', password: 'x' })
  }, 60_000)

  it('numerário da caixa em setembro = soma da coluna dinheiro dos fechos', async () => {
    const r = await consultar(sb, { tabela: 'caixa_diaria', filtros: [{ coluna: 'data', op: 'gte', valor: '2026-09-01' }, { coluna: 'data', op: 'lt', valor: '2026-10-01' }], somar: ['dinheiro'], limite: 0 })
    const set = cashEntries(db.closes.filter(c => c.data.startsWith('2026-09')))
    expect(r.somas.dinheiro).toBe(set.dinheiro)
    expect(r.total_linhas).toBe(db.closes.filter(c => c.data.startsWith('2026-09')).length)
    expect(r.linhas).toBeUndefined()
  })

  it('agrupa por mês e soma como a app', async () => {
    const r = await consultar(sb, { tabela: 'caixa_diaria', somar: ['dinheiro', 'cv'], agrupar_por: 'mes', limite: 0 })
    expect(r.grupos.map(g => g.grupo)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
    expect(r.somas.dinheiro).toBe(expected.cashCloses.dinheiro)
    expect(r.somas.cv).toBe(expected.cashCloses.cv)
  })

  it('encontra uma fatura pelo número sem distinguir maiúsculas e mostra os nomes', async () => {
    const alvo = db.invoices.find(i => i.documento)
    const r = await consultar(sb, { tabela: 'faturas', filtros: [{ coluna: 'documento', op: 'contem', valor: alvo.documento.toLowerCase() }] })
    expect(r.total_linhas).toBeGreaterThanOrEqual(1)
    expect(r.linhas.some(l => l.documento === alvo.documento)).toBe(true)
    expect(r.linhas[0]).toHaveProperty('categoria')
    expect(r.linhas[0]).toHaveProperty('imovel', "Chalet D'Ávila")
    const nada = await consultar(sb, { tabela: 'faturas', filtros: [{ coluna: 'documento', op: 'contem', valor: '%' }] })
    expect(nada.total_linhas).toBe(db.invoices.filter(i => i.documento?.includes('%')).length)
  })

  it('agrupa saídas CGD por categoria com o nome', async () => {
    const r = await consultar(sb, { tabela: 'movimentos_cgd', somar: ['valor'], agrupar_por: 'categoria_id', limite: 0 })
    expect(r.somas.valor).toBe(expected.bank.total)
    expect(r.grupos.find(g => g.grupo === 'Transferência — empresa')).toMatchObject({ linhas: 2, valor: 5150 })
  })

  it('devolve o erro em vez de rebentar', async () => {
    expect(await correrFerramenta(sb, 'consultar', { tabela: 'x' })).toHaveProperty('erro')
    expect(await correrFerramenta(sb, 'apagar', {})).toHaveProperty('erro')
  })

  it('resultados usa as mesmas regras da página Resultados', async () => {
    const jul = await resultados(sb, { ano: 2026, mes: 7 })
    expect(jul.despesas).toBe(120940.51)
    expect(jul.caixa.total).toBe(cashEntries(db.closes.filter(c => c.data.startsWith('2026-07'))).total)
    const ano = await resultados(sb, { ano: 2026 })
    expect(ano.meses.length).toBe(9)
    expect(ano.totais_meses_completos.meses).toContain('2026-07')
    expect((await resultados(sb, { ano: 2026, mes: 13 })).erro).toBeTruthy()
  })

  it('a receção não vê os dados da administradora', async () => {
    const rec = createLocalClient({ dataDir: 'memory://', storage: memoryStorage() })
    await rec.auth.signInWithPassword({ email: 'rececao@local', password: 'x' })
    const r = await consultar(rec, { tabela: 'caixa_diaria', somar: ['dinheiro'], limite: 0 })
    expect(r.total_linhas).toBe(0)
    expect(r.somas.dinheiro).toBe(0)
  }, 60_000)
})

describe('texto das respostas', () => {
  it('lê parágrafos, listas e tabelas', () => {
    const b = parseBlocks('Sim, existe.\n\n- **FT 1**: 10,00 €\n- FT 2\n\n| Mês | Valor |\n|---|---:|\n| Set | 1 234,56 € |\n\nFim')
    expect(b.map(x => x.type)).toEqual(['paragraph', 'list', 'table', 'paragraph'])
    expect(b[2]).toEqual({ type: 'table', head: ['Mês', 'Valor'], rows: [['Set', '1 234,56 €']] })
  })
  it('só cria ligações internas', () => {
    expect(parseInline('Ver [fatura nº 12](/faturas/12) e **já**')).toEqual([{ text: 'Ver ' }, { link: 'fatura nº 12', href: '/faturas/12' }, { text: ' e ' }, { bold: 'já' }])
    expect(parseInline('[x](https://mau.example)')).toEqual([{ text: '[x](https://mau.example)' }])
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ text: '<img src=x onerror=alert(1)>' }])
  })
})

describe('função perguntar', () => {
  const supa = (role, tabela = []) => ({
    auth: { getUser: async t => (t === 'ok' ? { data: { user: { id: 'u1' } } } : { error: { message: 'x' } }) },
    from: t => t === 'profiles'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null }) }) }) }
      : fakeQuery(t === 'invoices' ? tabela : []),
  })
  // Construtor de consultas mínimo: só o que consultar() usa nestes testes.
  function fakeQuery(rows) {
    const q = {
      select: (_s, opts) => { q.count = opts?.count; return q },
      ilike: (c, v) => { const needle = v.replace(/^%|%$/g, '').toLowerCase(); rows = rows.filter(r => String(r[c] ?? '').toLowerCase().includes(needle)); return q },
      order: () => q,
      range: async (a, b) => ({ data: rows.slice(a, b + 1), count: q.count ? rows.length : null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    }
    return q
  }
  const faturas = [{ id: 7, data: '2026-09-03', fornecedor: 'Makro', documento: 'FT 2026/123', valor: 45.5, pagamento: 'CGD', estado: 'Validada', categoria_id: null, imovel_id: null }]
  const claude = replies => {
    const calls = []
    return { calls, messages: { create: async p => { calls.push(structuredClone(p)); return replies.shift() } } }
  }
  const pergunta = { mensagens: [{ role: 'user', content: 'Temos a fatura 2026/123?' }] }

  it('pede login e só deixa a administradora', async () => {
    expect((await answerQuestion({ supabase: supa('admin'), anthropic: claude([]), token: '', body: pergunta })).status).toBe(401)
    expect((await answerQuestion({ supabase: supa('admin'), anthropic: claude([]), token: 'mau', body: pergunta })).status).toBe(401)
    expect((await answerQuestion({ supabase: supa('rececao'), anthropic: claude([]), token: 'ok', body: pergunta })).status).toBe(403)
    expect((await answerQuestion({ supabase: supa('admin'), anthropic: claude([]), token: 'ok', body: { mensagens: [] } })).status).toBe(400)
  })

  it('consulta os dados e devolve a resposta final', async () => {
    const ai = claude([
      { stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't1', name: 'consultar', input: { tabela: 'faturas', filtros: [{ coluna: 'documento', op: 'contem', valor: '2026/123' }] } }] },
      { stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 8 }, content: [{ type: 'text', text: 'Sim: [fatura nº 7](/faturas/7) da Makro, 45,50 €.' }] },
    ])
    const res = await answerQuestion({ supabase: supa('admin', faturas), anthropic: ai, token: 'ok', body: pergunta, now: () => Date.parse('2026-10-28T10:00:00Z') })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resposta).toContain('/faturas/7')
    expect(body.uso).toMatchObject({ input: 30, output: 13, rondas: 2 })
    expect(ai.calls[0].messages[0].content).toContain('Hoje é 2026-10-28')
    const resultado = ai.calls[1].messages.at(-1).content[0]
    expect(resultado).toMatchObject({ type: 'tool_result', tool_use_id: 't1' })
    expect(JSON.parse(resultado.content)).toMatchObject({ total_linhas: 1, linhas: [{ id: 7, documento: 'FT 2026/123' }] })
    expect(ai.calls[0].tool_choice).toBeUndefined()
  })

  it('quando o tempo acaba, pede a resposta sem mais consultas', async () => {
    let t = 0
    const pedido = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'consultar', input: { tabela: 'faturas' } }] }
    const ai = claude([pedido, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Resposta parcial.' }] }])
    const res = await answerQuestion({ supabase: supa('admin', faturas), anthropic: ai, token: 'ok', body: pergunta, now: () => (t += 30_000) })
    expect((await res.json()).resposta).toBe('Resposta parcial.')
    expect(ai.calls[1].tool_choice).toEqual({ type: 'none' })
  })

  it('mostra uma mensagem simples quando a Anthropic falha', async () => {
    const ai = { messages: { create: async () => { throw Object.assign(new Error('Your credit balance is too low'), { status: 400 }) } } }
    const res = await answerQuestion({ supabase: supa('admin'), anthropic: ai, token: 'ok', body: pergunta })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/saldo/)
  })
})
