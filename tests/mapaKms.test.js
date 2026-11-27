import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { diasMakro, gerarExcel, gerarMapa, gerarPdf, nomeFicheiro, semanasDoMes, trocarPessoa } from '../src/lib/mapaKms.js'

const CAL = { diaInicio: 1, fimPeriodos: { '2026-11': null } } // mês do calendário

const faturas = [
  { data: '2026-11-20', fornecedor: 'MAKRO Cash & Carry Portugal', estado: 'Validada' },
  { data: '2026-11-20', fornecedor: 'Makro', estado: 'Por validar' },
  { data: '2026-11-13', fornecedor: 'Makro', estado: 'Validada' },
  { data: '2026-11-09', fornecedor: 'Makro', estado: 'Validada' },
  { data: '2026-11-03', fornecedor: 'Makro', estado: 'Validada' },
  { data: '2026-11-05', fornecedor: 'Makro', estado: 'Rejeitada' },
  { data: '2026-10-27', fornecedor: 'Makro', estado: 'Validada' },
  { data: '2026-11-10', fornecedor: 'Continente', estado: 'Validada' },
]

describe('mapa de kms', () => {
  it('lê os dias da Makro do mês (sem repetidos nem rejeitadas)', () => {
    expect(diasMakro(faturas, 2026, 11)).toEqual([3, 9, 13, 20])
  })

  it('semanas de segunda a sábado', () => {
    const s = semanasDoMes(2026, 11) // 1/11/2026 é domingo
    expect(s[0]).toEqual([2, 3, 4, 5, 6, 7])
    expect(s.flat()).not.toContain(1)
    expect(s.flat()).toHaveLength(25)
  })

  const mapa = gerarMapa({ ano: 2026, mes: 11, makro: diasMakro(faturas, 2026, 11), config: CAL })

  it('cada dia útil é de uma só pessoa e os dias ficam repartidos', () => {
    const dias = mapa.registos.map(r => r.dia)
    expect(new Set(dias).size).toBe(dias.length)
    for (const d of semanasDoMes(2026, 11).flat()) expect(dias).toContain(d)
    const [a, b] = mapa.recibos.map(r => r.dias)
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1)
    const diasA = new Set(mapa.recibos[0].linhas.map(l => l.dia))
    for (const l of mapa.recibos[1].linhas) expect(diasA.has(l.dia)).toBe(false)
  })

  it('Ponte de Sor 2 vezes por semana e Makro nos dias das faturas', () => {
    const linhas = mapa.recibos.flatMap(r => r.linhas)
    for (const s of semanasDoMes(2026, 11)) {
      const ps = linhas.filter(l => l.local === 'Ponte de Sor' && s.includes(l.dia))
      expect(ps).toHaveLength(s.length >= 3 ? 2 : 1)
      expect(ps.every(l => l.kms === 284)).toBe(true)
    }
    expect(linhas.filter(l => l.local === 'Makro').map(l => l.dia).sort((a, b) => a - b)).toEqual([3, 9, 13, 20])
    // No dia da Makro também vão ao Chalet do Lago (mesma pessoa).
    for (const d of [3, 9, 13, 20]) expect(linhas.filter(l => l.dia === d && l.local.includes('Chalet'))).toHaveLength(1)
  })

  it('os dois recebem quase o mesmo (no máximo 50 € de diferença) em vários meses', () => {
    for (let mes = 1; mes <= 12; mes++) for (let v = 0; v < 5; v++) {
      const m = gerarMapa({ ano: 2027, mes, makro: [3, 9, 13, 20].slice(0, (mes + v) % 5), variante: v, config: CAL })
      const [a, b] = m.recibos
      expect(Math.abs(a.total - b.total)).toBeLessThanOrEqual(50)
      expect(Math.abs(a.dias - b.dias)).toBeLessThanOrEqual(1)
    }
    expect(Math.abs(mapa.recibos[0].total - mapa.recibos[1].total)).toBeLessThanOrEqual(50)
  })

  it('matrícula do Joel', () => {
    expect(mapa.recibos[1].viatura).toBe('AR-65-LL')
  })

  it('totais a 0,40 €/km', () => {
    for (const r of mapa.recibos) {
      expect(r.totalKms).toBe(r.linhas.reduce((s, l) => s + l.kms, 0))
      expect(r.total).toBeCloseTo(r.totalKms * 0.4, 2)
    }
  })

  it('meses diferentes dão mapas diferentes e o mesmo mês dá sempre o mesmo', () => {
    const dono = m => m.registos.map(r => `${r.dia}:${r.pessoa}`).join(',')
    expect(dono(gerarMapa({ ano: 2026, mes: 11, makro: [3, 9, 13, 20], config: CAL }))).toBe(dono(mapa))
    expect(dono(gerarMapa({ ano: 2026, mes: 11, makro: [3, 9, 13, 20], variante: 1, config: CAL }))).not.toBe(dono(mapa))
    const dez = gerarMapa({ ano: 2026, mes: 12, config: CAL })
    const ps = m => m.recibos.flatMap(r => r.linhas).filter(l => l.local === 'Ponte de Sor').map(l => new Date(Date.UTC(m.ano, m.mes - 1, l.dia)).getUTCDay()).sort().join()
    expect(ps(dez)).not.toBe(ps(mapa))
  })

  it('trocar um dia passa-o para a outra pessoa', () => {
    const r = mapa.registos[0]
    const t = trocarPessoa(mapa, r.data)
    expect(t.registos[0].pessoa).toBe(1 - r.pessoa)
    expect(t.recibos[0].totalKms + t.recibos[1].totalKms).toBe(mapa.recibos[0].totalKms + mapa.recibos[1].totalKms)
  })

  it('gera Excel e PDF', async () => {
    const buf = await gerarExcel(mapa)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.worksheets[0]
    expect(ws.name).toBe('Novembro 2026')
    expect(ws.getCell('A1').value).toBe('Compensação por deslocação em viatura própria')
    expect(ws.getCell('B2').value).toBe('Patricia Jesus Pereira Unip Lda')
    const pdf = new Uint8Array(await gerarPdf(mapa))
    expect(String.fromCharCode(...pdf.slice(0, 4))).toBe('%PDF')
  })
})

import { datasMakroLidas, diasDoMes, MAKRO_CONHECIDAS } from '../src/lib/mapaKms.js'
import { readMakro } from '../netlify/functions/ler-makro.mjs'

describe('datas da Makro', () => {
  it('já traz as idas de outubro e novembro de 2026 (incluindo 25/11)', () => {
    expect(diasDoMes(MAKRO_CONHECIDAS, 2026, 11)).toEqual([3, 9, 13, 20, 25])
    expect(diasDoMes(MAKRO_CONHECIDAS, 2026, 10)).toEqual([23, 27])
    const nov = gerarMapa({ ano: 2026, mes: 11, makro: diasDoMes(MAKRO_CONHECIDAS, 2026, 11), config: CAL })
    expect(nov.recibos.flatMap(r => r.linhas).filter(l => l.local === 'Makro').map(l => l.dia).sort((a, b) => a - b)).toEqual([3, 9, 13, 20, 25])
  })

  it('limpa as datas lidas', () => {
    expect(datasMakroLidas({ datas: ['2026-11-20', '2026-11-20', '20.11.2026', '2026-11-09'] })).toEqual(['2026-11-09', '2026-11-20'])
  })

  const supa = role => ({
    auth: { getUser: async t => (t === 'ok' ? { data: { user: { id: 'u1' } } } : { error: { message: 'x' } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null }) }) }) }),
  })
  const claude = (reply, calls = []) => ({ messages: { create: async p => { calls.push(p); return reply } } })
  const img = { media_type: 'image/jpeg', data: 'AAAA' }

  it('função ler-makro: só admin e devolve as datas', async () => {
    const ok = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"datas":["2026-11-20","2026-11-03"]}' }] }
    expect((await readMakro({ supabase: supa('rececao'), anthropic: claude(ok), token: 'ok', body: { files: [img] } })).status).toBe(403)
    const calls = []
    const r = await readMakro({ supabase: supa('admin'), anthropic: claude(ok, calls), token: 'ok', body: { files: [img] } })
    expect(r.status).toBe(200)
    expect((await r.json()).datas).toEqual(['2026-11-03', '2026-11-20'])
    expect(calls[0].messages[0].content[0].type).toBe('image')
  })
})

import { idasDasFaturas } from '../src/lib/mapaKms.js'

describe('idas às lojas pelas faturas', () => {
  const fat = [
    { data: '2026-12-02', fornecedor: 'IKEA Portugal - Moveis e Decoração, Lda', estado: 'Validada' },
    { data: '2026-12-02', fornecedor: 'Lidl & Companhia', estado: 'Por validar' },
    { data: '2026-12-05', fornecedor: 'LEROY MERLIN - Bricolage', estado: 'Validada' },
    { data: '2026-12-09', fornecedor: 'Makro Cash & Carry', estado: 'Validada' },
    { data: '2026-12-10', fornecedor: 'Continente', estado: 'Validada' },
    { data: '2026-12-11', fornecedor: 'IKEA', estado: 'Rejeitada' },
  ]
  it('reconhece IKEA, Lidl, Leroy Merlin e Makro', () => {
    expect(idasDasFaturas(fat, 2026, 12)).toEqual({ 2: ['ikea', 'lidl'], 5: ['leroy'], 9: ['makro'] })
  })
  it('cada ida entra no mapa, da mesma pessoa que vai ao Chalet nesse dia', () => {
    const m = gerarMapa({ ano: 2026, mes: 12, idas: idasDasFaturas(fat, 2026, 12), config: CAL })
    const todas = m.recibos.flatMap(r => r.linhas)
    expect(todas.filter(l => l.dia === 2).map(l => l.local).sort()).toEqual(['IKEA', 'Lidl', 'Unidade Chalet do Lago'])
    expect(todas.find(l => l.local === 'IKEA').kms).toBe(28)
    expect(todas.find(l => l.local === 'Leroy Merlin').dia).toBe(5)
    for (const r of m.recibos) {
      const outros = new Set(m.recibos.filter(x => x !== r).flatMap(x => x.linhas.map(l => l.dia)))
      for (const l of r.linhas) expect(outros.has(l.dia)).toBe(false)
    }
    expect(Math.abs(m.recibos[0].total - m.recibos[1].total)).toBeLessThanOrEqual(50)
  })
})

describe('assinaturas', () => {
  // PNG 1×1 transparente
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const config = { pessoas: [{ assinatura: { src: png, ratio: 3 } }, { assinatura: { src: png, ratio: 2.5 } }] }
  const m = gerarMapa({ ano: 2026, mes: 11, makro: [3, 9], config })
  it('ficam no recibo de cada um e entram no PDF e no Excel', async () => {
    expect(m.recibos.every(r => r.assinatura?.src === png)).toBe(true)
    const pdf = new Uint8Array(await gerarPdf(m))
    expect(new TextDecoder('latin1').decode(pdf)).toContain('/Subtype /Image')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await gerarExcel(m))
    expect(wb.worksheets[0].getImages()).toHaveLength(2)
  })
  it('sem assinatura o PDF não leva imagens', async () => {
    const pdf = new Uint8Array(await gerarPdf(gerarMapa({ ano: 2026, mes: 11 })))
    expect(new TextDecoder('latin1').decode(pdf)).not.toContain('/Subtype /Image')
  })
})

describe('um ficheiro por pessoa', () => {
  const m = gerarMapa({ ano: 2026, mes: 11, makro: [3, 9] })
  it('PDF e Excel só com o recibo de cada um', async () => {
    for (const i of [0, 1]) {
      const pdf = new TextDecoder('latin1').decode(new Uint8Array(await gerarPdf(m, i)))
      expect(pdf.startsWith('%PDF')).toBe(true)
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(await gerarExcel(m, i))
      const ws = wb.worksheets[0]
      const textos = []
      ws.eachRow(r => r.eachCell(c => textos.push(String(c.value ?? ''))))
      const nome = m.recibos[i].nome.toUpperCase(), outro = m.recibos[1 - i].nome.toUpperCase()
      expect(textos.some(t => t.includes(nome))).toBe(true)
      expect(textos.some(t => t.includes(outro))).toBe(false)
    }
    expect(nomeFicheiro(m, 1)).toBe('Mapa_de_Kms_Novembro_2026_Joel')
  })
})

import { mesmaPessoa, calcularMapa } from '../src/lib/mapaKms.js'
import { juntarAjudasCusto, gerarExcel as excelOrdenados } from '../src/lib/ordenados.js'

describe('ajudas de custo na folha de ordenados', () => {
  it('casa os nomes da folha com os do mapa (sem confundir Joel com Joelma)', () => {
    expect(mesmaPessoa('Patricia de Jesus Pereira', 'Patricia Jesus Pereira')).toBe(true)
    expect(mesmaPessoa('Joel Matias dos Santos Mendes', 'Joel Matias Santos Mendes')).toBe(true)
    expect(mesmaPessoa('Joelma Jesus Figueiredo', 'Joel Matias Santos Mendes')).toBe(false)
    expect(mesmaPessoa('Patrícia', 'Patricia Jesus Pereira')).toBe(true)
    expect(mesmaPessoa('Joel Mendes', 'Joel Matias Santos Mendes')).toBe(true)
    expect(mesmaPessoa('Joelma', 'Joel Matias Santos Mendes')).toBe(false)
    expect(mesmaPessoa('Patrícia Costa', 'Patricia Jesus Pereira')).toBe(false)
  })
  it('põe o total do mapa de cada um em Ajud. Custo, no ecrã e no Excel', async () => {
    const { mapa } = calcularMapa({ invoices: [], ano: 2026, mes: 11 })
    const linhas = juntarAjudasCusto([
      { codigo: 1, nome: 'Patricia de Jesus Pereira' }, { codigo: 2, nome: 'Joel Matias dos Santos Mendes' },
      { codigo: 102, nome: 'Joelma Jesus Figueiredo' }, { codigo: 3, nome: 'Outro', ajudCusto: 5, ajudCustoMao: true },
    ], mapa.recibos, mesmaPessoa)
    expect(linhas[0].ajudCusto).toBe(mapa.recibos[0].total)
    expect(linhas[1].ajudCusto).toBe(mapa.recibos[1].total)
    expect(linhas[2].ajudCusto).toBeUndefined()
    expect(linhas[3].ajudCusto).toBe(5)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await excelOrdenados({ empresa: 'X', codigos: {}, ano: 2026, mes: 11, linhas: linhas.map(l => ({ ...l, feriados: [], noites: 0, ferias: [], faltas: [], nota: '' })) }))
    expect(wb.worksheets[0].getCell(5, 5).value).toBe(mapa.recibos[0].total)
  })
})

import { periodoDoMes, textoPeriodo } from '../src/lib/mapaKms.js'

describe('período de 27 a 26', () => {
  it('o mapa de novembro vai de 27/10 a 26/11 e o de janeiro de 27/12 a 26/01', () => {
    const p = periodoDoMes(2026, 10)
    expect([p.inicio, p.fim]).toEqual(['2026-09-27', '2026-10-26'])
    expect(textoPeriodo(p)).toBe('27/09/2026 a 26/10/2026')
    expect([periodoDoMes(2026, 11).inicio, periodoDoMes(2026, 11).fim]).toEqual(['2026-10-27', '2026-11-26'])
    expect([periodoDoMes(2026, 12).inicio, periodoDoMes(2026, 12).fim]).toEqual(['2026-11-27', '2026-12-26'])
    expect([periodoDoMes(2027, 1).inicio, periodoDoMes(2027, 1).fim]).toEqual(['2026-12-27', '2027-01-26'])
    expect(periodoDoMes(2026, 10, 1).fim).toBe('2026-10-31')
  })
  it('o fim de um mês pode ser mudado à mão e o seguinte começa no dia a seguir', () => {
    const fins = { '2027-01': '2027-01-24' }
    expect(periodoDoMes(2027, 1, 27, fins).fim).toBe('2027-01-24')
    expect(periodoDoMes(2027, 2, 27, fins).inicio).toBe('2027-01-25')
  })
  it('os dias são todos do período, sem repetir entre meses seguidos', () => {
    const nov = calcularMapa({ invoices: [], ano: 2026, mes: 11 }).mapa
    const dez = calcularMapa({ invoices: [], ano: 2026, mes: 12 }).mapa
    const dn = nov.registos.map(r => r.data), dd = dez.registos.map(r => r.data)
    expect(dn[0]).toBe('2026-10-27')
    expect(dn.every(d => d >= '2026-10-27' && d <= '2026-11-26')).toBe(true)
    expect(dd.some(d => dn.includes(d))).toBe(false)
    expect(dd[0]).toBe('2026-11-27')
    // Makro conhecidas dentro do período (27/10 e 3, 9, 13, 20, 25 de novembro; 23/10 fica de fora)
    const makro = nov.recibos.flatMap(r => r.linhas).filter(l => l.local === 'Makro').map(l => l.data).sort()
    expect(makro).toEqual(['2026-10-27', '2026-11-03', '2026-11-09', '2026-11-13', '2026-11-20', '2026-11-25'])
    expect(Math.abs(nov.recibos[0].total - nov.recibos[1].total)).toBeLessThanOrEqual(50)
  })
  it('as faturas das lojas entram pelo período e o recibo mostra o período', async () => {
    const fat = [{ data: '2026-10-30', fornecedor: 'IKEA', estado: 'Validada' }, { data: '2026-11-27', fornecedor: 'IKEA', estado: 'Validada' }]
    const nov = calcularMapa({ invoices: fat, ano: 2026, mes: 11 }).mapa
    expect(nov.recibos.flatMap(r => r.linhas).filter(l => l.local === 'IKEA').map(l => l.rotulo)).toEqual(['30/10'])
    const pdf = new TextDecoder('latin1').decode(new Uint8Array(await gerarPdf(nov, 0)))
    expect(pdf.startsWith('%PDF')).toBe(true)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await gerarExcel(nov, 0))
    expect(wb.worksheets[0].getCell('C3').value).toBe('27/10 a 26/11')
    expect(wb.worksheets[0].getCell('A5').value).toBe(nov.recibos[0].linhas[0].rotulo)
  })
  it('trocas antigas guardadas como dia do mês continuam a funcionar', () => {
    const base = calcularMapa({ invoices: [], ano: 2026, mes: 11 }).mapa
    const dono = base.registos.find(r => r.data === '2026-11-05').pessoa
    const com = calcularMapa({ invoices: [], ano: 2026, mes: 11, guardado: { meses: { '2026-11': { trocas: [5] } } } }).mapa
    expect(com.registos.find(r => r.data === '2026-11-05').pessoa).toBe(1 - dono)
  })
})
