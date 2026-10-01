import { getAllInvoices, getPropertyLookup } from "@/lib/db/queries";
import { FaturasClient } from "./faturas-client";

export const dynamic = "force-dynamic";

export default function FaturasPage() {
  const invoices = getAllInvoices();
  const propLookup = getPropertyLookup();

  const serialized = invoices.map(inv => ({
    id: inv.id,
    invoice_date: inv.invoice_date,
    supplier_name: inv.supplier_name,
    invoice_number: inv.invoice_number,
    description: inv.description,
    category_name: inv.category_name,
    propertyName: propLookup.get(inv.property_id ?? -1) || "—",
    payment_source: inv.payment_source,
    validation_status: inv.validation_status,
    total: inv.total,
  }));

  const months = [...new Set(invoices.map(i => (i.invoice_date || "").slice(0, 7)).filter(Boolean))].sort();
  const properties = [...new Set(serialized.map(i => i.propertyName).filter(p => p !== "—"))].sort();
  const categories = [...new Set(invoices.map(i => i.category_name).filter(Boolean) as string[])].sort();
  const paymentSources = [...new Set(invoices.map(i => i.payment_source))].sort();

  return (
    <div className="max-w-[1500px]">
      <div className="mb-5">
        <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">MOVIMENTOS</div>
        <h1 className="mt-1 text-[28px] font-[820] tracking-tight">Faturas e documentos</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Documentos que adicionámos ao controlo. As faturas pagas em numerário ficam separadas do extrato CGD.
        </p>
      </div>

      <FaturasClient
        invoices={serialized}
        months={months}
        properties={properties}
        categories={categories}
        paymentSources={paymentSources}
      />
    </div>
  );
}
