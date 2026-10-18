import { useMemo } from 'react'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import FilterBar from '../components/FilterBar'
import InvoiceTable, { exportInvoices } from '../components/InvoiceTable'
import { Kpi, Panel } from '../components/ui'
import { applyFilters, invoiceCountsAsExpense, PAYMENT_CASH } from '../lib/finance'
import { euro, sumBy } from '../lib/money'

export default function Numerario() {
  const { invoiceRows } = useData()
  const { filters } = useFilters()
  const rows = useMemo(
    () => applyFilters(invoiceRows, { ...filters, payment: PAYMENT_CASH }).sort((a, b) => String(b.data).localeCompare(String(a.data))),
    [invoiceRows, filters],
  )
  const counted = rows.filter(r => invoiceCountsAsExpense(r.source))
  return (
    <>
      <Panel title="Numerário · Contabilidade" hint="Faturas e recibos pagos em numerário. Não entram nas saídas CGD, mas entram nas despesas contabilísticas e ficam disponíveis para o apuramento de IVA." />
      <FilterBar showPayment={false} onExport={() => exportInvoices(rows, 'numerario.csv')} />
      <div className="grid4">
        <Kpi color="green" icon="◉" label="Documentos em numerário" value={rows.length} />
        <Kpi color="purple" icon="€" label="Total numerário" value={euro(sumBy(counted, r => r.valor))} note="Incluído nas despesas" />
        <Kpi color="orange" icon="!" label="Sem valor ou rejeitados" value={rows.length - counted.length} note="Não entram nos totais" />
        <Kpi color="blue" icon="%" label="IVA" value="A apurar" note="Por documento" />
      </div>
      <Panel><InvoiceTable rows={rows} /></Panel>
    </>
  )
}
