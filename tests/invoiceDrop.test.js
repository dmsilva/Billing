import { describe, expect, it } from 'vitest'
import { firstQrAT, parseQrAT } from '../src/lib/qrAT.js'
import { buildDraft, docKey, draftToInvoice, findInvoiceDuplicates, supplierFromHistory } from '../src/lib/invoiceDrop.js'

const QR = 'A:500829993*B:999999990*C:PT*D:FS*E:N*F:20261103*G:FS 0123/45678*H:JJ37MKD9-45678*I1:PT*I3:10.00*I4:0.60*I7:20.00*I8:4.60*N:5.20*O:35.20*Q:k3Ls*R:1234'

describe('código QR AT', () => {
  it('lê os campos da fatura e soma o IVA de cada taxa', () => {
    expect(parseQrAT(QR)).toEqual({
      nif: '500829993', nif_cliente: null, tipo: 'FS', tipo_nome: 'Fatura simplificada', anulado: false,
      data: '2026-11-03', documento: 'FS 0123/45678', atcud: 'JJ37MKD9-45678', valor_total: 35.2, iva: 5.2,
    })
  })
  it('usa o total de impostos quando não há IVA por taxa e guarda o NIF do cliente', () => {
    const q = parseQrAT('A:123456789*B:514000000*C:PT*D:NC*E:A*F:20260231*G:NC A/1*H:0*I1:PT*N:2.30*O:12.30')
    expect(q).toMatchObject({ nif_cliente: '514000000', tipo: 'NC', anulado: true, data: null, atcud: null, iva: 2.3, valor_total: 12.3 })
  })
  it('ignora QR que não são de faturas', () => {
    expect(parseQrAT('https://example.com')).toBeNull()
    expect(parseQrAT('A:12*B:1')).toBeNull()
    expect(firstQrAT(['https://x', QR])?.nif).toBe('500829993')
  })
})

const invoices = [
  { id: 1, fornecedor: 'Pingo Doce', data: '2026-10-01', valor: 20, documento: 'FS 0123/40000', estado: 'Validada', categoria_id: 7, imovel_id: 2, pagamento: 'CGD', observacoes: 'NIF do fornecedor: 500829993' },
  { id: 2, fornecedor: 'Padaria X', data: '2026-11-03', valor: 9.5, documento: null, estado: 'Por validar', pagamento: 'Numerário', observacoes: null },
]
const properties = [{ id: 1, nome: "Chalet D'Ávila" }, { id: 2, nome: 'Chalet do Lago' }]

describe('rascunho da fatura arrastada', () => {
  it('o QR manda nos números; o nome e o imóvel vêm das faturas anteriores do mesmo NIF', () => {
    const d = buildDraft({ qr: parseQrAT(QR), leitura: { fornecedor: 'PINGO DOCE - DISTRIBUIÇÃO', nif: '500829993', valor_total: 35.9, iva: 5, descricao: 'Leite e pão', pagamento: 'cartao' }, invoices, properties, today: '2026-11-05' })
    expect(d).toMatchObject({ fornecedor: 'Pingo Doce', data: '2026-11-03', documento: 'FS 0123/45678', valor: '35,20', iva: '5,20', descricao: 'Leite e pão', imovel_id: '2', categoria_id: 7, pagamento: 'CGD', pagaNoAto: true, nif: '500829993', atcud: 'JJ37MKD9-45678' })
    expect(d.fonte).toMatchObject({ fornecedor: 'historico', valor: 'qr', descricao: 'ia' })
    expect(d.avisos.join(' ')).toMatch(/35,90 €.*35,20 €/)
  })
  it('fornecedor com regra: categoria e pagamento vêm da regra', () => {
    const rules = [{ id: 1, fornecedor: 'Grão de Trigo', categoria_id: 42, pagamento: 'Por pagar' }]
    const d = buildDraft({ qr: null, leitura: { fornecedor: 'GRAOTRIGO, LDA', nif: '222222222', data: '2026-11-02', documento: 'FT 9/1', valor_total: 20, iva: 1.2, pagamento: 'numerario' }, invoices, properties, rules, today: '2026-11-05' })
    expect(d).toMatchObject({ categoria_id: 42, pagamento: 'Por pagar', regraPagamento: 'Por pagar' })
    expect(d.fonte.pagamento).toBe('regra')
  })
  it('sem QR usa a leitura automática e avisa quando diz numerário', () => {
    const d = buildDraft({ qr: null, leitura: { fornecedor: 'Talho Y', nif: '111111111', data: '2026-11-02', documento: 'FT 1/2', valor_total: 50, iva: 3, pagamento: 'numerario', cliente: "Chalet D'Ávila, Lisboa" }, invoices, properties, today: '2026-11-05' })
    expect(d).toMatchObject({ fornecedor: 'Talho Y', valor: '50,00', imovel_id: '1', pagamento: 'Por pagar' })
    expect(d.fonte.valor).toBe('ia')
    expect(d.avisos.join(' ')).toMatch(/numerário/)
  })
  it('fatura (FT) fica por pagar; fatura-recibo fica paga e pergunta como', () => {
    const ft = parseQrAT(QR.replace('D:FS', 'D:FT'))
    expect(buildDraft({ qr: ft, leitura: { pagamento: 'numerario' }, invoices, properties, today: '2026-11-05' })).toMatchObject({ pagamento: 'Por pagar', pagaNoAto: false })
    const fr = parseQrAT(QR.replace('D:FS', 'D:FR'))
    const d = buildDraft({ qr: fr, leitura: null, invoices, properties, today: '2026-11-05' })
    expect(d).toMatchObject({ pagamento: '', pagaNoAto: true, tipo: 'Fatura-recibo' })
    expect(draftToInvoice(d, {}).error).toMatch(/como foi paga/)
    expect(buildDraft({ qr: fr, leitura: { pagamento: 'numerario' }, invoices, properties, today: '2026-11-05' })).toMatchObject({ pagamento: 'Numerário', fonte: { pagamento: 'ia' } })
  })
  it('sem QR usa o tipo lido do documento', () => {
    expect(buildDraft({ qr: null, leitura: { fornecedor: 'Loja', tipo_documento: 'fatura_recibo', pagamento: 'cartao' }, invoices, properties, today: '2026-11-05' })).toMatchObject({ pagamento: 'CGD', pagaNoAto: true, tipo: 'Fatura-recibo' })
    expect(buildDraft({ qr: null, leitura: { fornecedor: 'Loja', tipo_documento: 'fatura' }, invoices, properties, today: '2026-11-05' })).toMatchObject({ pagamento: 'Por pagar', pagaNoAto: false })
  })
  it('sem nada lido fica em branco com aviso', () => {
    const d = buildDraft({ qr: null, leitura: null, invoices, properties: [], today: '2026-11-05' })
    expect(d).toMatchObject({ fornecedor: '', valor: '', imovel_id: '' })
    expect(d.avisos[0]).toMatch(/Não foi possível ler/)
  })
  it('só procura histórico de faturas não rejeitadas com o mesmo NIF', () => {
    expect(supplierFromHistory('500829993', invoices)?.fornecedor).toBe('Pingo Doce')
    expect(supplierFromHistory('500829993', [{ ...invoices[0], estado: 'Rejeitada' }])).toBeNull()
    expect(supplierFromHistory(null, invoices)).toBeNull()
  })
})

describe('faturas repetidas', () => {
  const base = { fornecedor: 'Pingo Doce', nif: '500829993', data: '2026-10-01', documento: 'fs 0123-40000', valor: '20,00', atcud: '' }
  it('mesmo nº de documento do mesmo fornecedor é repetida', () => {
    expect(docKey('FS 0123/40000')).toBe(docKey('fs0123-40000'))
    expect(findInvoiceDuplicates(base, invoices)).toEqual([{ certeza: 'certo', invoice: invoices[0] }])
  })
  it('mesmo ATCUD é repetida mesmo com outro nº', () => {
    const list = [{ id: 3, fornecedor: 'Z', documento: 'X', valor: 1, data: '2026-01-01', observacoes: 'ATCUD: ABC-1' }]
    expect(findInvoiceDuplicates({ ...base, documento: '', atcud: 'abc-1' }, list)[0].certeza).toBe('certo')
  })
  it('mesmo fornecedor, data e valor sem nº é provável; outro valor não é', () => {
    expect(findInvoiceDuplicates({ fornecedor: 'Padaria X', nif: '', data: '2026-11-03', documento: '', valor: '9,50' }, invoices)[0].certeza).toBe('provavel')
    expect(findInvoiceDuplicates({ fornecedor: 'Padaria X', nif: '', data: '2026-11-03', documento: '', valor: '9,60' }, invoices)).toEqual([])
  })
  it('ignora as rejeitadas', () => {
    expect(findInvoiceDuplicates(base, [{ ...invoices[0], estado: 'Rejeitada' }])).toEqual([])
  })
})

describe('gravar', () => {
  const d = { fornecedor: ' Pingo Doce ', data: '2026-11-03', documento: 'FS 1', descricao: '', valor: '35,20', iva: '5,20', imovel_id: '2', categoria_id: 7, pagamento: 'Por pagar', nif: '500829993', atcud: 'JJ-1', fonte: { valor: 'qr' } }
  it('fica por pagar e por validar, com o NIF e o ATCUD nas observações', () => {
    const { row } = draftToInvoice(d, { userId: 'u1' })
    expect(row).toMatchObject({ fornecedor: 'Pingo Doce', valor: 35.2, iva: 5.2, imovel_id: 2, categoria_id: 7, pagamento: 'Por pagar', estado: 'Por validar', origem: 'manual', submitted_by: 'u1', descricao: null })
    expect(row.observacoes).toBe('NIF do fornecedor: 500829993\nATCUD: JJ-1\nAdicionada arrastando o ficheiro (valores do código QR).')
  })
  it('recusa valor inválido ou falta de data', () => {
    expect(draftToInvoice({ ...d, valor: 'abc' }, {}).error).toMatch(/valor/)
    expect(draftToInvoice({ ...d, data: '' }, {}).error).toMatch(/data/)
  })
})
