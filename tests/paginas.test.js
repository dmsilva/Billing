import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { parsePages, printRuleFor, validPages } from '../src/lib/paginas.js'
import { buildMergedPdf } from '../src/lib/pdfUnico.js'

describe('páginas a imprimir', () => {
  it('lê 1-2, 1 e 1,3 e ignora páginas que não existem', () => {
    expect(parsePages('1-2', 3)).toEqual([0, 1])
    expect(parsePages('1', 3)).toEqual([0])
    expect(parsePages(' 1, 3 ', 3)).toEqual([0, 2])
    expect(parsePages('2-5', 3)).toEqual([1, 2])
    expect(parsePages('', 2)).toEqual([0, 1])
    expect(parsePages('7', 2)).toEqual([0, 1])
    expect(validPages('1-2')).toBe(true)
    expect(validPages('todas')).toBe(true)
    expect(validPages('a')).toBe(false)
  })

  it('encontra a regra pelo remetente ou pelo domínio do email', () => {
    const rules = [{ id: 1, fornecedor: 'CUR Gás Natural', paginas_imprimir: '1-2' }, { id: 2, fornecedor: 'Vodafone', paginas_imprimir: '1' }, { id: 3, fornecedor: 'Makro', paginas_imprimir: null }]
    expect(printRuleFor(['CUR Gás Natural'], rules)?.id).toBe(1)
    expect(printRuleFor(['Fatura eletrónica', 'Fatura <faturas@vodafone.pt>'], rules)?.id).toBe(2)
    expect(printRuleFor(['Makro'], rules)).toBe(null)
  })
})

async function pdf(n) {
  const d = await PDFDocument.create()
  for (let i = 0; i < n; i++) d.addPage()
  return d.save()
}

describe('PDF para imprimir', () => {
  it('só as páginas pedidas e cada fatura numa folha nova', async () => {
    const store = { cur: await pdf(3), voda: await pdf(4), outra: await pdf(2) }
    const row = (id, data, path) => ({ id, data, fornecedor: id, valor: null, source: { invoice_files: [{ storage_path: path, mime: 'application/pdf' }] } })
    const rows = [row('cur', '2026-10-01', 'cur'), row('voda', '2026-10-02', 'voda'), row('outra', '2026-10-03', 'outra')]
    const pages = { cur: '1-2', voda: '1' }
    const a = await buildMergedPdf(rows, async p => store[p], { pagesFor: e => pages[e.row.id] })
    expect(a.pages).toBe(2 + 1 + 2)
    const b = await buildMergedPdf(rows, async p => store[p], { pagesFor: e => pages[e.row.id], newSheet: true })
    expect(b.pages).toBe(2 + 2 + 2) // Vodafone ganha uma página em branco
    const c = await buildMergedPdf([rows[0], rows[1]], async p => store[p], { pagesFor: e => pages[e.row.id], newSheet: true })
    expect(c.pages).toBe(3) // sem página em branco no fim
    expect((await PDFDocument.load(c.pdf)).getPageCount()).toBe(3)
  })
})
