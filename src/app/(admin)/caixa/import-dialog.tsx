"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface ParsedRecord {
  date: string;
  shift: string;
  money: number;
  cv: number;
  mb: number;
  city_mb: number;
}

export function ImportButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-[11px] bg-[var(--accent)] px-4 py-2.5 text-[13px] font-[750] text-white shadow-[0_4px_14px_rgba(59,99,232,0.18)]"
      >
        Importar Excel
      </button>
      {open && <ImportDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [records, setRecords] = useState<ParsedRecord[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [imported, setImported] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handlePreview() {
    if (!file) return;
    setLoading(true);
    setErrors([]);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("action", "preview");
      const res = await fetch("/api/cash-import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRecords(data.records);
      setErrors(data.errors);
      setStep("preview");
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : "Erro ao ler ficheiro."]);
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("action", "import");
      const res = await fetch("/api/cash-import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImported(data.imported);
      setStep("done");
      router.refresh();
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : "Erro ao importar."]);
    } finally {
      setLoading(false);
    }
  }

  function euro(v: number) {
    return v.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[700px] max-h-[85vh] overflow-auto rounded-[20px] bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[20px] font-[800]">Importar dados de caixa</h2>
          <button onClick={onClose} className="text-[20px] text-[var(--muted)] hover:text-[var(--text)]">&times;</button>
        </div>

        {step === "upload" && (
          <>
            <p className="mb-4 text-[13px] text-[var(--muted)]">
              Seleciona o ficheiro Excel com os fechos de caixa. O formato deve incluir colunas: Data, Turno (7h/15h/23h), Dinheiro, CV, MB, City MB.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="mb-4"
            />
            {errors.map((e, i) => (
              <div key={i} className="mb-2 rounded-lg bg-[#fef3f2] px-3 py-2 text-[12px] text-[#b42318]">{e}</div>
            ))}
            <button
              disabled={!file || loading}
              onClick={handlePreview}
              className="rounded-[11px] bg-[var(--accent)] px-5 py-2.5 text-[13px] font-[750] text-white disabled:opacity-50"
            >
              {loading ? "A ler…" : "Pré-visualizar"}
            </button>
          </>
        )}

        {step === "preview" && (
          <>
            <div className="mb-3 rounded-lg bg-[#f5f8ff] border border-[#dce5f7] px-3 py-2.5 text-[12px]">
              <strong>{records.length}</strong> registos encontrados.
              {errors.length > 0 && <span className="ml-2 text-[var(--warn)]">{errors.length} avisos.</span>}
            </div>
            {errors.map((e, i) => (
              <div key={i} className="mb-1 text-[11px] text-[var(--warn)]">{e}</div>
            ))}
            <div className="mb-4 max-h-[350px] overflow-auto rounded-xl border border-[#e7ebf1]">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    {["Data", "Turno", "Dinheiro", "CV", "MB", "City MB"].map(h => (
                      <th key={h} className="sticky top-0 border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2 text-left text-[11px] font-[750] text-[var(--muted)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-[var(--line)] last:border-0">
                      <td className="px-2.5 py-1.5">{r.date}</td>
                      <td className="px-2.5 py-1.5">{r.shift}</td>
                      <td className="px-2.5 py-1.5 text-right font-tabular">{euro(r.money)}</td>
                      <td className="px-2.5 py-1.5 text-right font-tabular">{euro(r.cv)}</td>
                      <td className="px-2.5 py-1.5 text-right font-tabular">{euro(r.mb)}</td>
                      <td className="px-2.5 py-1.5 text-right font-tabular">{euro(r.city_mb)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {records.length > 50 && (
              <p className="mb-3 text-[11px] text-[var(--muted)]">A mostrar 50 de {records.length} registos.</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setStep("upload"); setRecords([]); setErrors([]); }}
                className="rounded-[11px] border border-[var(--line)] bg-white px-4 py-2.5 text-[13px] font-[700]"
              >
                Voltar
              </button>
              <button
                disabled={loading || records.length === 0}
                onClick={handleImport}
                className="rounded-[11px] bg-[var(--accent)] px-5 py-2.5 text-[13px] font-[750] text-white disabled:opacity-50"
              >
                {loading ? "A importar…" : `Importar ${records.length} registos`}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <div className="mb-4 rounded-lg bg-[#ecfdf3] px-4 py-3 text-[13px] text-[#067647]">
              ✓ <strong>{imported} registos</strong> importados com sucesso.
            </div>
            <button
              onClick={onClose}
              className="rounded-[11px] bg-[var(--accent)] px-5 py-2.5 text-[13px] font-[750] text-white"
            >
              Fechar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
