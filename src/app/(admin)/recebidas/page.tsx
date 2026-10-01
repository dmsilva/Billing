import { getAllInvoices, getPropertyLookup } from "@/lib/db/queries";
import { formatDate, euroShort } from "@/lib/domain/reconciliation";
import { ValidationButtons } from "./validation-buttons";
import type { Invoice } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function RecebidasPage() {
  const allInvoices = getAllInvoices();
  const propLookup = getPropertyLookup();

  const pending = allInvoices.filter(i => i.validation_status === "Por validar");
  const validated = allInvoices.filter(i => i.validation_status === "Validada");
  const rejected = allInvoices.filter(i => i.validation_status === "Rejeitada");

  return (
    <div className="max-w-[1500px]">
      <div className="mb-5">
        <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">MOVIMENTOS</div>
        <h1 className="mt-1 text-[28px] font-[820] tracking-tight">Faturas recebidas</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Documentos enviados pela receção. Precisam de validação antes de entrar na contabilidade.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-3.5">
        <Card label="Total recebidas" value={String(allInvoices.length)} />
        <Card label="Por validar" value={String(pending.length)} warn={pending.length > 0} />
        <Card label="Validadas" value={String(validated.length)} good />
        <Card label="Rejeitadas" value={String(rejected.length)} />
      </div>

      {pending.length > 0 && (
        <div className="mb-4 rounded-xl border border-[#f7dac0] bg-[#fffbf4] px-3.5 py-3 text-[12px]">
          <strong>{pending.length} faturas</strong> estão pendentes de validação.
          Revê os dados, confirma a categoria e o imóvel antes de aceitar.
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-4 rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
          <h3 className="mb-3 text-[16px] font-[780] tracking-tight text-[var(--warn)]">Pendentes de validação</h3>
          <InvoiceTable invoices={pending} propLookup={propLookup} showActions />
        </div>
      )}

      <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <h3 className="mb-3 text-[16px] font-[780] tracking-tight">
          {pending.length > 0 ? "Processadas" : "Todas as faturas recebidas"}
        </h3>
        {(validated.length + rejected.length) > 0 ? (
          <InvoiceTable invoices={[...validated, ...rejected]} propLookup={propLookup} />
        ) : (
          <p className="py-8 text-center text-[13px] text-[var(--muted)]">Nenhuma fatura processada ainda.</p>
        )}
      </div>
    </div>
  );
}

function InvoiceTable({ invoices, propLookup, showActions }: {
  invoices: Invoice[];
  propLookup: Map<number, string>;
  showActions?: boolean;
}) {
  const headers = ["Data", "Fornecedor", "Documento", "Categoria", "Imóvel", "Enviado por", "Estado", "Valor"];
  if (showActions) headers.push("Ações");

  return (
    <div className="max-h-[500px] overflow-auto rounded-xl border border-[#e7ebf1]">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[#f8fafc]">
              <td className="px-2.5 py-2 whitespace-nowrap">{inv.invoice_date ? formatDate(inv.invoice_date) : "—"}</td>
              <td className="px-2.5 py-2 font-[650] max-w-[140px] truncate">{inv.supplier_name || "—"}</td>
              <td className="px-2.5 py-2 text-[var(--muted)] max-w-[120px] truncate">{inv.invoice_number || "—"}</td>
              <td className="px-2.5 py-2 max-w-[140px] truncate">{inv.category_name || "—"}</td>
              <td className="px-2.5 py-2">{propLookup.get(inv.property_id ?? -1) || "—"}</td>
              <td className="px-2.5 py-2 text-[var(--muted)]">{inv.submitted_by || "—"}</td>
              <td className="px-2.5 py-2">
                <StatusBadge status={inv.validation_status} />
              </td>
              <td className="px-2.5 py-2 text-right font-[700] font-tabular whitespace-nowrap">{euroShort(inv.total)}</td>
              {showActions && (
                <td className="px-2.5 py-2">
                  <ValidationButtons invoiceId={inv.id} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    "Por validar": "bg-[#fff3e3] text-[#b87918]",
    "Validada": "bg-[#eaf8f1] text-[#13724f]",
    "Rejeitada": "bg-[#fef3f2] text-[#b42318]",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-[800] ${styles[status] || "bg-[#f0f0f4] text-[#888]"}`}>
      {status}
    </span>
  );
}

function Card({ label, value, warn, good }: { label: string; value: string; warn?: boolean; good?: boolean }) {
  let color = "";
  if (warn) color = "text-[var(--warn)]";
  else if (good) color = "text-[var(--good)]";

  return (
    <div className="rounded-[15px] border border-[var(--line)] bg-white p-4 shadow-[0_4px_18px_rgba(25,45,90,0.035)]">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className={`mt-1 text-[25px] font-[820] ${color}`}>{value}</div>
    </div>
  );
}
