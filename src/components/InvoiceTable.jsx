import { useNavigate } from 'react-router-dom'
import { Badge, Empty, PaymentBadge, StateBadge } from './ui'
import { euro } from '../lib/money'
import { formatDate } from '../lib/dates'
import { invoiceCountsAsExpense, isCreditNote } from '../lib/finance'
import { decimalPt, downloadText, toCsv } from '../lib/csv'

export function exportInvoices(rows, name) {
  downloadText(toCsv(
    ['Data', 'Fornecedor', 'Documento', 'Descrição', 'Categoria', 'Imóvel', 'Pagamento', 'Estado', 'Conta para a contabilidade', 'IVA', 'Valor'],
    rows.map(r => [r.data, r.fornecedor, r.documento, r.descricao, r.categoria, r.imovel, r.pagamento, r.estado, invoiceCountsAsExpense(r.source) ? 'Sim' : r.pagamento === 'CGD' ? 'Via extrato CGD' : r.pagamento === 'Por pagar' ? 'Por liquidar' : r.pagamento === 'Airbnb' ? 'Pela Airbnb' : 'Não', r.source.iva == null ? r.source.iva_estado : decimalPt(r.source.iva), decimalPt(r.valor)]),
  ), name)
}

// Situação contabilística da fatura (pequena etiqueta por baixo do pagamento).
function accountingBadge(inv, r) {
  if (invoiceCountsAsExpense(inv)) return <Badge tone="ok">Contabilístico</Badge>
  if (r.pagamento === 'CGD') return <Badge tone="bank">{inv.bank_transaction_id || inv.payment_id ? 'Ligada ao extrato' : 'Via extrato'}</Badge>
  if (r.pagamento === 'Por pagar' && inv.estado !== 'Rejeitada') return <Badge tone="pending">Por liquidar</Badge>
  if (r.pagamento === 'Airbnb' && inv.estado !== 'Rejeitada') return <Badge tone="airbnb">Pela Airbnb</Badge>
  return <Badge tone="pending">{inv.estado === 'Rejeitada' ? 'Excluída' : 'Sem valor'}</Badge>
}

// 7 colunas: o documento, os ficheiros e quem enviou ficam por baixo do fornecedor; a categoria e o
// imóvel por baixo da descrição; a contabilidade por baixo do pagamento; o IVA por baixo do valor.
// selected/onSelect (opcional): caixas para escolher várias faturas de uma vez.
export default function InvoiceTable({ rows, showOrigin, selected, onSelect }) {
  const nav = useNavigate()
  return (
    <div className="tablewrap tall">
      <table className="inv-table">
        <thead>
          <tr>{onSelect && <th><input type="checkbox" aria-label="Selecionar todas" checked={rows.length > 0 && rows.every(r => selected.has(r.id))} onChange={e => onSelect(rows.map(r => r.id), e.target.checked)} /></th>}<th>Data</th><th>Fornecedor</th><th>Descrição</th><th>Pagamento</th><th>Estado</th><th className="money">Valor</th></tr>
        </thead>
        <tbody>
          {rows.length ? rows.map(r => {
            const inv = r.source
            const files = inv.invoice_files?.length || 0
            const meta = [r.documento, files > 0 && `📎 ${files}`, showOrigin && inv.enviado_por && `por ${inv.enviado_por}`].filter(Boolean).join(' · ')
            return (
              <tr key={r.id} className={`clickable ${selected?.has(r.id) ? 'row-selected' : ''}`} onClick={() => nav(`/faturas/${r.id}`)}>
                {onSelect && <td onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Selecionar ${r.fornecedor || 'fatura'}`} checked={selected.has(r.id)} onChange={e => onSelect([r.id], e.target.checked)} /></td>}
                <td className="nowrap">{formatDate(r.data)}</td>
                <td><strong>{r.fornecedor || '—'}</strong>{meta && <div className="muted small">{meta}</div>}{isCreditNote(inv) && <div><Badge tone="bad">Nota de crédito</Badge></div>}</td>
                <td className="wrap">{r.descricao}<div className="muted small">{[r.categoria, r.imovel].filter(Boolean).join(' · ')}</div></td>
                <td><PaymentBadge value={r.pagamento} /> {accountingBadge(inv, r)}{inv.liquidada_em && <div className="muted small">Liquidada {formatDate(inv.liquidada_em)}</div>}</td>
                <td><StateBadge value={inv.estado} /></td>
                <td className="money"><strong>{r.valor == null ? '—' : euro(r.valor)}</strong><div className="muted small">{inv.iva == null ? `IVA ${String(inv.iva_estado || '').toLowerCase()}` : `IVA ${euro(inv.iva)}`}</div></td>
              </tr>
            )
          }) : <Empty colSpan={6 + (onSelect ? 1 : 0)}>Sem documentos para os filtros selecionados.</Empty>}
        </tbody>
      </table>
    </div>
  )
}
