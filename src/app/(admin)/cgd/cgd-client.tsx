"use client";

import { FilterBar, useFilters, type FilterConfig } from "@/components/filter-bar";
import { downloadCSV } from "@/lib/export";
import { useMemo } from "react";

interface Tx {
  id: number;
  data_mov: string;
  descricao: string;
  valor: number;
  saldo: number | null;
  categoryName: string;
  propertyName: string;
  isTransfer: boolean;
}

function formatDate(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function euroShort(v: number) {
  return v.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export function CGDClient({
  txs,
  months,
  properties,
  categories,
}: {
  txs: Tx[];
  months: string[];
  properties: string[];
  categories: string[];
}) {
  const { filters, update, reset, active } = useFilters();

  const filtered = useMemo(() => {
    return txs.filter(t => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!t.descricao.toLowerCase().includes(q) && !t.categoryName.toLowerCase().includes(q)) return false;
      }
      if (filters.month && !t.data_mov.startsWith(filters.month)) return false;
      if (filters.property && t.propertyName !== filters.property) return false;
      if (filters.category && t.categoryName !== filters.category) return false;
      return true;
    });
  }, [txs, filters]);

  const expenses = filtered.filter(t => !t.isTransfer);
  const total = expenses.reduce((s, t) => s + t.valor, 0);
  const transfers = filtered.filter(t => t.isTransfer);

  const config: FilterConfig = {
    searchPlaceholder: "Pesquisar descrição, categoria…",
    months,
    properties,
    categories,
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <FilterBar config={config} filters={filters} onUpdate={update} onReset={reset} active={active} />
        <button
          onClick={() => downloadCSV(
            "cgd-extrato.csv",
            ["Data", "Descrição", "Categoria", "Imóvel", "Tipo", "Valor", "Saldo"],
            filtered.map(t => [t.data_mov, t.descricao, t.categoryName, t.propertyName, t.isTransfer ? "Transferência" : "CGD", t.valor, t.saldo])
          )}
          className="shrink-0 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[11px] font-[700] text-[var(--muted)] hover:bg-[#f8fafc]"
        >
          Exportar CSV
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-[#dce5f7] bg-[#f5f8ff] px-3.5 py-3 text-[12px]">
        <strong>{filtered.length}</strong> movimentos · <strong>{euroShort(total)}</strong> em despesas ·
        {" "}<strong>{transfers.length}</strong> transferências empresa ({euroShort(transfers.reduce((s, t) => s + t.valor, 0))}) excluídas das despesas
      </div>

      <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <div className="max-h-[700px] overflow-auto rounded-xl border border-[#e7ebf1]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {["Data", "Descrição", "Categoria", "Imóvel", "Pagamento", "Valor", "Saldo"].map(h => (
                  <th key={h} className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} className={`border-b border-[var(--line)] last:border-0 ${t.isTransfer ? "bg-[#f9f9fc] text-[var(--muted)]" : "hover:bg-[#f8fafc]"}`}>
                  <td className="px-2.5 py-2 whitespace-nowrap">{formatDate(t.data_mov)}</td>
                  <td className="px-2.5 py-2 max-w-[280px] truncate" title={t.descricao}>{t.descricao}</td>
                  <td className="px-2.5 py-2 max-w-[180px] truncate">{t.categoryName}</td>
                  <td className="px-2.5 py-2">{t.propertyName}</td>
                  <td className="px-2.5 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-[800] ${t.isTransfer ? "bg-[#f0f0f4] text-[#888]" : "bg-[#edf2ff] text-[#3658bd]"}`}>
                      {t.isTransfer ? "Transferência" : "CGD"}
                    </span>
                  </td>
                  <td className="px-2.5 py-2 text-right font-[700] font-tabular whitespace-nowrap">{euroShort(t.valor)}</td>
                  <td className="px-2.5 py-2 text-right font-tabular text-[var(--muted)] whitespace-nowrap">{t.saldo != null ? euroShort(t.saldo) : "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-2.5 py-8 text-center text-[13px] text-[var(--muted)]">Nenhum movimento encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
