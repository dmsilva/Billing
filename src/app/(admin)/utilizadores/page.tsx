import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: string;
  created_at: string;
}

export default async function UtilizadoresPage() {
  await requireUser(["admin"]);

  const db = getDb();
  const users = db.prepare("SELECT id, username, display_name, role, created_at FROM users ORDER BY id").all() as UserRow[];

  return (
    <div className="max-w-[900px]">
      <div className="mb-5">
        <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">DEFINIÇÕES</div>
        <h1 className="mt-1 text-[28px] font-[820] tracking-tight">Utilizadores</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Contas registadas no sistema. A gestão de utilizadores estará disponível numa futura versão.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
        <Card label="Total utilizadores" value={String(users.length)} />
        <Card label="Administradores" value={String(users.filter(u => u.role === "admin").length)} />
        <Card label="Receção" value={String(users.filter(u => u.role === "reception").length)} />
      </div>

      <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <div className="rounded-xl border border-[#e7ebf1]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {["Nome", "Username", "Perfil", "Criado em"].map(h => (
                  <th key={h} className="border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[#f8fafc]">
                  <td className="px-2.5 py-2.5 font-[650]">{u.display_name}</td>
                  <td className="px-2.5 py-2.5 text-[var(--muted)]">{u.username}</td>
                  <td className="px-2.5 py-2.5">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-[800] ${
                      u.role === "admin"
                        ? "bg-[#edf2ff] text-[#3658bd]"
                        : "bg-[#f0f8f4] text-[#168455]"
                    }`}>
                      {u.role === "admin" ? "Administrador" : "Receção"}
                    </span>
                  </td>
                  <td className="px-2.5 py-2.5 text-[var(--muted)]">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString("pt-PT") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[#dce5f7] bg-[#f5f8ff] px-3.5 py-3 text-[12px] text-[var(--text)]">
        <strong>Nota:</strong> A criação e gestão de utilizadores será implementada numa futura versão.
        Atualmente existem duas contas pré-configuradas: admin e receção.
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
