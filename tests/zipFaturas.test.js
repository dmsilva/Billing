import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildInvoicesZip, zipPlan } from '../src/lib/zipFaturas.js'

const row = (id, data, fornecedor, valor, files = [], documento = '') => ({ id, data, fornecedor, documento, valor, descricao: '', categoria: 'Outros', pagamento: 'CGD', estado: 'Validada', source: { iva: null, invoice_files: files } })
const file = (p, nome, mime = 'application/pdf') => ({ storage_path: p, nome_ficheiro: nome, mime })

describe('ZIP com os ficheiros das faturas', () => {
  it('dá nomes legíveis, por ordem de data, e separa as que não têm ficheiro', () => {
    const { entries, withoutFiles } = zipPlan([
      row(2, '2026-10-20', 'EDP/Endesa: "Luz"', -12.5, [file('a', 'x.PDF')], 'NC 3'),
      row(1, '2026-10-03', 'Grão de Trigo', 45.3, [file('b', 'foto', 'image/jpeg'), file('c', 'y.pdf')], 'FT 12'),
      row(3, '2026-10-05', 'Sem anexo', 10, []),
    ])
    expect(entries.map(e => e.name)).toEqual([
      '001 2026-10-03 Grão de Trigo FT 12 45,30€ (1).jpg',
      '001 2026-10-03 Grão de Trigo FT 12 45,30€ (2).pdf',
      '003 2026-10-20 EDP Endesa Luz NC 3 -12,50€.pdf',
    ])
    expect(withoutFiles.map(r => r.id)).toEqual([3])
  })

  it('junta os ficheiros e a lista CSV, e continua se um falhar', async () => {
    const rows = [row(1, '2026-10-03', 'A', 1, [file('ok', 'a.pdf')]), row(2, '2026-10-04', 'B', 2, [file('falha', 'b.pdf')])]
    const { zip, count, failed } = await buildInvoicesZip(rows, async p => {
      if (p === 'falha') throw new Error('x')
      return new Blob([new TextEncoder().encode('%PDF-1')])
    })
    expect(count).toBe(1)
    expect(failed).toHaveLength(1)
    const out = unzipSync(zip)
    expect(Object.keys(out).sort()).toEqual(['001 2026-10-03 A 1,00€.pdf', 'lista-faturas.csv'])
    expect(strFromU8(out['001 2026-10-03 A 1,00€.pdf'])).toBe('%PDF-1')
    const csv = strFromU8(out['lista-faturas.csv'])
    expect(csv).toContain('001 2026-10-03 A 1,00€.pdf')
    expect(csv).toContain('Sem ficheiro')
  })
})
