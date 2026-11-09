import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { detectChannel, parseSaft, saftText } from '../src/lib/saft.js'
import { numberingGaps, saftByMonth, saftReconcile } from '../src/lib/saftReconcile.js'
import { monthResult } from '../src/lib/finance.js'

const line = (n, desc, valor, taxa, ref = '') => `<Line><LineNumber>${n}</LineNumber><ProductCode>${desc}</ProductCode><ProductDescription>${desc}</ProductDescription>${ref ? `<References><Reference>${ref}</Reference></References>` : ''}<${ref ? 'DebitAmount' : 'CreditAmount'}>${valor}</${ref ? 'DebitAmount' : 'CreditAmount'}><Tax><TaxPercentage>${taxa}</TaxPercentage></Tax></Line>`
const invoice = ({ no, tipo = 'FT', estado = 'N', data, cliente, lines, liquido, iva, total }) =>
  `<Invoice><InvoiceNo>${no}</InvoiceNo><DocumentStatus><InvoiceStatus>${estado}</InvoiceStatus></DocumentStatus><InvoiceDate>${data}</InvoiceDate><InvoiceType>${tipo}</InvoiceType><CustomerID>${cliente}</CustomerID>${lines.join('')}<DocumentTotals><TaxPayable>${iva}</TaxPayable><NetTotal>${liquido}</NetTotal><GrossTotal>${total}</GrossTotal></DocumentTotals></Invoice>`
const payment = ({ no, estado = 'N', data, meio = 'TB', valor, docs }) =>
  `<Payment><PaymentRefNo>${no}</PaymentRefNo><TransactionDate>${data}</TransactionDate><DocumentStatus><PaymentStatus>${estado}</PaymentStatus></DocumentStatus><PaymentMethod><PaymentMechanism>${meio}</PaymentMechanism><PaymentAmount>${valor}</PaymentAmount><PaymentDate>${data}</PaymentDate></PaymentMethod>${docs.map(([d, v]) => `<Line><SourceDocumentID><OriginatingON>${d}</OriginatingON></SourceDocumentID><CreditAmount>${v}</CreditAmount></Line>`).join('')}<DocumentTotals><GrossTotal>${valor}</GrossTotal></DocumentTotals></Payment>`

const XML = `<?xml version="1.0" encoding="Windows-1252"?>
<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01"><Header><CompanyID>500000000</CompanyID><TaxRegistrationNumber>500000000</TaxRegistrationNumber><CompanyName>Alojamento &amp; Avila Lda</CompanyName><StartDate>2026-09-01</StartDate><EndDate>2026-09-30</EndDate><ProductID>Teste</ProductID></Header>
<MasterFiles>
<Customer><CustomerID>1</CustomerID><CustomerTaxID>999999990</CustomerTaxID><CompanyName>Consumidor Final</CompanyName></Customer>
<Customer><CustomerID>2</CustomerID><CustomerTaxID>999999990</CustomerTaxID><CompanyName>Hóspede Airbnb Silva</CompanyName></Customer>
<Customer><CustomerID>3</CustomerID><CustomerTaxID>123456789</CustomerTaxID><CompanyName>Grupo Escola</CompanyName></Customer>
</MasterFiles>
<SourceDocuments>
<SalesInvoices><NumberOfEntries>5</NumberOfEntries>
${invoice({ no: 'FT A/10', data: '2026-09-01', cliente: 1, lines: [line(1, 'City Tax', 8, 0), line(2, 'Quarto duplo', 100, 6)], liquido: 108, iva: 6, total: 114 })}
${invoice({ no: 'FT A/11', data: '2026-09-01', cliente: 2, lines: [line(1, 'Quarto', 50, 6)], liquido: 50, iva: 3, total: 53 })}
${invoice({ no: 'FT A/13', estado: 'A', data: '2026-09-02', cliente: 3, lines: [line(1, 'Quarto', 200, 6)], liquido: 200, iva: 12, total: 212 })}
${invoice({ no: 'FT A/14', data: '2026-09-02', cliente: 3, lines: [line(1, 'City Tax', 4, 0), line(2, 'Quarto', 100, 6)], liquido: 104, iva: 6, total: 110 })}
${invoice({ no: 'NC A/1', tipo: 'NC', data: '2026-09-03', cliente: 2, lines: [line(1, 'Quarto', 10, 6, 'FT A/11')], liquido: 10, iva: 0.6, total: 10.6 })}
</SalesInvoices>
<WorkingDocuments><WorkDocument><DocumentNumber>OR A/1</DocumentNumber></WorkDocument></WorkingDocuments>
<Payments>
${payment({ no: 'RG A/1', data: '2026-09-01', valor: 114, docs: [['FT A/10', 108]] })}
${payment({ no: 'RG A/2', estado: 'A', data: '2026-09-02', valor: 212, docs: [['FT A/13', 200]] })}
${payment({ no: 'RG A/3', data: '2026-09-02', meio: 'CC', valor: 80, docs: [['FT A/9', 80]] })}
</Payments>
</SourceDocuments></AuditFile>`

const latin1 = s => Uint8Array.from([...s].map(c => c.charCodeAt(0)))

function zipOf(name, bytes) {
  const data = deflateRawSync(bytes)
  const h = Buffer.alloc(30)
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(8, 8)
  h.writeUInt32LE(data.length, 18); h.writeUInt32LE(bytes.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28)
  return new Uint8Array(Buffer.concat([h, Buffer.from(name), data]))
}

describe('leitura do SAF-T', () => {
  it('lê o ficheiro em Windows-1252, também dentro de um .zip', async () => {
    const xml = await saftText(zipOf('SAF-T.xml', latin1(XML)))
    expect(xml).toContain('Hóspede Airbnb Silva')
    expect(await saftText(latin1(XML))).toBe(xml)
  })

  const p = parseSaft(XML)
  const doc = n => p.docs.find(d => d.numero === n)
  it('lê cabeçalho, documentos e totais', () => {
    expect(p.info).toMatchObject({ nif: '500000000', empresa: 'Alojamento & Avila Lda', inicio: '2026-09-01', fim: '2026-09-30', recibos: 3 })
    expect(p.docs).toHaveLength(5)
    // 114 + 53 + 110 − 10,6 (a anulada não conta)
    expect(p.info.total).toBe(266.4)
    expect(p.orcamentos).toBe(1)
  })
  it('separa a taxa turística, o canal e as referências das notas de crédito', () => {
    expect(doc('FT A/10').city_tax).toBe(8)
    expect(doc('FT A/11').canal).toBe('Airbnb')
    expect(doc('FT A/14').canal).toBe('Grupo')
    expect(doc('NC A/1').referencias).toEqual(['FT A/11'])
    expect(doc('FT A/13').estado).toBe('A')
  })
  it('liga os recibos às faturas e guarda os de outros meses à parte', () => {
    expect(doc('FT A/10')).toMatchObject({ recibos: ['RG A/1'], valor_recebido: 114, meios: ['TB'] })
    expect(doc('FT A/13').recibos).toEqual([])
    expect(p.recibosFora).toEqual([{ numero: 'FT A/9', recibo: 'RG A/3', valor: 80, meio: 'CC' }])
  })
  it('recusa ficheiros que não são SAF-T', () => {
    expect(() => parseSaft('<html></html>')).toThrow(/SAF-T/)
  })
  it('deteta o canal pelo texto', () => {
    expect(detectChannel('Reserva via Expedia')).toBe('Expedia')
    expect(detectChannel('Maria')).toBeNull()
  })
})

describe('cruzamento com a caixa e o banco', () => {
  const { docs } = parseSaft(XML)
  const closes = [
    { data: '2026-09-01', turno: '23h', dinheiro: 20, cv: 50, mb: 40, city_mb: 4 },
    { data: '2026-09-03', turno: '7h', dinheiro: 0, cv: 0, mb: 0, city_mb: 0 },
  ]
  const credits = [
    { data_mov: '2026-09-01', tipo: 'TPA / Multibanco', valor: 90 },
    { data_mov: '2026-09-03', tipo: 'TPA / Multibanco', valor: 300 },
    { data_mov: '2026-09-05', tipo: 'Expedia', valor: 60 },
    { data_mov: '2026-09-06', tipo: 'Transferência', valor: 7, conta_como_entrada: false },
  ]
  const r = saftReconcile('2026-09', { docs, closes, credits })

  it('compara o faturado com o recebido sem contar o TPA duas vezes', () => {
    expect(r.faturado).toBe(266.4)
    expect(r.cityTax).toBe(12)
    expect(r.caixa).toBe(114)
    expect(r.banco).toBe(60)
    expect(r.tpa).toBe(390)
    expect(r.recebido).toBe(174)
    expect(r.diferenca).toBe(92.4)
  })
  it('mostra dia a dia e marca os dias sem caixa e com TPA diferente', () => {
    const d1 = r.dias.find(d => d.dia === '2026-09-01')
    expect(d1).toMatchObject({ documentos: 2, faturado: 167, caixa: 114, cartoes: 90, tpa: 90, diferenca: 53, semCaixa: false, tpaNaoBate: false })
    expect(r.diasSemCaixa.map(d => d.dia)).toEqual(['2026-09-02', '2026-09-03'])
    expect(r.diasTpaNaoBate).toEqual([])
  })
  it('lista faturas sem recibo, anuladas sem substituição e notas de crédito', () => {
    expect(r.semRecibo.map(d => d.numero)).toEqual(['FT A/11', 'FT A/14'])
    // A FT A/13 anulada tem a FT A/14 para o mesmo cliente.
    expect(r.anuladas.map(d => d.numero)).toEqual(['FT A/13'])
    expect(r.anuladasSemSubstituicao).toEqual([])
    expect(r.notasCredito.map(d => d.numero)).toEqual(['NC A/1'])
    expect(r.porCanal).toEqual([{ canal: 'Grupo', total: 110 }, { canal: 'Sem canal', total: 114 }, { canal: 'Airbnb', total: 42.4 }].sort((a, b) => b.total - a.total))
  })
  it('encontra saltos na numeração', () => {
    expect(r.saltos).toEqual(['FT A/12'])
    expect(numberingGaps([{ numero: 'FT B/1' }, { numero: 'FT B/2' }])).toEqual([])
  })
  it('o faturado do SAF-T passa a ser o faturado dos Resultados', () => {
    const saft = saftByMonth(docs)
    expect(saft['2026-09']).toEqual({ total: 266.4, cityTax: 12 })
    const expenseRows = [{ kind: 'bank', data: '2026-09-10', valor: 100, pagamento: 'CGD', contaComoDespesa: true }]
    const m = monthResult('2026-09', { closes, credits, expenseRows, saft })
    expect(m.fonteFaturado).toBe('SAF-T')
    expect(m.faturado).toBe(266.4)
    expect(m.recebido).toBe(174)
    expect(m.diferencaSaft).toBe(92.4)
    const semSaft = monthResult('2026-09', { closes, credits, expenseRows })
    expect(semSaft.faturado).toBe(174)
    expect(semSaft.saft).toBeNull()
  })
})
