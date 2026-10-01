import {
  getAllBankTransactions, getAllInvoices, getCategoryLookup,
} from "@/lib/db/queries";
import { groupByCategory } from "@/lib/domain/classification";
import { euroShort, euro } from "@/lib/domain/reconciliation";
import { ExportButton } from "@/components/export-button";

export const dynamic = "force-dynamic";

export default function CategoriasPage() {
  const bankTxs = getAllBankTransactions();
  const invoices = getAllInvoices();
  const catLookup = getCategoryLookup();

  const categories = groupByCategory(bankTxs, invoices, catLookup);
  const grandTotal = categories.reduce((s, c) => s + c.total, 0);
  const cgdTotal = categories.reduce((s, c) => s + c.cgd, 0);
  const numTotal = categories.reduce((s, c) => s + c.numerario, 0);

  return (
    <div className="max-w-[1500px]">
      <div className="mb-5">
        <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">ANÁLISE</div>
        <h1 className="mt-1 text-[28px] font-[820] tracking-tight">Categorias</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Despesas agrupadas por categoria, combinando CGD e Numerário.
          Transferências empresa excluídas.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Card label="Categorias" value={String(categories.length)} />
        <Card label="Total CGD" value={euro(cgdTotal)} />
        <Card label="Total Numerário" value={euro(numTotal)} />
        <Card label="Total contabilístico" value={euro(grandTotal)} />
      </div>

      <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <div className="mb-3 flex justify-end">
          <ExportButton
            filename="categorias.csv"
            headers={["Categoria", "CGD", "Numerário", "Total", "%"]}
            rows={categories.map(c => [c.name, c.cgd, c.numerario, c.total, grandTotal > 0 ? ((c.total / grandTotal) * 100).toFixed(1) : "0"])}
          />
        </div>
        <div className="max-h-[700px] overflow-auto rounded-xl border border-[#e7ebf1]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {["Categoria", "CGD", "Numerário", "Total", "% do total"].map(h => (
                  <th key={h} className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map(c => {
                const pct = grandTotal > 0 ? (c.total / grandTotal) * 100 : 0;
                return (
                  <tr key={c.name} className="border-b border-[var(--line)] last:border-0 hover:bg-[#f8fafc]">
                    <td className="px-2.5 py-2 font-[650]">{c.name}</td>
                    <td className="px-2.5 py-2 text-right font-tabular whitespace-nowrap">{euroShort(c.cgd)}</td>
                    <td className="px-2.5 py-2 text-right font-tabular whitespace-nowrap">{euroShort(c.numerario)}</td>
                    <td className="px-2.5 py-2 text-right font-[700] font-tabular whitespace-nowrap">{euroShort(c.total)}</td>
                    <td className="px-2.5 py-2.5 w-[160px]">
                      <div className="flex items-center gap-2">
                        <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-[#edf1f7]">
                          <div className="h-full rounded-full bg-gradient-to-r from-[#5e83f4] to-[#3159d9]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] font-[700] text-[var(--muted)] w-[36px] text-right">{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--line)] bg-[#f8fafc] font-[750]">
                <td className="px-2.5 py-2.5">TOTAL</td>
                <td className="px-2.5 py-2.5 text-right font-tabular">{euroShort(cgdTotal)}</td>
                <td className="px-2.5 py-2.5 text-right font-tabular">{euroShort(numTotal)}</td>
                <td className="px-2.5 py-2.5 text-right font-tabular">{euroShort(grandTotal)}</td>
                <td className="px-2.5 py-2.5 text-right text-[10px]">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[15px] border border-[var(--line)] bg-white p-4 shadow-[0_4px_18px_rgba(25,45,90,0.035)]">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-[22px] font-[820]">{value}</div>
    </div>
  );
}
