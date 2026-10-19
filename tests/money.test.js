import { describe, expect, it } from 'vitest'
import { euro, euroExact, parseMoney, sameAmount, sub, sum } from '../src/lib/money.js'

describe('parseMoney (formatos portugueses)', () => {
  it.each([
    ['1.234,56', 1234.56], ['1234,56', 1234.56], ['12,30', 12.3], ['12.30', 12.3], ['1234.56', 1234.56],
    ['1,234.56', 1234.56], ['€ 12,30', 12.3], ['12,30 €', 12.3], ['-5,00', -5], ['(5,00)', -5], ['1 234,56', 1234.56],
    ['1.234', 1234], ['0.234', 0.234], ['165,642', 165.642], ['1.234.567,89', 1234567.89], [42, 42], ['0', 0],
  ])('%s → %s', (input, out) => expect(parseMoney(input)).toBeCloseTo(out, 6))

  it('rejeita texto inválido', () => {
    for (const v of ['abc', '12,3,4.5x', '', null, undefined, '1.2.3,4.5']) expect(parseMoney(v)).toBeNull()
  })

  it('corrige o erro do legado em que "1.234,56" era lido como 0 €', () => {
    expect(parseMoney('1.234,56')).toBe(1234.56)
  })
})

describe('somas exatas', () => {
  it('não acumula erros de vírgula flutuante', () => {
    expect(sum([0.1, 0.2])).toBe(0.3)
    expect(sum(Array(1000).fill(0.01))).toBe(10)
    expect(sub(1192.18, 1192.17)).toBe(0.01)
  })
  it('mantém 3 casas decimais quando existem', () => {
    expect(sum([165.642, 0.001])).toBe(165.643)
  })
  it('compara ao cêntimo', () => {
    expect(sameAmount(10, 10.004)).toBe(true)
    expect(sameAmount(10, 10.01)).toBe(false)
  })
})

describe('formatação', () => {
  it('usa o formato pt-PT', () => {
    expect(euro(1234.5)).toMatch(/^1\s?234,50\s€$/)
    expect(euro(124736.02)).toMatch(/^124\s736,02\s€$/)
    expect(euroExact(165.642)).toContain('165,642')
    expect(euroExact(12.3)).toContain('12,30')
  })
})
