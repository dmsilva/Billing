"use client";

import { useState, useTransition } from "react";
import { changeTransactionCategory, addCategory, renameCategory, setCategoryActive } from "./actions";

interface Tx {
  id: number;
  data_mov: string;
  descricao: string;
  valor: number;
  categoryId: number | null;
  categoryName: string;
  propertyName: string;
}

interface Cat {
  id: number;
  name: string;
  is_active: number;
}

function formatDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function euroShort(v: number) {
  return v.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export function EditarClient({ txs, categories }: { txs: Tx[]; categories: Cat[] }) {
  const [pending, startTransition] = useTransition();
  const [newCatName, setNewCatName] = useState("");
  const [editingCat, setEditingCat] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [search, setSearch] = useState("");

  const activeCats = categories.filter(c => c.is_active);
  const inactiveCats = categories.filter(c => !c.is_active);

  const unclassified = txs.filter(t => {
    const cat = t.categoryName.toLowerCase();
    return cat.includes("por classificar") || cat === "—";
  });

  const filtered = (search
    ? txs.filter(t => t.descricao.toLowerCase().includes(search.toLowerCase()) || t.categoryName.toLowerCase().includes(search.toLowerCase()))
    : unclassified.length > 0 ? unclassified : txs
  );

  function handleCategoryChange(txId: number, catId: string) {
    startTransition(() => changeTransactionCategory(txId, catId ? Number(catId) : null));
  }

  function handleAddCategory() {
    if (!newCatName.trim()) return;
    startTransition(() => addCategory(newCatName));
    setNewCatName("");
  }

  function handleRename(id: number) {
    if (!editName.trim()) return;
    startTransition(() => renameCategory(id, editName));
    setEditingCat(null);
    setEditName("");
  }

  function handleToggle(id: number, active: boolean) {
    startTransition(() => setCategoryActive(id, active));
  }

  return (
    <>
      {/* Category management */}
      <div className="mb-4 rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <h3 className="mb-3 text-[16px] font-[780] tracking-tight">Gerir categorias</h3>
        <div className="mb-3 flex gap-2">
          <input
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            placeholder="Nova categoria…"
            onKeyDown={e => e.key === "Enter" && handleAddCategory()}
            className="flex-1 rounded-[10px] border border-[var(--line)] px-3 py-2 text-[13px] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={handleAddCategory}
            disabled={!newCatName.trim() || pending}
            className="rounded-[10px] bg-[var(--accent)] px-4 py-2 text-[12px] font-[750] text-white disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {activeCats.map(c => (
            <span key={c.id} className="group inline-flex items-center gap-1 rounded-full border border-[#dfe6f1] bg-[#f5f8ff] px-2.5 py-1 text-[11px] font-[700] text-[#3e5cb8]">
              {editingCat === c.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => { setEditingCat(null); setEditName(""); }}
                  onKeyDown={e => { if (e.key === "Enter") handleRename(c.id); if (e.key === "Escape") { setEditingCat(null); setEditName(""); } }}
                  className="w-[120px] border-b border-[#3e5cb8] bg-transparent text-[11px] outline-none"
                />
              ) : (
                <>
                  <span
                    className="cursor-pointer"
                    onClick={() => { setEditingCat(c.id); setEditName(c.name); }}
                    title="Clica para renomear"
                  >
                    {c.name}
                  </span>
                  <button
                    onClick={() => handleToggle(c.id, false)}
                    className="ml-0.5 hidden text-[9px] text-[#888] hover:text-[#b42318] group-hover:inline"
                    title="Desativar"
                  >
                    ×
                  </button>
                </>
              )}
            </span>
          ))}
        </div>
        {inactiveCats.length > 0 && (
          <div className="mt-3">
            <span className="text-[10px] font-[750] text-[var(--muted)]">Inativas:</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {inactiveCats.map(c => (
                <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-[#e8e8ec] bg-[#f5f5f8] px-2.5 py-1 text-[11px] text-[#888]">
                  {c.name}
                  <button onClick={() => handleToggle(c.id, true)} className="text-[9px] text-[#3e5cb8] hover:text-[#2a4090]" title="Reativar">+</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Transaction editing */}
      <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-[16px] font-[780] tracking-tight">
            {search ? `Resultados para "${search}"` : unclassified.length > 0 ? "Movimentos por classificar" : "Todos os movimentos"}
          </h3>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Pesquisar…"
            className="w-[220px] rounded-[10px] border border-[var(--line)] px-3 py-2 text-[12px] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>

        <div className="max-h-[600px] overflow-auto rounded-xl border border-[#e7ebf1]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {["Data", "Descrição", "Categoria", "Imóvel", "Valor"].map(h => (
                  <th key={h} className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[#f8fafc]">
                  <td className="px-2.5 py-2 whitespace-nowrap">{formatDate(t.data_mov)}</td>
                  <td className="px-2.5 py-2 max-w-[280px] truncate" title={t.descricao}>{t.descricao}</td>
                  <td className="px-2.5 py-2">
                    <select
                      value={t.categoryId ?? ""}
                      onChange={e => handleCategoryChange(t.id, e.target.value)}
                      disabled={pending}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-[700] ${
                        t.categoryName.toLowerCase().includes("por classificar") || t.categoryName === "—"
                          ? "border-[#f0d0a0] bg-[#fffbf4] text-[#b87918]"
                          : "border-[#dfe6f1] bg-[#f5f8ff] text-[#3e5cb8]"
                      }`}
                    >
                      <option value="">— Sem categoria —</option>
                      {activeCats.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2.5 py-2 text-[var(--muted)]">{t.propertyName}</td>
                  <td className="px-2.5 py-2 text-right font-[700] font-tabular whitespace-nowrap">{euroShort(t.valor)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-2.5 py-8 text-center text-[13px] text-[var(--muted)]">Nenhum movimento encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-[var(--muted)]">{filtered.length} movimentos</div>
      </div>
    </>
  );
}
