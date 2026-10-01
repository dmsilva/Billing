"use client";

import { FilterBar, useFilters, type FilterConfig } from "@/components/filter-bar";
import { downloadCSV } from "@/lib/export";
import { useMemo } from "react";

interface Inv {
  id: number;
  invoice_date: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  description: string | null;
  category_name: string | null;
  propertyName: string;
  payment_source: string;
  validation_status: string;
  total: number;
}

function formatDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function euroShort(v: number) {
  return v.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export function FaturasClient({
  invoices,
  months,
  properties,
  categories,
  paymentSources,
}: {
  invoices: Inv[];
  months: string[];
  properties: string[];
  categories: string[];
  paymentSources: string[];
}) {
  const { filters, update, reset, active } = useFilters();

  const filtered = useMemo(() => {
    return invoices.filter(inv => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const haystack = [inv.supplier_name, inv.description, inv.invoice_number, inv.category_name]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filters.month && !(inv.invoice_date || "").startsWith(filters.month)) return false;
      if (filters.property && inv.propertyName !== filters.property) return false;
      if (filters.category && inv.category_name !== filters.category) return false;
      if (filters.payment && inv.payment_source !== filters.payment) return false;
      return true;
    });
  }, [invoices, filters]);

  const total = filtered.reduce((s, i) => s + i.total, 0);

  const config: FilterConfig = {
    searchPlaceholder: "Pesquisar fornecedor, documento…",
    months,
    properties,
    categories,
    paymentSources,
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <FilterBar config={config} filters={filters} onUpdate={update} onReset={reset} active={active} />
        <button
          onClick={() => downloadCSV(
            "faturas.csv",
            ["Data", "Fornecedor", "Documento", "Descrição", "Categoria", "Imóvel", "Pagamento", "Valor"],
            filtered.map(i => [i.invoice_date, i.supplier_name, i.invoice_number, i.description, i.category_name, i.propertyName, i.payment_source, i.total])
          )}
          className="shrink-0 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[11px] font-[700] text-[var(--muted)] hover:bg-[#f8fafc]"
        >
          Exportar CSV
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-[#dce5f7] bg-[#f5f8ff] px-3.5 py-3 text-[12px]">
        Os dois pagamentos Endesa com CPE <strong>PT0002000133379727RQ</strong> continuam reservados ao <strong>Chalet do Lago</strong>. Os restantes documentos estão no Chalet D&apos;Ávila.
      </div>

      <div className="mb-4 grid grid-cols-4 gap-3.5">
        <Card label="Documentos" value={String(filtered.length)} />
        <Card label="Total" value={euroShort(total)} />
        <Card label="Contabilístico" value="SIM" sub="Incluído nas despesas" />
        <Card label="IVA" value="A apurar" sub="Por documento" />
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
              {filtered.map(inv => (
                <tr key={inv.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[#f8fafc]">
                  <td className="px-2.5 py-2 whitespace-nowrap">{inv.invoice_date ? formatDate(inv.invoice_date) : "—"}</td>
                  <td className="px-2.5 py-2 font-[650] max-w-[140px] truncate">{inv.supplier_name || "—"}</td>
                  <td className="px-2.5 py-2 text-[var(--muted)] max-w-[120px] truncate">{inv.invoice_number || "—"}</td>
                  <td className="px-2.5 py-2 max-w-[200px] truncate" title={inv.description || ""}>{inv.description || "—"}</td>
                  <td className="px-2.5 py-2 max-w-[140px] truncate">{inv.category_name || "—"}</td>
                  <td className="px-2.5 py-2">{inv.propertyName}</td>
                  <td className="px-2.5 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-[800] ${inv.payment_source === "Numerário" ? "bg-[#eaf8f1] text-[#13724f]" : "bg-[#edf2ff] text-[#3658bd]"}`}>
                      {inv.payment_source}
                    </span>
                  </td>
                  <td className="px-2.5 py-2 text-[10px] font-[700] text-[var(--good)]">SIM</td>
                  <td className="px-2.5 py-2 text-[10px] text-[var(--muted)]">A apurar</td>
                  <td className="px-2.5 py-2 text-right font-[700] font-tabular whitespace-nowrap">{euroShort(inv.total)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-2.5 py-8 text-center text-[13px] text-[var(--muted)]">Nenhum documento encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[15px] border border-[var(--line)] bg-white p-4 shadow-[0_4px_18px_rgba(25,45,90,0.035)]">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-[22px] font-[820]">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}
