"use client";

import { MonthBarChart, CategoryDonutChart } from "@/components/charts";

export function DashboardCharts({
  monthlyData,
  categoryData,
}: {
  monthlyData: { label: string; month: string; total: number }[];
  categoryData: { name: string; value: number }[];
}) {
  return (
    <div className="mb-4 grid grid-cols-[1.45fr_1fr] gap-4">
      <div className="rounded-[17px] border border-[var(--line)] bg-white p-[18px] shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[16px] font-[780] tracking-tight">Gastos por mês</h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">Despesas contabilísticas</p>
          </div>
          <span className="rounded-lg bg-[#edf2ff] px-2.5 py-1 text-[11px] font-[800] text-[#5574c9]">2026</span>
        </div>
        <MonthBarChart data={monthlyData} />
      </div>

      <div className="rounded-[17px] border border-[var(--line)] bg-white p-[18px] shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[16px] font-[780] tracking-tight">Gastos por categoria</h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">Distribuição do período</p>
          </div>
        </div>
        <CategoryDonutChart data={categoryData} />
      </div>
    </div>
  );
}
