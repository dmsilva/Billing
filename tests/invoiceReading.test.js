import { describe, expect, it } from 'vitest'
import { applyReading, fileType, normalizeReading } from '../src/lib/invoiceReading.js'
import { contentBlocks, readInvoice } from '../netlify/functions/ler-fatura.mjs'
import { validateFile } from '../src/data/files.js'

const blank = { fornecedor: '', data: '2026-10-20', documento: '', valor: '', iva: '', observacoes: '' }

describe('tipo de ficheiro', () => {
  it('deduz o tipo pela extensão quando o telemóvel não o envia', () => {
    expect(fileType({ name: 'IMG_1.JPG', type: '' })).toBe('image/jpeg')
    expect(fileType({ name: 'fatura.pdf', type: '' })).toBe('application/pdf')
    expect(fileType({ name: 'x.heic', type: '' })).toBe('image/heic')
    expect(fileType({ name: 'x.png', type: 'image/png' })).toBe('image/png')
    expect(fileType({ name: 'x.docx', type: '' })).toBe('')
  })
  it('aceita ficheiros sem tipo com extensão conhecida', () => {
    expect(validateFile({ name: 'foto.jpeg', type: '', size: 1000 })).toBeNull()
    expect(validateFile({ name: 'nota.txt', type: '', size: 1000 })).toMatch(/formato não aceite/)
  })
})

describe('normalizeReading', () => {
  it('só aceita valores com formato válido', () => {
    expect(normalizeReading({ fornecedor: '  Pingo   Doce ', nif: 'PT 500 829 993', data: '2026-10-18', documento: 'FS 1/23', valor_total: 12.345, iva: 1.2 }))
      .toEqual({ fornecedor: 'Pingo Doce', nif: '500829993', data: '2026-10-18', documento: 'FS 1/23', valor_total: 12.35, iva: 1.2, pagamento: null, cliente: null, descricao: null })
    expect(normalizeReading({ data: '2026-02-30', nif: '123', valor_total: -4, iva: 'abc' }))
      .toEqual({ fornecedor: null, nif: null, data: null, documento: null, valor_total: null, iva: null, pagamento: null, cliente: null, descricao: null })
    expect(normalizeReading(null).fornecedor).toBeNull()
  })
})

describe('applyReading', () => {
  const leitura = { fornecedor: 'Makro', nif: '502123456', data: '2026-10-18', documento: 'FT A/99', valor_total: 45.5, iva: 8.51 }
  it('preenche os campos vazios e a data de hoje', () => {
    const { form, filled } = applyReading(blank, leitura, '2026-10-20')
    expect(form).toMatchObject({ fornecedor: 'Makro', data: '2026-10-18', documento: 'FT A/99', valor: '45,50', iva: '8,51', observacoes: 'NIF do fornecedor: 502123456' })
    expect(filled).toEqual(['fornecedor', 'data', 'documento', 'valor', 'nif', 'iva'])
  })
  it('não apaga o que a pessoa já escreveu', () => {
    const { form } = applyReading({ ...blank, fornecedor: 'Makro Lisboa', valor: '40', data: '2026-10-01', observacoes: 'urgente' }, leitura, '2026-10-20')
    expect(form).toMatchObject({ fornecedor: 'Makro Lisboa', valor: '40', data: '2026-10-01', observacoes: 'urgente\nNIF do fornecedor: 502123456' })
  })
  it('sem dados lidos não muda nada', () => {
    const { form, filled } = applyReading(blank, {}, '2026-10-20')
    expect(form).toEqual(blank)
    expect(filled).toEqual([])
  })
})

describe('função ler-fatura', () => {
  const img = { media_type: 'image/jpeg', data: 'AAAA' }
  const supa = role => ({
    auth: { getUser: async t => (t === 'ok' ? { data: { user: { id: 'u1' } } } : { error: { message: 'x' } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null }) }) }) }),
  })
  const claude = (reply, calls = []) => ({ messages: { create: async p => { calls.push(p); return reply } } })
  const ok = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ fornecedor: 'Makro', nif: null, data: '2026-10-18', documento: null, valor_total: 10, iva: null }) }] }
  const status = r => r.status
  const body = r => r.json()

  it('monta blocos de imagem e PDF e recusa o resto', () => {
    expect(contentBlocks([img, { media_type: 'application/pdf', data: 'BBBB' }]).blocks.map(b => b.type)).toEqual(['image', 'document'])
    expect(contentBlocks([{ media_type: 'image/heic', data: 'A' }]).error).toBeTruthy()
    expect(contentBlocks([]).error).toBeTruthy()
    expect(contentBlocks(Array(5).fill(img)).error).toBeTruthy()
  })
  it('exige sessão e papel de receção ou administradora', async () => {
    expect(status(await readInvoice({ supabase: supa('admin'), anthropic: claude(ok), token: '', body: { files: [img] } }))).toBe(401)
    expect(status(await readInvoice({ supabase: supa('admin'), anthropic: claude(ok), token: 'bad', body: { files: [img] } }))).toBe(401)
    expect(status(await readInvoice({ supabase: supa('pendente'), anthropic: claude(ok), token: 'ok', body: { files: [img] } }))).toBe(403)
  })
  it('devolve a leitura normalizada', async () => {
    const calls = []
    const r = await readInvoice({ supabase: supa('rececao'), anthropic: claude(ok, calls), token: 'ok', body: { files: [img] } })
    expect(status(r)).toBe(200)
    expect((await body(r)).leitura).toMatchObject({ fornecedor: 'Makro', data: '2026-10-18', valor_total: 10 })
    expect(calls[0].output_config.format.type).toBe('json_schema')
    expect(calls[0].messages[0].content[0].type).toBe('image')
  })
  it('responde 422 quando o modelo não devolve dados', async () => {
    const r = await readInvoice({ supabase: supa('admin'), anthropic: claude({ stop_reason: 'refusal', content: [] }), token: 'ok', body: { files: [img] } })
    expect(status(r)).toBe(422)
  })
})

describe('leitura alargada', () => {
  const props = [{ id: 1, nome: "Chalet D'Ávila" }, { id: 2, nome: 'Chalet do Lago' }]
  it('reconhece o imóvel pelo cliente da fatura', async () => {
    const { matchProperty } = await import('../src/lib/invoiceReading.js')
    expect(matchProperty('Chalet do Lago, Lda — Rua X, Sintra', props)).toBe(2)
    expect(matchProperty("CHALET D'AVILA AL", props)).toBe(1)
    expect(matchProperty('Consumidor final', props)).toBeNull()
    expect(matchProperty('Chalet', props)).toBeNull()
  })
  it('preenche pagamento, imóvel e descrição, sem mexer no que a pessoa escolheu', () => {
    const form = { ...blank, imovel_id: 1, pagamento: 'Numerário', descricao: '' }
    const leitura = { fornecedor: 'Continente', pagamento: 'cartao', cliente: 'Chalet do Lago', descricao: 'Pão e leite' }
    const r = applyReading(form, leitura, '2026-10-20', { properties: props })
    expect(r.form).toMatchObject({ pagamento: 'CGD', imovel_id: 2, descricao: 'Pão e leite' })
    const kept = applyReading(form, leitura, '2026-10-20', { properties: props, touched: { pagamento: true, imovel_id: true } })
    expect(kept.form).toMatchObject({ pagamento: 'Numerário', imovel_id: 1 })
  })
})

describe('erros da Anthropic', () => {
  it('traduz os erros mais comuns', async () => {
    const { friendlyClaudeError } = await import('../netlify/functions/ler-fatura.mjs')
    expect(friendlyClaudeError({ status: 400, message: 'Your credit balance is too low to access the Anthropic API.' })).toMatch(/saldo/)
    expect(friendlyClaudeError({ status: 401, message: 'invalid x-api-key' })).toMatch(/não é válida/)
    expect(friendlyClaudeError({ status: 529, message: 'Overloaded' })).toMatch(/indisponível/)
  })
})
