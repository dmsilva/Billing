import {
  getAllBankTransactions, getAllCategories, getCategoryLookup, getPropertyLookup,
} from "@/lib/db/queries";
import { EditarClient } from "./editar-client";

export const dynamic = "force-dynamic";

export default function EditarPage() {
  const txs = getAllBankTransactions();
  const categories = getAllCategories();
  const catLookup = getCategoryLookup();
  const propLookup = getPropertyLookup();

  const unclassified = txs.filter(t => {
    const cat = catLookup.get(t.category_id ?? -1) || "";
    return cat.toLowerCase().includes("por classificar") || !t.category_id;
  });

  const serialized = txs.map(t => ({
    id: t.id,
    data_mov: t.data_mov,
    descricao: t.descricao,
    valor: t.valor,
    categoryId: t.category_id,
    categoryName: catLookup.get(t.category_id ?? -1) || "—",
    propertyName: propLookup.get(t.property_id ?? -1) || "—",
  }));

  return (
    <div className="max-w-[1500px]">
      <div className="mb-5">
        <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">GESTÃO</div>
        <h1 className="mt-1 text-[28px] font-[820] tracking-tight">Editar categorias</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Atribuir ou alterar a categoria dos movimentos CGD. Gerir a lista de categorias.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Card label="Total movimentos" value={String(txs.length)} />
        <Card label="Por classificar" value={String(unclassified.length)} warn={unclassified.length > 0} />
        <Card label="Categorias ativas" value={String(categories.filter(c => c.is_active).length)} />
      </div>

      <EditarClient txs={serialized} categories={categories} />
    </div>
  );
}

function Card({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-[15px] border border-[var(--line)] bg-white p-4 shadow-[0_4px_18px_rgba(25,45,90,0.035)]">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className={`mt-1 text-[25px] font-[820] ${warn ? "text-[var(--warn)]" : ""}`}>{value}</div>
    </div>
  );
}
