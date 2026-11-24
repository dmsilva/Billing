import { describe, expect, it } from 'vitest'
import { aplicarDescontos, descontosDoMes, extrato, idsDescontados, mesmaPessoa, resumoPorPessoa, valorHoras } from '../src/lib/dividas'

const fabio = [
  { id: 1, pessoa: 'Fábio', tipo: 'divida', data: '2026-04-17', valor: 1000 },
  { id: 2, pessoa: 'Fábio', tipo: 'pagamento', forma: 'horas', data: '2026-08-31', horas: 16, valor_hora: 7, valor: 112 },
  { id: 3, pessoa: 'Fabio', tipo: 'pagamento', forma: 'horas', data: '2026-09-30', horas: 3, valor_hora: 7, valor: 21 },
  { id: 4, pessoa: 'Fábio ', tipo: 'pagamento', forma: 'horas', data: '2026-11-30', horas: 41, valor_hora: 7, valor: 287 },
  { id: 5, pessoa: 'Fábio', tipo: 'adiantamento', data: '2026-11-10', valor: 425, descontar_mes: '2026-11' },
]

describe('dívidas dos colaboradores', () => {
  it('soma as horas extra do Fábio: 60 h × 7 € = 420 €, faltam 580 €', () => {
    const [r] = resumoPorPessoa(fabio)
    expect(r.pessoa).toBe('Fábio')
    expect(r.divida).toBe(1000)
    expect(r.pago).toBe(420)
    expect(r.falta).toBe(580)
    expect(r.horas).toBe(60)
    expect(r.porDescontar).toBe(425)
  })

  it('o adiantamento não mexe na dívida; o desconto no salário só abate depois de descontado', () => {
    const movs = [...fabio, { id: 6, pessoa: 'Fábio', tipo: 'pagamento', forma: 'salario', data: '2026-12-01', valor: 100, descontar_mes: '2026-12' }]
    expect(resumoPorPessoa(movs)[0].falta).toBe(580)
    movs[5] = { ...movs[5], descontado_em: '2027-01-02T10:00:00Z' }
    expect(resumoPorPessoa(movs)[0].falta).toBe(480)
    expect(extrato(movs).map(m => m.saldo)).toEqual([1000, 888, 867, 867, 580, 480])
  })

  it('valor das horas', () => {
    expect(valorHoras(41, 7)).toBe(287)
    expect(valorHoras(2.5, 7)).toBe(17.5)
  })

  it('casa o nome curto com o nome completo da folha do banco', () => {
    expect(mesmaPessoa('Fábio', 'FABIO MIGUEL SANTOS')).toBe(true)
    expect(mesmaPessoa('Fábio Santos', 'Fábio Miguel Santos')).toBe(true)
    expect(mesmaPessoa('Fábio', 'Fabiana Costa')).toBe(false)
    expect(mesmaPessoa('Fábio Costa', 'Fábio Miguel Santos')).toBe(false)
  })

  it('desconta o adiantamento no salário do mês e nos seguintes se ficou esquecido', () => {
    expect(descontosDoMes(fabio, '2026-10')).toEqual([])
    expect(descontosDoMes(fabio, '2026-11').map(d => d.id)).toEqual([5])
    expect(descontosDoMes(fabio, '2026-12').map(d => d.id)).toEqual([5])
    expect(descontosDoMes(fabio.map(m => ({ ...m, descontado_em: m.id === 5 ? '2026-12-01' : null })), '2026-12')).toEqual([])
  })

  it('tira o adiantamento ao valor a transferir', () => {
    const pagamentos = [
      { nome: 'Ana Silva', valor: 900, incluir: true },
      { nome: 'Fábio Miguel', valor: 1000.5, incluir: true },
    ]
    const r = aplicarDescontos(pagamentos, descontosDoMes([...fabio, { id: 9, pessoa: 'Rui', tipo: 'adiantamento', valor: 50, descontar_mes: '2026-11' }], '2026-11'))
    expect(r.pagamentos[0]).toEqual(pagamentos[0])
    expect(r.pagamentos[1].original).toBe(1000.5)
    expect(r.pagamentos[1].valor).toBe(575.5)
    expect(r.semPessoa.map(d => d.pessoa)).toEqual(['Rui'])
    expect(idsDescontados(r.pagamentos)).toEqual([5])
    expect(idsDescontados(r.pagamentos.map(p => ({ ...p, incluir: false })))).toEqual([])
  })
})
