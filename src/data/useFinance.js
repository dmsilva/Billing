import { useMemo } from 'react'
import { useData } from './DataProvider'
import { useFilters } from './FiltersProvider'
import { accountingRows, applyFilters } from '../lib/finance'
import { monthOf } from '../lib/dates'

// Linhas contabilísticas (CGD + numerário) com os filtros globais aplicados.
export function useFinance(overrides = {}) {
  const data = useData()
  const { filters } = useFilters()
  const f = { ...filters, ...overrides }
  const all = useMemo(() => accountingRows(data.bankRows, data.invoiceRows), [data.bankRows, data.invoiceRows])
  const rows = useMemo(() => applyFilters(all, f), [all, f.month, f.property, f.payment, f.category, f.search]) // eslint-disable-line react-hooks/exhaustive-deps
  const closes = useMemo(() => data.cash_closes.filter(c => !f.month || monthOf(c.data) === f.month), [data.cash_closes, f.month])
  return { ...data, filters: f, all, rows, closes }
}
