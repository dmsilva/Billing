import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pdfTextItems } from '../src/lib/pdfLoader.js'
import { checkBalances, statementMatrix } from '../src/lib/pdfStatement.js'
import { parseBankStatement } from '../src/lib/bankImport.js'
import { parseMoney } from '../src/lib/money.js'

// Extrato sintético com o formato da CGD (gerado por tests/fixtures/gerar-extrato.py).
const pdf = readFileSync(new URL('./fixtures/extrato-sintetico.pdf', import.meta.url))

describe('extrato CGD em PDF', () => {
  it('reconstrói a tabela e separa saídas de entradas', async () => {
    const matrix = statementMatrix(await pdfTextItems(pdf, pdfjs))
    expect(matrix[0]).toEqual(['Data mov.', 'Data valor', 'Descrição', 'Débito', 'Crédito', 'Saldo'])
    const r = parseBankStatement(matrix)
    expect(r.error).toBeNull()
    expect(r.records.map(x => [x.data_mov, x.descricao, x.valor, x.saldo])).toEqual([
      ['2026-10-05', 'ENDESA ENERGIA', 45.02, 11905.53],
      ['2026-10-07', 'PAGAMENTO SERVICOS 1234', 1200, 10955.53],
    ])
    expect(r.credits.map(x => [x.data_mov, x.descricao, x.valor, x.tipo])).toEqual([
      ['2026-10-01', 'TRAVELSCAPE LLC 4471', 1830.55, 'Expedia'],
      ['2026-10-03', 'TRF CRED SEPA+ 0001234 DE JOHN SMITH', 120, 'Transferência'],
      ['2026-10-06', 'TRF MB WAY P/ ANA COSTA', 250, 'Transferência'],
    ])
    expect(checkBalances(matrix, parseMoney)).toEqual({ verificadas: 4, erradas: 0 })
  })

  it('lê o formato do extrato de depósitos à ordem (data de movimento "-", coluna "Data Valor")', () => {
    const line = (y, parts) => parts.map(([x, str, w = str.length * 4]) => ({ str, x, y, w }))
    const page = [
      ...line(576, [[142, 'Extrato n.º 010/2026'], [244, 'Emissão 2026-10-06'], [354, 'Período 2026-09-01 a 2026-09-30']]),
      ...line(462, [[63, 'Dt. Mov.'], [109, 'Data Valor', 38], [153, 'Descrição', 43], [440, 'Valor', 22], [480, 'Saldo Contabilístico', 87]]),
      ...line(451, [[153, 'Saldo Anterior'], [527, '62.070,46', 40]]),
      ...line(440, [[71, '-', 3], [84, '-', 3], [102, '2026-09-01', 46], [153, 'ENDESA ENERGIA'], [437, '-42,55', 25], [527, '62.027,91', 40]]),
      ...line(378, [[71, '-', 3], [84, '-', 3], [102, '2026-09-01', 46], [153, 'TRF STRIPE TECHNOLOGY'], [435, '194,78', 27], [527, '62.222,69', 40]]),
      ...line(368, [[71, '-', 3], [84, '-', 3], [102, '2026-09-01', 46], [153, '00854353 POS VENDAS'], [440, '72,57', 22], [527, '62.295,26', 40]]),
    ]
    const matrix = statementMatrix([page])
    const r = parseBankStatement(matrix)
    expect(r.records.map(x => [x.data_mov, x.descricao, x.valor, x.saldo])).toEqual([['2026-09-01', 'ENDESA ENERGIA', 42.55, 62027.91]])
    expect(r.credits.map(x => [x.descricao, x.valor, x.tipo])).toEqual([['TRF STRIPE TECHNOLOGY', 194.78, 'Stripe'], ['00854353 POS VENDAS', 72.57, 'TPA / Multibanco']])
    expect(checkBalances(matrix, parseMoney)).toEqual({ verificadas: 2, erradas: 0 })
  })

  it('aceita datas sem ano, valores com sinal no fim e extratos do mais recente para o mais antigo', () => {
    const line = (y, parts) => parts.map(([x, str, w = str.length * 4]) => ({ str, x, y, w }))
    const page = [
      ...line(800, [[40, 'Movimentos de 01-10-2026 a 31-10-2026']]),
      ...line(760, [[40, 'Data'], [150, 'Descrição'], [450, 'Montante', 32], [530, 'Saldo', 20]]),
      ...line(740, [[40, '06.10'], [150, 'STRIPE PAYMENTS'], [452, '455,10', 30], [520, '1.455,10', 30]]),
      ...line(728, [[40, '04.10'], [150, 'COMPRA CONTINENTE'], [452, '45,00-', 30], [520, '1.000,00', 30]]),
    ]
    const matrix = statementMatrix([page])
    expect(matrix[0]).toEqual(['Data mov.', 'Data valor', 'Descrição', 'Montante', 'Saldo'])
    const r = parseBankStatement(matrix)
    expect(r.records.map(x => [x.data_mov, x.valor])).toEqual([['2026-10-04', 45]])
    expect(r.credits.map(x => [x.data_mov, x.valor])).toEqual([['2026-10-06', 455.1]])
    expect(checkBalances(matrix, parseMoney).erradas).toBe(0)
  })
})
