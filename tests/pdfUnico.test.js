import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildMergedPdf, kindOf } from '../src/lib/pdfUnico.js'

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
const row = (id, data, files) => ({ id, data, fornecedor: `F${id}`, documento: '', valor: 1, source: { invoice_files: files } })

async function pdfWithPages(n) {
  const d = await PDFDocument.create()
  for (let i = 0; i < n; i++) d.addPage()
  return d.save()
}

describe('um só PDF com as faturas', () => {
  it('reconhece o tipo pelo conteúdo', () => {
    expect(kindOf(new TextEncoder().encode('%PDF-1.4'))).toBe('pdf')
    expect(kindOf(PNG)).toBe('png')
    expect(kindOf(Uint8Array.of(0xff, 0xd8, 0xff))).toBe('jpg')
    expect(kindOf(Uint8Array.of(1, 2, 3, 4), 'image/webp')).toBe('other')
  })

  it('junta PDFs e fotos por ordem de data e indica o que falhou', async () => {
    const two = await pdfWithPages(2)
    const store = { a: two, b: PNG, c: Uint8Array.of(1, 2, 3, 4) }
    const rows = [
      row(1, '2026-10-05', [{ storage_path: 'b', mime: 'image/png' }]),
      row(2, '2026-10-01', [{ storage_path: 'a', mime: 'application/pdf' }]),
      row(3, '2026-10-09', [{ storage_path: 'c', mime: 'image/heic' }]),
      row(4, '2026-10-02', []),
    ]
    const { pdf, count, failed, withoutFiles } = await buildMergedPdf(rows, async p => store[p])
    expect(count).toBe(2)
    expect(failed.map(e => e.row.id)).toEqual([3])
    expect(withoutFiles.map(r => r.id)).toEqual([4])
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBe(3)
  })

  it('usa a conversão para fotos noutros formatos', async () => {
    const rows = [row(1, '2026-10-05', [{ storage_path: 'x', mime: 'image/webp' }])]
    const { count } = await buildMergedPdf(rows, async () => Uint8Array.of(1, 2, 3, 4), { toJpeg: async () => PNG })
    expect(count).toBe(1)
  })
})
