import { getAllInvoices, getPropertyLookup } from "@/lib/db/queries";
import { formatDate, euroShort, euro } from "@/lib/domain/reconciliation";

export const dynamic = "force-dynamic";

export default function NumerarioPage() {
  const allInvoices = getAllInvoices();
  const propLookup = getPropertyLookup();
  const invoices = allInvoices.filter(i => i.payment_source === "Numerário");
  const total = invoices.reduce((s, i) => s + i.total, 0);

  return (
    <div className="max-w-[1500px]">
      <div className="mb-5">
        <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">MOVIMENTOS</div>
        <h1 className="mt-1 text-[28px] font-[820] tracking-tight">Numerário · Contabilidade</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Faturas/recibos pagos em numerário. Não entram nas saídas CGD, mas entram nas despesas contabilísticas e ficam disponíveis para o apuramento de IVA.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3.5">
        <div className="rounded-[15px] border border-[var(--line)] bg-white p-4 shadow-[0_4px_18px_rgba(25,45,90,0.035)]">
          <div className="text-[12px] text-[var(--muted)]">Documentos em numerário</div>
          <div className="mt-1 text-[25px] font-[820]">{invoices.length}</div>
        </div>
        <div className="rounded-[15px] border border-[var(--line)] bg-white p-4 shadow-[0_4px_18px_rgba(25,45,90,0.035)]">
          <div className="text-[12px] text-[var(--muted)]">Total numerário</div>
          <div className="mt-1 text-[25px] font-[820]">{euro(total)}</div>
        </div>
        <div className="rounded-[15px] border border-[var(--line)] bg-white p-4 shadow-[0_4px_18px_rgba(25,45,90,0.035)]">
          <div className="text-[12px] text-[var(--muted)]">Contabilístico</div>
          <div className="mt-1 text-[17px] font-[780]">SIM</div>
          <div className="mt-1 text-[11px] text-[var(--muted)]">Incluído nas despesas, separado da CGD</div>
        </div>
      </div>

      <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <div className="max-h-[650px] overflow-auto rounded-xl border border-[#e7ebf1]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {["Data", "Fornecedor", "Documento", "Descrição", "Categoria", "Imóvel", "Pagamento", "Contabilidade", "IVA", "Valor"].map(h => (
                  <th key={h} className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[#f8fafc]">
                  <td className="px-2.5 py-2 whitespace-nowrap">{inv.invoice_date ? formatDate(inv.invoice_date) : "—"}</td>
                  <td className="px-2.5 py-2 font-[650] max-w-[140px] truncate">{inv.supplier_name || "—"}</td>
                  <td className="px-2.5 py-2 text-[var(--muted)] max-w-[120px] truncate">{inv.invoice_number || "—"}</td>
                  <td className="px-2.5 py-2 max-w-[200px] truncate" title={inv.description || ""}>{inv.description || "—"}</td>
                  <td className="px-2.5 py-2 max-w-[140px] truncate">{inv.category_name || "—"}</td>
                  <td className="px-2.5 py-2">{propLookup.get(inv.property_id ?? -1) || "—"}</td>
                  <td className="px-2.5 py-2"><span className="inline-block rounded-full bg-[#eaf8f1] px-2 py-0.5 text-[9px] font-[800] text-[#13724f]">Numerário</span></td>
                  <td className="px-2.5 py-2 text-[10px] font-[700] text-[var(--good)]">SIM</td>
                  <td className="px-2.5 py-2 text-[10px] text-[var(--muted)]">A apurar</td>
                  <td className="px-2.5 py-2 text-right font-[700] font-tabular whitespace-nowrap">{euroShort(inv.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
