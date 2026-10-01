import { getAllCashCloses, getCashSummary } from "@/lib/db/queries";
import { euroShort } from "@/lib/domain/reconciliation";
import { ImportButton } from "./import-dialog";
import { CaixaClient } from "./caixa-client";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function CaixaDiariaPage() {
  const closes = getAllCashCloses();
  const summary = getCashSummary();

  const months = [...new Set(closes.map(c => c.date.slice(0, 7)))].sort();

  const serialized = closes.map(c => ({
    id: c.id,
    date: c.date,
    shift: c.shift,
    money: c.money,
    cv: c.cv,
    mb: c.mb,
    city_mb: c.city_mb,
  }));

  return (
    <div className="max-w-[1500px]">
      <div className="mb-5 flex items-end justify-between gap-5">
        <div>
          <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">ENTRADAS · CAIXA</div>
          <h1 className="mt-1 text-[28px] font-[820] tracking-tight">Caixa diária</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            Consulta os fechos dos colaboradores por dia e por turno.
          </p>
        </div>
        <ImportButton />
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon="▣" color="blue" label="Dias com registo" value={String(summary.days)} sub="Caixa diária importada" />
        <KpiCard icon="€" color="green" label="Dinheiro" value={euroShort(summary.total_money)} sub="Total dos fechos" />
        <KpiCard icon="MB" color="purple" label="MB" value={euroShort(summary.total_mb)} sub="Pagamentos por cartão" />
        <KpiCard icon="CV" color="orange" label="CV" value={euroShort(summary.total_cv)} sub="Cartão virtual" />
      </div>

      {/* Grid: table + conference link */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_0.75fr]">
        <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-base font-[780]">Fechos por dia</h3>
              <p className="text-[11px] text-[var(--muted)]">7h · 15h · 23h</p>
            </div>
          </div>

          <CaixaClient closes={serialized} months={months} />
        </div>

        {/* Conference sidebar card */}
        <div className="flex flex-col justify-center rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
          <h3 className="text-[17px] font-[780]">Conferência</h3>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
            Confirma os envelopes quando estiveres com o dinheiro em mão.
          </p>
          <div className="mt-4 grid h-[46px] w-[46px] place-items-center rounded-[14px] bg-[#eaf2ff] text-[24px] font-[900] text-[#3265ed]">
            ✓
          </div>
          <strong className="mt-3 text-[17px]">Pronto para conferir?</strong>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
            A conferência percorre automaticamente CV → MB → Numerário e passa para o próximo envelope.
          </p>
          <Link
            href="/conferencia"
            className="mt-4 block w-full rounded-[11px] bg-[var(--accent)] px-4 py-3 text-center text-sm font-[750] text-white shadow-[0_7px_16px_rgba(59,99,232,0.18)]"
          >
            Abrir conferência
          </Link>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[#dce5f7] bg-[#f5f8ff] px-3.5 py-3 text-[12px] text-[var(--text)]">
        <strong>Formato aceite:</strong> Hóspede, Quarto, Dinheiro, CV, MB, city mb, Funcionário. As linhas &quot;Fecho 7h&quot;, &quot;Fecho 15h&quot; e &quot;Fecho 23h&quot; definem os totais de cada turno.
      </div>
    </div>
  );
}

function KpiCard({ icon, color, label, value, sub }: {
  icon: string; color: string; label: string; value: string; sub: string;
}) {
  const colors = {
    blue: { bg: "#eaf1ff", fg: "#3164ed" },
    green: { bg: "#e7f8f0", fg: "#15905f" },
    purple: { bg: "#f0ebff", fg: "#7351cf" },
    orange: { bg: "#fff1df", fg: "#d17b08" },
  }[color] || { bg: "#eaf1ff", fg: "#3164ed" };

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-white p-[17px] shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
      <div className="grid h-[42px] w-[42px] place-items-center rounded-xl text-[19px] font-[900]"
        style={{ background: colors.bg, color: colors.fg }}>
        {icon}
      </div>
      <div>
        <span className="block text-[12px] text-[#667692]">{label}</span>
        <strong className="block text-[24px] font-[820] leading-tight">{value}</strong>
        <small className="block text-[11px] text-[#7d8ba2]">{sub}</small>
      </div>
    </div>
  );
}
