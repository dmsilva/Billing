import { describe, expect, it } from 'vitest'
import { contaDe, mesAutomatico, pedirSaft, sincronizarMes, urlExportSaft } from '../src/lib/invoicexpress.js'
import { ivaPorTaxa } from '../src/lib/saft.js'
import { mapaIva, mapaIvaAno, taxaLabel } from '../src/lib/mapaIva.js'

const XML = `<?xml version="1.0" encoding="UTF-8"?><AuditFile><Header><TaxRegistrationNumber>513102914</TaxRegistrationNumber><CompanyName>Teste</CompanyName><StartDate>2026-10-01</StartDate><EndDate>2026-10-31</EndDate></Header>
<SourceDocuments><SalesInvoices>
<Invoice><InvoiceNo>FR A/1</InvoiceNo><DocumentStatus><InvoiceStatus>N</InvoiceStatus></DocumentStatus><InvoiceDate>2026-10-02</InvoiceDate><InvoiceType>FR</InvoiceType><CustomerID>1</CustomerID>
<Line><ProductDescription>Quarto</ProductDescription><CreditAmount>100</CreditAmount><Tax><TaxPercentage>6</TaxPercentage></Tax></Line>
<Line><ProductDescription>City Tax</ProductDescription><CreditAmount>4</CreditAmount><Tax><TaxPercentage>0</TaxPercentage></Tax><TaxExemptionCode>M99</TaxExemptionCode></Line>
<Line><ProductDescription>Bar</ProductDescription><CreditAmount>10</CreditAmount><Tax><TaxPercentage>23</TaxPercentage></Tax></Line>
<DocumentTotals><TaxPayable>8.3</TaxPayable><NetTotal>114</NetTotal><GrossTotal>122.3</GrossTotal></DocumentTotals></Invoice>
<Invoice><InvoiceNo>NC A/1</InvoiceNo><DocumentStatus><InvoiceStatus>N</InvoiceStatus></DocumentStatus><InvoiceDate>2026-10-03</InvoiceDate><InvoiceType>NC</InvoiceType><CustomerID>1</CustomerID>
<Line><ProductDescription>Quarto</ProductDescription><References><Reference>FR A/1</Reference></References><DebitAmount>50</DebitAmount><Tax><TaxPercentage>6</TaxPercentage></Tax></Line>
<DocumentTotals><TaxPayable>3</TaxPayable><NetTotal>50</NetTotal><GrossTotal>53</GrossTotal></DocumentTotals></Invoice>
</SalesInvoices></SourceDocuments></AuditFile>`

const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer })

function fakeAdmin() {
  const calls = { rpc: [], inserts: [] }
  return {
    calls,
    rpc: async (name, args) => { calls.rpc.push({ name, args }); return { data: { documentos: args.p_docs.length }, error: null } },
    from: () => ({ insert: async row => { calls.inserts.push(row); return { error: null } } }),
  }
}

describe('InvoiceXpress', () => {
  it('lê o nome da conta de várias formas', () => {
    expect(contaDe('chaletdavila')).toBe('chaletdavila')
    expect(contaDe('https://ChaletDavila.app.invoicexpress.com/documents')).toBe('chaletdavila')
    expect(contaDe('chaletdavila.app.invoicexpress.com')).toBe('chaletdavila')
  })

  it('fecha o mês anterior nos primeiros dias e depois atualiza o mês corrente', () => {
    expect(mesAutomatico(new Date('2026-11-03T05:00:00Z'))).toBe('2026-10')
    expect(mesAutomatico(new Date('2026-01-02T05:00:00Z'))).toBe('2025-12')
    expect(mesAutomatico(new Date('2026-11-09T05:00:00Z'))).toBe('2026-11')
  })

  it('monta o pedido de exportação do SAF-T', () => {
    expect(urlExportSaft('conta', 'k', '2026-09')).toBe('https://conta.app.invoicexpress.com/api/export_saft.json?api_key=k&month=9&year=2026')
  })

  it('interpreta as respostas da API', async () => {
    expect(await pedirSaft({ conta: 'c', apiKey: 'k', mes: '2026-10', fetchImpl: async () => resp(202, {}) })).toEqual({ estado: 'a_preparar' })
    expect(await pedirSaft({ conta: 'c', apiKey: 'k', mes: '2026-10', fetchImpl: async () => resp(200, { Url: 'https://x/s.xml' }) })).toEqual({ estado: 'ok', url: 'https://x/s.xml' })
    expect(await pedirSaft({ conta: 'c', apiKey: 'k', mes: '2026-10', fetchImpl: async () => resp(422, {}) })).toEqual({ estado: 'sem_documentos' })
    await expect(pedirSaft({ conta: 'c', apiKey: 'k', mes: '2026-10', fetchImpl: async () => resp(401, {}) })).rejects.toThrow(/chave/)
  })

  it('espera pelo ficheiro, importa e regista a sincronização', async () => {
    const admin = fakeAdmin()
    let n = 0
    const fetchImpl = async url => (url.includes('export_saft') ? (n++ < 1 ? resp(202, {}) : resp(200, { Url: 'https://x/s.xml' })) : resp(200, XML))
    const r = await sincronizarMes({ admin, conta: 'c', apiKey: 'k', mes: '2026-10', esperarMs: 1000, intervaloMs: 1, fetchImpl, automatico: true })
    expect(r.estado).toBe('ok')
    expect(admin.calls.rpc[0].args.p_info.origem).toBe('invoicexpress')
    expect(admin.calls.rpc[0].args.p_docs[0].por_taxa).toEqual([
      { taxa: 23, isencao: '', base: 10, iva: 2.3 },
      { taxa: 6, isencao: '', base: 100, iva: 6 },
      { taxa: 0, isencao: 'M99', base: 4, iva: 0 },
    ])
    expect(admin.calls.inserts[0]).toMatchObject({ mes: '2026-10', estado: 'ok', automatico: true, documentos: 2 })
  })

  it('regista o erro quando falta a configuração', async () => {
    const admin = fakeAdmin()
    const r = await sincronizarMes({ admin, conta: '', apiKey: '', mes: '2026-10' })
    expect(r.estado).toBe('erro')
    expect(admin.calls.inserts[0].mensagem).toMatch(/INVOICEXPRESS_API_KEY/)
  })

  it('devolve "a preparar" quando o ficheiro não fica pronto a tempo', async () => {
    const admin = fakeAdmin()
    const r = await sincronizarMes({ admin, conta: 'c', apiKey: 'k', mes: '2026-10', esperarMs: 0, fetchImpl: async () => resp(202, {}) })
    expect(r.estado).toBe('a_preparar')
  })
})

describe('Mapa de IVA', () => {
  it('agrupa as linhas por taxa', () => {
    expect(ivaPorTaxa([{ taxa: 6, valor: 33.33 }, { taxa: 6, valor: 66.67 }, { taxa: 0, isencao: 'M01', valor: 2 }]))
      .toEqual([{ taxa: 6, isencao: '', base: 100, iva: 6 }, { taxa: 0, isencao: 'M01', base: 2, iva: 0 }])
  })

  const docs = [
    { numero: 'FT A/1', tipo: 'FT', estado: 'N', data: '2026-10-01', iva: 6, por_taxa: [{ taxa: 6, isencao: '', base: 100, iva: 6 }, { taxa: 0, isencao: 'M99', base: 4, iva: 0 }] },
    { numero: 'FT A/2', tipo: 'FT', estado: 'A', data: '2026-10-01', iva: 60, por_taxa: [{ taxa: 6, isencao: '', base: 1000, iva: 60 }] },
    { numero: 'NC A/1', tipo: 'NC', estado: 'N', data: '2026-10-02', iva: 1.2, por_taxa: [{ taxa: 6, isencao: '', base: 20, iva: 1.2 }] },
    { numero: 'FT A/3', tipo: 'FT', estado: 'N', data: '2026-11-01', iva: 23, por_taxa: [{ taxa: 23, isencao: '', base: 100, iva: 23 }] },
  ]

  it('soma por taxa sem anuladas e com notas de crédito a subtrair', () => {
    const r = mapaIva(docs.slice(0, 3))
    expect(r.linhas.map(l => [taxaLabel(l), l.base, l.iva])).toEqual([['6%', 80, 4.8], ['Isento (M99)', 4, 0]])
    expect(r.iva).toBe(4.8)
    expect(r.ivaDocumentos).toBe(4.8)
    expect(r.diferencaIva).toBe(0)
  })

  it('faz o quadro do ano mês a mês', () => {
    const a = mapaIvaAno(docs, '2026')
    expect(a.meses.map(m => m.mes)).toEqual(['2026-10', '2026-11'])
    expect(a.taxas.map(t => t.key)).toEqual(['23|', '6|', '0|M99'])
    expect(a.total.iva).toBe(27.8)
  })
})
