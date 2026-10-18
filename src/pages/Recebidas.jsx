import { useMemo, useState } from 'react'
import { useData } from '../data/DataProvider'
import InvoiceTable from '../components/InvoiceTable'
import { Panel, Select } from '../components/ui'

export default function Recebidas() {
  const { invoiceRows } = useData()
  const [estado, setEstado] = useState('Por validar')
  const rows = useMemo(
    () => invoiceRows.filter(r => r.source.origem === 'rececao' && (!estado || r.estado === estado)).sort((a, b) => String(b.source.created_at).localeCompare(String(a.source.created_at))),
    [invoiceRows, estado],
  )
  return (
    <>
      <Panel
        title="Faturas recebidas da receção"
        hint="Documentos enviados pela página da receção. Abre cada um para ver o original, completar o valor e a categoria e validar. Os documentos antigos continuam nas áreas Faturas e Numerário."
        actions={<Select value={estado} onChange={setEstado} options={['Por validar', 'Validada', 'Rejeitada']} placeholder="Todos os estados" aria-label="Estado" />}
      >
        <div className="notice">Link para a receção: <a href="/rececao" target="_blank" rel="noreferrer">{window.location.origin}/rececao</a> (é preciso entrar com uma conta de receção).</div>
      </Panel>
      <Panel><InvoiceTable rows={rows} showOrigin /></Panel>
    </>
  )
}
