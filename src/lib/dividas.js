// Dívidas e adiantamentos dos colaboradores (uso interno; nunca vai para a contabilidade).
// Movimentos da tabela colaboradores_movimentos (supabase/19_dividas_colaboradores.sql).
import { sum, sub, toMilli } from './money'

export const TABELA_DIVIDAS = 'colaboradores_movimentos'
export const VALOR_HORA_PADRAO = 7

export const TIPOS = {
  divida: 'Dívida',
  pagamento: 'Pagamento da dívida',
  adiantamento: 'Adiantamento de salário',
}
export const FORMAS = {
  horas: 'Horas extra',
  dinheiro: 'Dinheiro',
  salario: 'Desconto no salário',
}

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// Movimentos que se descontam no salário (adiantamentos e pagamentos da dívida por desconto).
export const descontaNoSalario = m => m.tipo === 'adiantamento' || (m.tipo === 'pagamento' && m.forma === 'salario')
export const porDescontar = m => descontaNoSalario(m) && !m.descontado_em

// Um pagamento por desconto no salário só abate à dívida depois de descontado.
const abate = m => m.tipo === 'pagamento' && (m.forma !== 'salario' || !!m.descontado_em)

export const valorHoras = (horas, valorHora) => Math.round(Number(horas) * Number(valorHora) * 100) / 100

// Resumo por pessoa: dívida, já pago, falta pagar, e o que está por descontar no salário.
export function resumoPorPessoa(movimentos) {
  const grupos = new Map()
  for (const m of movimentos) {
    const k = norm(m.pessoa)
    if (!grupos.has(k)) grupos.set(k, { pessoa: m.pessoa.trim(), movimentos: [] })
    grupos.get(k).movimentos.push(m)
  }
  return [...grupos.values()].map(g => {
    const divida = sum(g.movimentos.filter(m => m.tipo === 'divida').map(m => m.valor))
    const pago = sum(g.movimentos.filter(abate).map(m => m.valor))
    const pendentes = g.movimentos.filter(porDescontar)
    return {
      ...g,
      divida,
      pago,
      falta: sub(divida, pago),
      horas: sum(g.movimentos.filter(m => m.tipo === 'pagamento' && m.forma === 'horas').map(m => m.horas)),
      porDescontar: sum(pendentes.map(m => m.valor)),
      pendentes,
    }
  }).sort((a, b) => a.pessoa.localeCompare(b.pessoa, 'pt'))
}

// Movimentos da pessoa por data, com o saldo da dívida depois de cada um.
export function extrato(movimentos) {
  let saldo = 0
  return [...movimentos]
    .sort((a, b) => String(a.data).localeCompare(String(b.data)) || Number(a.id ?? 0) - Number(b.id ?? 0))
    .map(m => {
      if (m.tipo === 'divida') saldo += toMilli(m.valor)
      else if (abate(m)) saldo -= toMilli(m.valor)
      return { ...m, saldo: saldo / 1000 }
    })
}

// A pessoa do registo é a mesma da folha do banco? "Fábio" casa com "Fábio Miguel Santos".
export function mesmaPessoa(pessoa, nome) {
  const a = norm(pessoa).split(' ').filter(Boolean)
  const b = norm(nome).split(' ').filter(Boolean)
  if (!a.length || !b.length) return false
  if (a[0] !== b[0]) return false
  return a.every(p => b.includes(p))
}

// Descontos a aplicar nos salários do mês AAAA-MM: tudo o que está por descontar até esse mês.
export function descontosDoMes(movimentos, mes) {
  return movimentos.filter(m => porDescontar(m) && m.descontar_mes <= mes)
}

// Aplica os descontos aos pagamentos da folha do banco. Cada pagamento fica com
// original (valor do recibo), descontos [movimentos] e valor já descontado.
// Devolve também os descontos que não têm ninguém na folha.
export function aplicarDescontos(pagamentos, descontos) {
  const usados = new Set()
  const novos = pagamentos.map(p => {
    const meus = descontos.filter(d => !usados.has(d) && mesmaPessoa(d.pessoa, p.nome))
    meus.forEach(d => usados.add(d))
    if (!meus.length) return p
    const original = p.valor
    const valor = original == null ? null : sub(original, sum(meus.map(d => d.valor)))
    return { ...p, original, descontos: meus, valor }
  })
  return { pagamentos: novos, semPessoa: descontos.filter(d => !usados.has(d)) }
}

// Ids dos movimentos que foram mesmo descontados no ficheiro (pessoa marcada para pagar).
export const idsDescontados = pagamentos => pagamentos.filter(p => p.incluir && p.descontos?.length).flatMap(p => p.descontos.map(d => d.id))
