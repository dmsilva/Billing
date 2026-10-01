import {
  getAllBankTransactions, getAllInvoices, getCategoryLookup, getPropertyLookup,
  getCashSummary,
} from "@/lib/db/queries";
import {
  computeMonthlyTotals, groupByCategory, computePropertySummary,
  groupSuppliers, monthFullLabel,
} from "@/lib/domain/classification";
import { AnaliseClient } from "./analise-client";

export const dynamic = "force-dynamic";

export default function AnalisePage() {
  const bankTxs = getAllBankTransactions();
  const invoices = getAllInvoices();
  const catLookup = getCategoryLookup();
  const propLookup = getPropertyLookup();

  const monthlyTotals = computeMonthlyTotals(bankTxs, invoices).map(m => ({
    ...m,
    label: monthFullLabel(m.month),
  }));

  const categories = groupByCategory(bankTxs, invoices, catLookup);
  const propertySummary = computePropertySummary(bankTxs, invoices, propLookup);
  const suppliers = groupSuppliers(bankTxs, catLookup);

  const allMonths = [...new Set([
    ...bankTxs.map(t => t.data_mov.slice(0, 7)),
    ...invoices.map(i => (i.invoice_date || "").slice(0, 7)).filter(Boolean),
  ])].sort();

  const cashEntries = allMonths.map(m => {
    const cs = getCashSummary(m);
    return {
      month: m,
      label: monthFullLabel(m),
      days: cs.days,
      total_closes: cs.total_closes,
      total_money: cs.total_money || 0,
      total_cv: cs.total_cv || 0,
      total_mb: cs.total_mb || 0,
      total_city_mb: cs.total_city_mb || 0,
    };
  });

  return (
    <div className="max-w-[1500px]">
      <div className="mb-5">
        <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">ANÁLISE</div>
        <h1 className="mt-1 text-[28px] font-[820] tracking-tight">Análise mensal</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Visão consolidada mês a mês: despesas CGD, numerário, entradas de caixa e categorias.
        </p>
      </div>

      <AnaliseClient
        monthlyTotals={monthlyTotals}
        cashEntries={cashEntries}
        categories={categories}
        suppliers={suppliers}
        propertySummary={propertySummary}
        months={allMonths}
      />
    </div>
  );
}
