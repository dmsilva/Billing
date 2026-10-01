import {
  getAllBankTransactions, getAllInvoices, getAllProducts,
  getCashSummary, getReconciliationStats,
  getCategoryLookup, getPropertyLookup,
} from "@/lib/db/queries";
import { euro, euroShort } from "@/lib/domain/reconciliation";
import {
  groupByCategory, computeMonthlyTotals,
  groupSuppliers, computePropertySummary,
} from "@/lib/domain/classification";
import { DashboardCharts } from "./dashboard-client";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const bankTxs = getAllBankTransactions();
  const invoices = getAllInvoices();
  const products = getAllProducts();
  const cashSummary = getCashSummary();
  const reconcileStats = getReconciliationStats();
  const catLookup = getCategoryLookup();
  const propLookup = getPropertyLookup();

  const expenseTxs = bankTxs.filter(t => !t.is_company_transfer);
  const bankTotal = expenseTxs.reduce((s, t) => s + t.valor, 0);
  const cashInvTotal = invoices.reduce((s, t) => s + t.total, 0);
  const accountingTotal = bankTotal + cashInvTotal;
  const cashEntries = (cashSummary.total_money || 0) + (cashSummary.total_cv || 0)
    + (cashSummary.total_mb || 0) + (cashSummary.total_city_mb || 0);

  const monthlyTotals = computeMonthlyTotals(bankTxs, invoices);
  const categoryTotals = groupByCategory(bankTxs, invoices, catLookup);
  const topCategories = categoryTotals.slice(0, 7);
  const suppliers = groupSuppliers(expenseTxs, catLookup);
  const propertySummary = computePropertySummary(bankTxs, invoices, propLookup);

  const breakfastProducts = products.filter(p =>
    ["Pequeno-almoço", "Laticínios", "Fruta", "Bebidas"].includes(p.category_name || "")
    && p.total_spent && p.total_spent > 0
  );
  const breakfastTotal = breakfastProducts.reduce((s, p) => s + (p.total_spent || 0), 0);
  const breakfastByCategory = new Map<string, number>();
  for (const p of breakfastProducts) {
    const cat = p.category_name || "Outros";
    breakfastByCategory.set(cat, (breakfastByCategory.get(cat) || 0) + (p.total_spent || 0));
  }
  const breakfastBars = [...breakfastByCategory.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const recentInvoices = invoices.slice(0, 6);

  const pendingInvoices = invoices.filter(i => i.validation_status === "Por validar").length;
  const pendingCloses = reconcileStats.totalCloses - Math.floor(reconcileStats.doneChecks / 3);
  const unclassified = bankTxs.filter(t => {
    const cat = catLookup.get(t.category_id ?? -1) || "";
    return cat.includes("por classificar") || cat.includes("Por classificar");
  }).length;

  return (
    <div className="max-w-[1500px]">
      {/* Welcome */}
      <div className="mb-6 flex items-end justify-between gap-5">
        <div>
          <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">GESTÃO FINANCEIRA</div>
          <h1 className="mt-1 text-[30px] font-[820] leading-tight tracking-tight">Visão geral</h1>
          <p className="mt-1.5 text-[13px] text-[var(--muted)]">Um resumo simples da situação financeira da empresa.</p>
        </div>
        <div className="rounded-xl border border-[#dfe6f1] bg-white px-3 py-2 min-w-[170px]">
          <span className="block text-[10px] text-[var(--muted)]">Período</span>
          <span className="font-[750]">Julho 2026</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <KpiCard icon="€" color="blue" label="Despesas CGD" value={euro(bankTotal)} sub="Saídas da conta bancária" />
        <KpiCard icon="€" color="green" label="Numerário" value={euro(cashInvTotal)} sub="Despesa contabilística" />
        <KpiCard icon="Σ" color="purple" label="Total contabilístico" value={euro(accountingTotal)} sub="CGD + numerário" />
        <KpiCard icon="↗" color="orange" label="Entradas de caixa" value={euro(cashEntries)} sub="Caixa diária Jan–Set" />
      </div>

      {/* Charts row */}
      <DashboardCharts
        monthlyData={monthlyTotals.map(m => ({ label: m.label, month: m.month, total: m.total }))}
        categoryData={topCategories.map(c => ({ name: c.name, value: c.total }))}
      />

      {/* Middle row: Recent invoices + Breakfast */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Panel title="Faturas recentes" subtitle="Últimos documentos registados" action={<Link href="/faturas" className="text-[12px] font-[750] text-[#2860dc]">Ver todas →</Link>}>
          <div className="text-[11px]">
            <div className="grid grid-cols-[78px_1.1fr_1fr_95px_80px] gap-2.5 px-1 pb-2 text-[10px] font-[800] text-[#8190a8]">
              <span>Data</span><span>Fornecedor</span><span>Categoria</span><span>Pagamento</span><span className="text-right">Valor</span>
            </div>
            {recentInvoices.map(inv => (
              <div key={inv.id} className="grid grid-cols-[78px_1.1fr_1fr_95px_80px] gap-2.5 border-t border-[#edf0f5] px-1 py-2.5 items-center">
                <span>{inv.invoice_date?.slice(8, 10)}/{inv.invoice_date?.slice(5, 7)}</span>
                <span className="truncate font-[750]">{inv.supplier_name}</span>
                <span className="truncate text-[var(--muted)]">{inv.category_name}</span>
                <span><span className="rounded-full bg-[#eaf8f1] px-2 py-0.5 text-[9px] font-[800] text-[#178457]">{inv.payment_source}</span></span>
                <span className="text-right font-[750]">{euroShort(inv.total)}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="☕ Pequeno-almoço" subtitle="Produtos já identificados" action={<Link href="/produtos" className="text-[12px] font-[750] text-[#2860dc]">Ver detalhes →</Link>}>
          <div className="mb-3 rounded-xl border border-[#e0e9fb] bg-gradient-to-br from-[#f8faff] to-[#f2f6ff] px-4 py-3">
            <span className="block text-[10px] text-[#72819a]">Total identificado</span>
            <strong className="block mt-0.5 text-[25px] tracking-tight">{euro(breakfastTotal)}</strong>
          </div>
          <DashboardBreakfastBars bars={breakfastBars} />
        </Panel>
      </div>

      {/* Bottom row: Attention + Properties */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Panel title="⚠ Precisa da tua atenção" subtitle="Itens que merecem revisão" className="bg-gradient-to-b from-white to-[#fffafa] border-[#f0dfe1]">
          <AttentionItem icon="📄" label={`${pendingInvoices} faturas por validar`} sub="Documentos enviados pela receção" href="/recebidas" />
          <AttentionItem icon="📦" label={`${pendingCloses} caixas por conferir`} sub="Envelopes ainda sem confirmação" href="/conferencia" />
          <AttentionItem icon="❓" label={`${unclassified} movimentos por classificar`} sub="CGD sem categoria atribuída" href="/editar" />
        </Panel>

        <Panel title="Resumo por local" subtitle="Despesas contabilísticas">
          <div className="text-[11px]">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2.5 px-0.5 pb-2 text-[10px] font-[800] text-[#8190a8]">
              <span>Imóvel</span><span className="text-right">CGD</span><span className="text-right">Numerário</span><span className="text-right">Total</span>
            </div>
            {propertySummary.map(p => (
              <div key={p.name} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2.5 border-t border-[#edf0f5] px-0.5 py-2.5">
                <span className="font-[700]">{p.name}</span>
                <span className="text-right font-tabular">{euroShort(p.cgd)}</span>
                <span className="text-right font-tabular">{euroShort(p.numerario)}</span>
                <span className="text-right font-[750] font-tabular">{euroShort(p.total)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Top suppliers */}
      <Panel title="Maiores fornecedores" subtitle="Agrupados — salários e financiamentos consolidados">
        <div className="max-h-[400px] overflow-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                <th className="sticky top-0 bg-white border-b border-[var(--line)] py-2 px-2 text-left text-[11px] font-[750] text-[var(--muted)]">Fornecedor</th>
                <th className="sticky top-0 bg-white border-b border-[var(--line)] py-2 px-2 text-left text-[11px] font-[750] text-[var(--muted)]">Categoria</th>
                <th className="sticky top-0 bg-white border-b border-[var(--line)] py-2 px-2 text-right text-[11px] font-[750] text-[var(--muted)]">Valor</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.slice(0, 20).map((s, i) => (
                <tr key={i} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-2 px-2 font-[650]">{s.name}</td>
                  <td className="py-2 px-2 text-[var(--muted)]">{s.category}</td>
                  <td className="py-2 px-2 text-right font-[750] font-tabular">{euroShort(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function KpiCard({ icon, color, label, value, sub }: {
  icon: string; color: string; label: string; value: string; sub: string;
}) {
  const c = { blue: { bg: "#eaf1ff", fg: "#3164ed" }, green: { bg: "#e7f8f0", fg: "#15905f" }, purple: { bg: "#f0ebff", fg: "#7351cf" }, orange: { bg: "#fff1df", fg: "#d17b08" } }[color] || { bg: "#eaf1ff", fg: "#3164ed" };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-white p-[17px] shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
      <div className="grid h-[42px] w-[42px] place-items-center rounded-xl text-[19px] font-[900]" style={{ background: c.bg, color: c.fg }}>{icon}</div>
      <div>
        <span className="block text-[12px] text-[#667692]">{label}</span>
        <strong className="block text-[24px] font-[820] leading-tight">{value}</strong>
        <small className="block text-[11px] text-[#7d8ba2]">{sub}</small>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, action, children, className }: {
  title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-[17px] border border-[var(--line)] bg-white p-[18px] shadow-[0_7px_24px_rgba(26,44,78,0.045)] mb-0 ${className || ""}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-[16px] font-[780] tracking-tight">{title}</h3>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function AttentionItem({ icon, label, sub, href }: { icon: string; label: string; sub: string; href: string }) {
  return (
    <Link href={href} className="grid grid-cols-[34px_1fr_auto] gap-2.5 items-center border-b border-[#f0e8e9] py-3 last:border-0 hover:bg-[#fff8f8] rounded-lg px-1 transition-colors">
      <div className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-[#fff0f1] text-[#d34855]">{icon}</div>
      <div>
        <strong className="block text-[12px]">{label}</strong>
        <span className="block text-[10px] text-[#7b879b] mt-0.5">{sub}</span>
      </div>
      <span className="text-[18px] text-[#5f6d83]">›</span>
    </Link>
  );
}

function DashboardBreakfastBars({ bars }: { bars: { name: string; value: number }[] }) {
  // Using a simple server-rendered version
  const max = Math.max(...bars.map(b => b.value), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {bars.map(b => (
        <div key={b.name} className="grid grid-cols-[125px_1fr_auto] items-center gap-2.5 text-[11px]">
          <span className="truncate font-[620]">{b.name}</span>
          <div className="h-[8px] overflow-hidden rounded-full bg-[#edf1f7]">
            <div className="h-full rounded-full" style={{ width: `${(b.value / max) * 100}%`, background: "linear-gradient(90deg, #5e83f4, #3159d9)" }} />
          </div>
          <strong className="whitespace-nowrap text-[10px]">{b.value.toLocaleString("pt-PT", { minimumFractionDigits: 0 })} €</strong>
        </div>
      ))}
    </div>
  );
}
