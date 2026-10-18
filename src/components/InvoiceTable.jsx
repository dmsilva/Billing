import { useNavigate } from 'react-router-dom'
import { Badge, Empty, PaymentBadge, StateBadge } from './ui'
import { euro } from '../lib/money'
import { formatDate } from '../lib/dates'
import { invoiceCountsAsExpense } from '../lib/finance'
import { decimalPt, downloadText, toCsv } from '../lib/csv'

export function exportInvoices(rows, name) {
  downloadText(toCsv(
    ['Data', 'Fornecedor', 'Documento', 'Descrição', 'Categoria', 'Imóvel', 'Pagamento', 'Estado', 'Conta para a contabilidade', 'IVA', 'Valor'],
    rows.map(r => [r.data, r.fornecedor, r.documento, r.descricao, r.categoria, r.imovel, r.pagamento, r.estado, invoiceCountsAsExpense(r.source) ? 'Sim' : r.pagamento === 'CGD' ? 'Via extrato CGD' : 'Não', r.source.iva == null ? r.source.iva_estado : decimalPt(r.source.iva), decimalPt(r.valor)]),
  ), name)
}

export default function InvoiceTable({ rows, showOrigin }) {
  const nav = useNavigate()
  return (
    <div className="tablewrap tall">
      <table>
        <thead>
          <tr><th>Data</th><th>Fornecedor</th><th>Documento</th><th>Descrição</th><th>Categoria</th><th>Imóvel</th><th>Pagamento</th><th>Contabilidade</th><th>IVA</th><th>Estado</th>{showOrigin && <th>Enviado por</th>}<th className="money">Valor</th></tr>
        </thead>
        <tbody>
          {rows.length ? rows.map(r => {
            const inv = r.source
            const files = inv.invoice_files?.length || 0
            return (
              <tr key={r.id} className="clickable" onClick={() => nav(`/faturas/${r.id}`)}>
                <td>{formatDate(r.data)}</td>
                <td><strong>{r.fornecedor || '—'}</strong>{files > 0 && <div className="muted small">📎 {files} ficheiro{files > 1 ? 's' : ''}</div>}</td>
                <td>{r.documento || '—'}</td>
                <td className="wrap">{r.descricao}</td>
                <td><Badge>{r.categoria}</Badge></td>
                <td>{r.imovel}</td>
                <td><PaymentBadge value={r.pagamento} /></td>
                <td>{invoiceCountsAsExpense(inv) ? <Badge tone="ok">Contabilístico</Badge> : r.pagamento === 'CGD' ? <Badge tone="bank">{inv.bank_transaction_id ? 'Ligada ao extrato' : 'Via extrato'}</Badge> : <Badge tone="pending">{inv.estado === 'Rejeitada' ? 'Excluída' : 'Sem valor'}</Badge>}</td>
                <td>{inv.iva == null ? <Badge>IVA {inv.iva_estado.toLowerCase()}</Badge> : euro(inv.iva)}</td>
                <td><StateBadge value={inv.estado} /></td>
                {showOrigin && <td>{inv.enviado_por || '—'}</td>}
                <td className="money">{r.valor == null ? '—' : euro(r.valor)}</td>
              </tr>
            )
          }) : <Empty colSpan={showOrigin ? 12 : 11}>Sem documentos para os filtros selecionados.</Empty>}
        </tbody>
      </table>
    </div>
  )
}
