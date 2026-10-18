import { useMemo, useState } from 'react'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import FilterBar from '../components/FilterBar'
import InvoiceTable, { exportInvoices } from '../components/InvoiceTable'
import { Kpi, Panel, Select } from '../components/ui'
import { applyFilters, invoiceCountsAsExpense } from '../lib/finance'
import { euro, sumBy } from '../lib/money'

export default function Faturas() {
  const { invoiceRows } = useData()
  const { filters } = useFilters()
  const [estado, setEstado] = useState('')
  const rows = useMemo(
    () => applyFilters(invoiceRows, filters).filter(r => !estado || r.estado === estado).sort((a, b) => String(b.data).localeCompare(String(a.data))),
    [invoiceRows, filters, estado],
  )
  const counted = rows.filter(r => invoiceCountsAsExpense(r.source))
  const cgd = rows.filter(r => r.pagamento === 'CGD')
  return (
    <>
      <Panel title="Faturas e documentos" hint="As faturas pagas em numerário ficam separadas do extrato CGD para não duplicar movimentos, mas continuam incluídas na contabilidade. As faturas pagas por CGD são documentos de suporte do movimento bancário e não somam outra vez.">
        <div className="notice">Os pagamentos Endesa com CPE <strong>PT0002000133379727RQ</strong> pertencem ao <strong>Chalet do Lago</strong>. Confirma o imóvel desses movimentos em CGD / Extrato.</div>
      </Panel>
      <FilterBar onExport={() => exportInvoices(rows, 'faturas.csv')} extra={<Select value={estado} onChange={setEstado} options={['Por validar', 'Validada', 'Rejeitada']} placeholder="Todos os estados" aria-label="Estado" />} />
      <div className="grid4">
        <Kpi color="blue" icon="▧" label="Documentos" value={rows.length} note={`${rows.filter(r => r.estado === 'Por validar').length} por validar`} />
        <Kpi color="green" icon="€" label="Numerário (contabilístico)" value={euro(sumBy(counted, r => r.valor))} note={`${counted.length} documentos`} />
        <Kpi color="purple" icon="▤" label="Pagas por CGD" value={euro(sumBy(cgd, r => r.valor))} note="Já contadas no extrato" />
        <Kpi color="orange" icon="%" label="IVA" value={euro(sumBy(rows.filter(r => r.source.iva != null), r => r.source.iva))} note={`${rows.filter(r => r.source.iva == null).length} documentos com IVA a apurar`} />
      </div>
      <Panel><InvoiceTable rows={rows} showOrigin /></Panel>
    </>
  )
}
