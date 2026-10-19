import { useMemo } from 'react'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import { monthLabel, monthOf } from '../lib/dates'
import { Select } from './ui'

export function useMonthOptions() {
  const { bank_transactions, invoices, cash_closes } = useData()
  return useMemo(() => {
    const set = new Set()
    for (const t of bank_transactions) set.add(monthOf(t.data_mov))
    for (const i of invoices) if (i.data) set.add(monthOf(i.data))
    for (const c of cash_closes) set.add(monthOf(c.data))
    return [...set].filter(Boolean).sort().map(m => ({ value: m, label: monthLabel(m) }))
  }, [bank_transactions, invoices, cash_closes])
}

export default function FilterBar({ onExport, showPayment = true, showCategory = true, showSearch = true, extra }) {
  const { filters, set, clear } = useFilters()
  const { propertyNames, categoryNames } = useData()
  const months = useMonthOptions()
  const active = Object.values(filters).some(Boolean)
  return (
    <div className="filters">
      <Select value={filters.month} onChange={v => set({ month: v })} options={months} placeholder="Todos os meses" aria-label="Mês" />
      <Select value={filters.property} onChange={v => set({ property: v })} options={propertyNames} placeholder="Todos os imóveis" aria-label="Imóvel" />
      {showPayment && <Select value={filters.payment} onChange={v => set({ payment: v })} options={['CGD', 'Numerário']} placeholder="Todos os pagamentos" aria-label="Pagamento" />}
      {showCategory && <Select value={filters.category} onChange={v => set({ category: v })} options={categoryNames} placeholder="Todas as categorias" aria-label="Categoria" />}
      {showSearch && <input className="search" value={filters.search} onChange={e => set({ search: e.target.value })} placeholder="Pesquisar fornecedor, movimento, documento ou categoria…" />}
      {extra}
      {active && <button className="secondary" onClick={clear}>Limpar filtros</button>}
      {onExport && <button className="secondary" onClick={onExport}>Exportar CSV</button>}
    </div>
  )
}
