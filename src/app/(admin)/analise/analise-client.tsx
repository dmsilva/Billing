"use client";

import { useState, useMemo } from "react";
import { downloadCSV } from "@/lib/export";

interface MonthlyData {
  month: string;
  label: string;
  cgd: number;
  numerario: number;
  total: number;
}

interface CashEntry {
  month: string;
  label: string;
  days: number;
  total_closes: number;
  total_money: number;
  total_cv: number;
  total_mb: number;
  total_city_mb: number;
}

interface CategoryTotal {
  name: string;
  cgd: number;
  numerario: number;
  total: number;
}

interface PropertySummary {
  name: string;
  cgd: number;
  numerario: number;
  total: number;
}

interface SupplierGroup {
  name: string;
  category: string;
  total: number;
}

function euroShort(v: number) {
  return v.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function euro(v: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);
}

export function AnaliseClient({
  monthlyTotals,
  cashEntries,
  categories,
  suppliers,
  propertySummary,
  months,
}: {
  monthlyTotals: MonthlyData[];
  cashEntries: CashEntry[];
  categories: CategoryTotal[];
  suppliers: SupplierGroup[];
  propertySummary: PropertySummary[];
  months: string[];
}) {
  const [selectedMonth, setSelectedMonth] = useState("");

  const filteredCats = useMemo(() => {
    if (!selectedMonth) return categories;
    return categories;
  }, [categories, selectedMonth]);

  const grandTotal = monthlyTotals.reduce((s, m) => s + m.total, 0);
  const grandCgd = monthlyTotals.reduce((s, m) => s + m.cgd, 0);
  const grandNum = monthlyTotals.reduce((s, m) => s + m.numerario, 0);

  const selectedMonthData = selectedMonth ? monthlyTotals.find(m => m.month === selectedMonth) : null;

  return (
    <>
      {/* Month selector */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="shrink-0 text-[12px] font-[700] text-[var(--muted)]">Mês:</span>
          <div className="flex gap-1">
            <button
              onClick={() => setSelectedMonth("")}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-[750] ${!selectedMonth ? "bg-[var(--accent)] text-white" : "bg-[#f0f2f7] text-[#667]"}`}
            >
              Todos
            </button>
            {months.map(m => {
              const label = monthlyTotals.find(mt => mt.month === m)?.label || m;
              return (
                <button
                  key={m}
                  onClick={() => setSelectedMonth(m)}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-[750] ${selectedMonth === m ? "bg-[var(--accent)] text-white" : "bg-[#f0f2f7] text-[#667] hover:bg-[#e4e6ec]"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <button
          onClick={() => downloadCSV(
            "analise-mensal.csv",
            ["Mês", "CGD", "Numerário", "Total"],
            monthlyTotals.map(m => [m.label, m.cgd, m.numerario, m.total])
          )}
          className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-[11px] font-[700] text-[var(--muted)] hover:bg-[#f8fafc]"
        >
          Exportar CSV
        </button>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {selectedMonthData ? (
          <>
            <Card label="Mês" value={selectedMonthData.label} />
            <Card label="CGD" value={euro(selectedMonthData.cgd)} />
            <Card label="Numerário" value={euro(selectedMonthData.numerario)} />
            <Card label="Total" value={euro(selectedMonthData.total)} />
          </>
        ) : (
          <>
            <Card label="Meses com dados" value={String(monthlyTotals.length)} />
            <Card label="Total CGD" value={euro(grandCgd)} />
            <Card label="Total Numerário" value={euro(grandNum)} />
            <Card label="Total contabilístico" value={euro(grandTotal)} />
          </>
        )}
      </div>

      {/* Monthly breakdown */}
      <div className="mb-4 rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <h3 className="mb-3 text-[16px] font-[780] tracking-tight">Despesas por mês</h3>
        <Table
          headers={["Mês", "CGD", "Numerário", "Total despesas", "Média/dia"]}
          rows={monthlyTotals.map(m => ({
            key: m.month,
            highlight: m.month === selectedMonth,
            cells: [m.label, euroShort(m.cgd), euroShort(m.numerario), euroShort(m.total), euroShort(m.total / 30)],
            aligns: ["left", "right", "right", "right", "right"],
          }))}
          footer={["TOTAL", euroShort(grandCgd), euroShort(grandNum), euroShort(grandTotal), ""]}
        />
      </div>

      {/* Cash entries */}
      <div className="mb-4 rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <h3 className="mb-3 text-[16px] font-[780] tracking-tight">Entradas de caixa por mês</h3>
        <div className="rounded-xl border border-[#e7ebf1]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {["Mês", "Dias", "Fechos", "Dinheiro", "CV", "MB", "City MB", "Total"].map(h => (
                  <th key={h} className="border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cashEntries.map(cs => {
                const totalIn = cs.total_money + cs.total_cv + cs.total_mb + cs.total_city_mb;
                return (
                  <tr key={cs.month} className={`border-b border-[var(--line)] last:border-0 ${cs.month === selectedMonth ? "bg-[#f0f5ff]" : "hover:bg-[#f8fafc]"}`}>
                    <td className="px-2.5 py-2 font-[650]">{cs.label}</td>
                    <td className="px-2.5 py-2 text-center">{cs.days}</td>
                    <td className="px-2.5 py-2 text-center">{cs.total_closes}</td>
                    <td className="px-2.5 py-2 text-right font-tabular whitespace-nowrap">{euroShort(cs.total_money)}</td>
                    <td className="px-2.5 py-2 text-right font-tabular whitespace-nowrap">{euroShort(cs.total_cv)}</td>
                    <td className="px-2.5 py-2 text-right font-tabular whitespace-nowrap">{euroShort(cs.total_mb)}</td>
                    <td className="px-2.5 py-2 text-right font-tabular whitespace-nowrap">{euroShort(cs.total_city_mb)}</td>
                    <td className="px-2.5 py-2 text-right font-[700] font-tabular whitespace-nowrap">{euroShort(totalIn)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom row: categories + suppliers + properties */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
          <h3 className="mb-3 text-[16px] font-[780] tracking-tight">Top categorias</h3>
          <div className="max-h-[350px] overflow-auto rounded-xl border border-[#e7ebf1]">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {["Categoria", "CGD", "Numerário", "Total"].map(h => (
                    <th key={h} className="sticky top-0 border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredCats.slice(0, 15).map(c => (
                  <tr key={c.name} className="border-b border-[var(--line)] last:border-0 hover:bg-[#f8fafc]">
                    <td className="px-2.5 py-1.5 font-[650]">{c.name}</td>
                    <td className="px-2.5 py-1.5 text-right font-tabular">{euroShort(c.cgd)}</td>
                    <td className="px-2.5 py-1.5 text-right font-tabular">{euroShort(c.numerario)}</td>
                    <td className="px-2.5 py-1.5 text-right font-[700] font-tabular">{euroShort(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
          <h3 className="mb-3 text-[16px] font-[780] tracking-tight">Top fornecedores</h3>
          <div className="max-h-[350px] overflow-auto rounded-xl border border-[#e7ebf1]">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {["Fornecedor", "Categoria", "Total"].map(h => (
                    <th key={h} className="sticky top-0 border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {suppliers.slice(0, 15).map((s, i) => (
                  <tr key={i} className="border-b border-[var(--line)] last:border-0 hover:bg-[#f8fafc]">
                    <td className="px-2.5 py-1.5 font-[650]">{s.name}</td>
                    <td className="px-2.5 py-1.5 text-[var(--muted)]">{s.category}</td>
                    <td className="px-2.5 py-1.5 text-right font-[700] font-tabular">{euroShort(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Property summary */}
      <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <h3 className="mb-3 text-[16px] font-[780] tracking-tight">Resumo por imóvel</h3>
        <Table
          headers={["Imóvel", "CGD", "Numerário", "Total"]}
          rows={propertySummary.map(p => ({
            key: p.name,
            cells: [p.name, euroShort(p.cgd), euroShort(p.numerario), euroShort(p.total)],
            aligns: ["left", "right", "right", "right"],
          }))}
        />
      </div>
    </>
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

function Table({ headers, rows, footer }: {
  headers: string[];
  rows: { key: string; cells: string[]; aligns?: string[]; highlight?: boolean }[];
  footer?: string[];
}) {
  return (
    <div className="rounded-xl border border-[#e7ebf1]">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} className="border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className={`border-b border-[var(--line)] last:border-0 ${r.highlight ? "bg-[#f0f5ff]" : "hover:bg-[#f8fafc]"}`}>
              {r.cells.map((c, i) => (
                <td key={i} className={`px-2.5 py-2 ${i === 0 ? "font-[650]" : "font-tabular whitespace-nowrap"} ${r.aligns?.[i] === "right" ? "text-right" : ""} ${i === r.cells.length - 1 && i > 0 ? "font-[700]" : ""}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t-2 border-[var(--line)] bg-[#f8fafc] font-[750]">
              {footer.map((c, i) => (
                <td key={i} className={`px-2.5 py-2.5 ${i > 0 ? "text-right font-tabular" : ""}`}>{c}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
