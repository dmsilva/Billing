import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export default async function ConfiguracaoPage() {
  await requireUser(["admin"]);

  const db = getDb();
  const dbStats = {
    bankTxs: (db.prepare("SELECT COUNT(*) as cnt FROM bank_transactions").get() as { cnt: number }).cnt,
    cashCloses: (db.prepare("SELECT COUNT(*) as cnt FROM cash_closes").get() as { cnt: number }).cnt,
    invoices: (db.prepare("SELECT COUNT(*) as cnt FROM invoices").get() as { cnt: number }).cnt,
    products: (db.prepare("SELECT COUNT(*) as cnt FROM products").get() as { cnt: number }).cnt,
    categories: (db.prepare("SELECT COUNT(*) as cnt FROM categories").get() as { cnt: number }).cnt,
  };

  const recentAudit = getAuditLog(15);

  return (
    <div className="max-w-[1100px]">
      <div className="mb-5">
        <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">DEFINIÇÕES</div>
        <h1 className="mt-1 text-[28px] font-[820] tracking-tight">Configuração</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Estado do sistema, estatísticas da base de dados e registo de atividade.
        </p>
      </div>

      {/* System stats */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Movimentos CGD" value={String(dbStats.bankTxs)} />
        <StatCard label="Fechos de caixa" value={String(dbStats.cashCloses)} />
        <StatCard label="Faturas" value={String(dbStats.invoices)} />
        <StatCard label="Produtos" value={String(dbStats.products)} />
        <StatCard label="Categorias" value={String(dbStats.categories)} />
      </div>

      {/* System info */}
      <div className="mb-4 rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <h3 className="mb-3 text-[16px] font-[780] tracking-tight">Informação do sistema</h3>
        <div className="grid grid-cols-1 gap-2.5 text-[12px] sm:grid-cols-2">
          <InfoRow label="Aplicação" value="FaturaClaro v1.0" />
          <InfoRow label="Framework" value="Next.js + TypeScript" />
          <InfoRow label="Base de dados" value="SQLite (better-sqlite3)" />
          <InfoRow label="Autenticação" value="Cookie-based sessions" />
          <InfoRow label="Período de dados" value="Janeiro – Setembro 2026" />
          <InfoRow label="Imóveis" value="Chalet D'Ávila, Chalet do Lago" />
        </div>
      </div>

      {/* Audit log */}
      <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <h3 className="mb-3 text-[16px] font-[780] tracking-tight">Registo de atividade</h3>
        {recentAudit.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-[var(--muted)]">
            Sem atividade registada.
          </div>
        ) : (
          <div className="max-h-[500px] overflow-auto rounded-xl border border-[#e7ebf1]">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {["Data/hora", "Utilizador", "Ação", "Entidade", "Campo", "Anterior", "Novo"].map(h => (
                    <th key={h} className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentAudit.map((entry, i) => (
                  <tr key={i} className="border-b border-[var(--line)] last:border-0 hover:bg-[#f8fafc]">
                    <td className="px-2.5 py-2 whitespace-nowrap text-[var(--muted)]">
                      {entry.created_at ? new Date(entry.created_at).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-2.5 py-2 font-[650]">{entry.username || "—"}</td>
                    <td className="px-2.5 py-2">
                      <span className="inline-block rounded-full bg-[#edf2ff] px-2 py-0.5 text-[10px] font-[800] text-[#3658bd]">
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 text-[var(--muted)]">{entry.entity_type} #{entry.entity_id}</td>
                    <td className="px-2.5 py-2 text-[var(--muted)]">{entry.field_name || "—"}</td>
                    <td className="px-2.5 py-2 max-w-[120px] truncate text-[var(--muted)]">{entry.old_value || "—"}</td>
                    <td className="px-2.5 py-2 max-w-[120px] truncate font-[650]">{entry.new_value || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[15px] border border-[var(--line)] bg-white p-4 shadow-[0_4px_18px_rgba(25,45,90,0.035)]">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-[22px] font-[820]">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#edf0f5] bg-[#f8fafc] px-3 py-2.5">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-[700]">{value}</span>
    </div>
  );
}
