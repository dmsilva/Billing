import { getAllProducts } from "@/lib/db/queries";
import { euroShort, euro } from "@/lib/domain/reconciliation";
import { ExportButton } from "@/components/export-button";

export const dynamic = "force-dynamic";

export default function ProdutosPage() {
  const products = getAllProducts();
  const total = products.reduce((s, p) => s + (p.total_spent || 0), 0);

  const categories = [...new Set(products.map(p => p.category_name || "Sem categoria"))].sort();

  const breakfastCats = ["Pequeno-almoço", "Laticínios", "Fruta", "Bebidas"];
  const breakfastProducts = products.filter(p => breakfastCats.includes(p.category_name || ""));
  const breakfastTotal = breakfastProducts.reduce((s, p) => s + (p.total_spent || 0), 0);

  const croissantNote = products.find(p =>
    p.name.toLowerCase().includes("croissant") && !p.name.toLowerCase().includes("manteiga")
  );

  return (
    <div className="max-w-[1500px]">
      <div className="mb-5">
        <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">ANÁLISE</div>
        <h1 className="mt-1 text-[28px] font-[820] tracking-tight">Produtos</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Todos os itens registados em faturas, com quantidades e custos.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Card label="Produtos registados" value={String(products.length)} />
        <Card label="Total gasto" value={euro(total)} />
        <Card label="Pequeno-almoço" value={euro(breakfastTotal)} sub={`${breakfastProducts.length} itens`} />
        <Card label="Categorias" value={String(categories.length)} />
      </div>

      {croissantNote && (
        <div className="mb-4 rounded-xl border border-[#dce5f7] bg-[#f5f8ff] px-3.5 py-3 text-[12px]">
          <strong>Regra croissant ≠ manteiga:</strong> O croissant simples e o croissant com manteiga são produtos distintos.
          As quantidades e custos não devem ser misturados.
        </div>
      )}

      <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <div className="mb-3 flex justify-end">
          <ExportButton
            filename="produtos.csv"
            headers={["Produto", "Categoria", "Unidade", "Quantidade", "Custo total"]}
            rows={products.map(p => [p.name, p.category_name || "", p.unit || "", p.quantity ?? "", p.total_spent ?? ""])}
          />
        </div>
        <div className="max-h-[700px] overflow-auto rounded-xl border border-[#e7ebf1]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {["Produto", "Categoria", "Unidade", "Quantidade", "Custo total", "Notas"].map(h => (
                  <th key={h} className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[#f8fafc]">
                  <td className="px-2.5 py-2 font-[650]">{p.name}</td>
                  <td className="px-2.5 py-2">
                    {p.category_name ? (
                      <span className="inline-block rounded-full bg-[#edf2ff] px-2 py-0.5 text-[9px] font-[800] text-[#3658bd]">
                        {p.category_name}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-2.5 py-2 text-[var(--muted)]">{p.unit || "—"}</td>
                  <td className="px-2.5 py-2 text-right font-tabular">{p.quantity != null ? p.quantity : "—"}</td>
                  <td className="px-2.5 py-2 text-right font-[700] font-tabular whitespace-nowrap">
                    {p.total_spent != null ? euroShort(p.total_spent) : "—"}
                  </td>
                  <td className="px-2.5 py-2 text-[var(--muted)] max-w-[200px] truncate">{p.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[15px] border border-[var(--line)] bg-white p-4 shadow-[0_4px_18px_rgba(25,45,90,0.035)]">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-[22px] font-[820]">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}
