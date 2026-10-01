import { getAllBankTransactions, getCategoryLookup, getPropertyLookup } from "@/lib/db/queries";
import { CGDClient } from "./cgd-client";

export const dynamic = "force-dynamic";

export default function CGDPage() {
  const txs = getAllBankTransactions();
  const catLookup = getCategoryLookup();
  const propLookup = getPropertyLookup();

  const serialized = txs.map(t => ({
    id: t.id,
    data_mov: t.data_mov,
    descricao: t.descricao,
    valor: t.valor,
    saldo: t.saldo,
    categoryName: catLookup.get(t.category_id ?? -1) || "—",
    propertyName: propLookup.get(t.property_id ?? -1) || "—",
    isTransfer: !!t.is_company_transfer,
  }));

  const months = [...new Set(txs.map(t => t.data_mov.slice(0, 7)))].sort();
  const properties = [...new Set(serialized.map(t => t.propertyName).filter(p => p !== "—"))].sort();
  const categories = [...new Set(serialized.map(t => t.categoryName).filter(c => c !== "—"))].sort();

  return (
    <div className="max-w-[1500px]">
      <div className="mb-5">
        <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">MOVIMENTOS</div>
        <h1 className="mt-1 text-[28px] font-[820] tracking-tight">CGD / Extrato</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Todas as saídas que vieram da conta bancária CGD.
        </p>
      </div>

      <CGDClient txs={serialized} months={months} properties={properties} categories={categories} />
    </div>
  );
}
