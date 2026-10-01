"use client";

import { useState, useMemo } from "react";
import { downloadCSV } from "@/lib/export";

interface CashClose {
  id: number;
  date: string;
  shift: string;
  money: number;
  cv: number;
  mb: number;
  city_mb: number;
}

function formatDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function euroShort(v: number) {
  return v.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export function CaixaClient({ closes, months }: { closes: CashClose[]; months: string[] }) {
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedShift, setSelectedShift] = useState("");

  const filtered = useMemo(() => {
    let result = closes;
    if (selectedMonth) result = result.filter(c => c.date.startsWith(selectedMonth));
    if (selectedShift) result = result.filter(c => c.shift === selectedShift);
    return result;
  }, [closes, selectedMonth, selectedShift]);

  const shiftTotals = useMemo(() => {
    const totals = { "7h": { money: 0, cv: 0, mb: 0, cityMB: 0, total: 0 }, "15h": { money: 0, cv: 0, mb: 0, cityMB: 0, total: 0 }, "23h": { money: 0, cv: 0, mb: 0, cityMB: 0, total: 0 } };
    for (const c of filtered) {
      const s = totals[c.shift as keyof typeof totals];
      if (s) {
        s.money += c.money;
        s.cv += c.cv;
        s.mb += c.mb;
        s.cityMB += c.city_mb;
        s.total += c.money + c.cv + c.mb + c.city_mb;
      }
    }
    return totals;
  }, [filtered]);

  function handleExport() {
    downloadCSV(
      "caixa-diaria.csv",
      ["Data", "Turno", "Dinheiro", "CV", "MB", "City MB", "Total"],
      filtered.map(c => [formatDate(c.date), c.shift, c.money, c.cv, c.mb, c.city_mb, c.money + c.cv + c.mb + c.city_mb])
    );
  }

  return (
    <>
      {/* Filters */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-[700] text-[var(--muted)]">Mês:</span>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[12px] focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="">Todos</option>
              {months.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-[700] text-[var(--muted)]">Turno:</span>
            <div className="flex gap-1">
              {["", "7h", "15h", "23h"].map(s => (
                <button
                  key={s}
                  onClick={() => setSelectedShift(s)}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-[750] ${selectedShift === s ? "bg-[var(--accent)] text-white" : "bg-[#f0f2f7] text-[#667] hover:bg-[#e4e6ec]"}`}
                >
                  {s || "Todos"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          onClick={handleExport}
          className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-[11px] font-[700] text-[var(--muted)] hover:bg-[#f8fafc]"
        >
          Exportar CSV
        </button>
      </div>

      {/* Shift summaries */}
      <div className="mb-4 grid grid-cols-3 gap-2.5">
        {(["7h", "15h", "23h"] as const).map(shift => (
          <div key={shift} className={`rounded-xl border px-3 py-2.5 ${selectedShift === shift ? "border-[var(--accent)] bg-[#eaf2ff]" : "border-[#e8edf4] bg-[#f7f9fc]"}`}>
            <span className="block text-[10px] text-[#78869b]">{shift}</span>
            <strong className="block mt-1 text-[17px]">{euroShort(shiftTotals[shift].total)}</strong>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="max-h-[650px] overflow-auto rounded-xl border border-[#e7ebf1]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Data", "Turno", "Horário", "Dinheiro", "CV", "MB", "City MB", "Total"].map(h => (
                <th key={h} className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[12px] font-[750] text-[var(--muted)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const total = c.money + c.cv + c.mb + c.city_mb;
              const hours = c.shift === "7h" ? "23:00–07:00" : c.shift === "15h" ? "07:00–15:00" : "15:00–23:00";
              return (
                <tr key={c.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[#f8fafc]">
                  <td className="px-2.5 py-2 text-[13px] font-[600]">{formatDate(c.date)}</td>
                  <td className="px-2.5 py-2 text-[13px]">Fecho {c.shift}</td>
                  <td className="px-2.5 py-2 text-[12px] text-[var(--muted)]">{hours}</td>
                  <td className="px-2.5 py-2 text-right text-[13px] font-tabular">{euroShort(c.money)}</td>
                  <td className="px-2.5 py-2 text-right text-[13px] font-tabular">{euroShort(c.cv)}</td>
                  <td className="px-2.5 py-2 text-right text-[13px] font-tabular">{euroShort(c.mb)}</td>
                  <td className="px-2.5 py-2 text-right text-[13px] font-tabular">{euroShort(c.city_mb)}</td>
                  <td className="px-2.5 py-2 text-right text-[13px] font-[700] font-tabular">{euroShort(total)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-2.5 py-8 text-center text-[13px] text-[var(--muted)]">Nenhum fecho encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-[var(--muted)]">{filtered.length} fechos</div>
    </>
  );
}
