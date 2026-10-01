"use client";

import { useState, useRef } from "react";

const PROPERTIES = ["Chalet D'Ávila", "Chalet do Lago"];

export default function RececaoPage() {
  const [fornecedor, setFornecedor] = useState("");
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [imovel, setImovel] = useState(PROPERTIES[0]);
  const [pagamento, setPagamento] = useState("Numerário");
  const [enviadoPor, setEnviadoPor] = useState("");
  const [documento, setDocumento] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files || []);
    setFiles(list);
    setPreviews(list.filter(f => f.type.startsWith("image/")).map(f => URL.createObjectURL(f)));
  }

  async function fileToDataURL(f: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(f);
    });
  }

  async function handleSubmit() {
    setSuccess(false);
    setError("");

    if (!files.length) {
      setError("Adiciona pelo menos uma foto ou PDF da fatura.");
      return;
    }
    if (!fornecedor.trim()) {
      setError("Indica o fornecedor.");
      return;
    }

    setSending(true);
    try {
      const fileData = [];
      for (const f of files) {
        fileData.push({ name: f.name, type: f.type, data: await fileToDataURL(f) });
      }

      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fornecedor: fornecedor.trim(),
          data,
          imovel,
          pagamento,
          enviadoPor: enviadoPor.trim(),
          documento: documento.trim(),
          observacoes: observacoes.trim(),
          files: fileData,
        }),
      });

      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "Não foi possível enviar.");

      setSuccess(true);
      setFornecedor("");
      setDocumento("");
      setObservacoes("");
      setFiles([]);
      setPreviews([]);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao enviar.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ background: "#f6f7fb", minHeight: "100vh" }}>
      <div className="mx-auto max-w-[720px] px-4 py-6 pb-12">
        <div className="mb-1.5 text-[25px] font-[800]">
          Fatura<span className="text-[#d63384]">Claro</span>
        </div>
        <div className="mb-5 text-[14px] text-[#667085]">Envio de faturas · Receção</div>

        <div className="rounded-[18px] border border-[#e8eaf0] bg-white p-5 shadow-[0_8px_28px_rgba(16,24,40,0.05)]">
          <h2 className="m-0 text-[20px] font-[800]">Enviar fatura</h2>
          <p className="mt-1 text-[12px] leading-[1.45] text-[#667085]">
            Fotografa a fatura/recibo, escolhe como foi pago e envia. A fatura original fica arquivada para posterior validação.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Fornecedor">
              <input
                value={fornecedor}
                onChange={e => setFornecedor(e.target.value)}
                placeholder="Ex.: Pingo Doce"
                className="field"
              />
            </Field>
            <Field label="Data da fatura">
              <input type="date" value={data} onChange={e => setData(e.target.value)} className="field" />
            </Field>
          </div>

          <Field label="Imóvel">
            <select value={imovel} onChange={e => setImovel(e.target.value)} className="field">
              {PROPERTIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </Field>

          <Field label="Meio de pagamento">
            <div className="grid grid-cols-2 gap-2.5">
              {["Numerário", "CGD"].map(p => (
                <label key={p} className="cursor-pointer">
                  <input
                    type="radio"
                    name="pay"
                    value={p}
                    checked={pagamento === p}
                    onChange={() => setPagamento(p)}
                    className="hidden"
                  />
                  <span className={`block rounded-[11px] border px-3.5 py-3.5 text-center text-[14px] font-[700] transition-colors ${
                    pagamento === p
                      ? "border-[#d63384] bg-[#fff2f8] text-[#b4236d]"
                      : "border-[#d9dde7] bg-white"
                  }`}>
                    {p === "Numerário" ? "💶 Numerário" : "🏦 CGD"}
                  </span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="Quem está a enviar?">
            <input
              value={enviadoPor}
              onChange={e => setEnviadoPor(e.target.value)}
              placeholder="Nome do funcionário"
              className="field"
            />
          </Field>

          <Field label="Documento / nº fatura" optional>
            <input
              value={documento}
              onChange={e => setDocumento(e.target.value)}
              placeholder="Ex.: FT 2026/1234"
              className="field"
            />
          </Field>

          <Field label="Foto ou PDF da fatura">
            <div className="mt-1 rounded-[14px] border-2 border-dashed border-[#d7dce7] bg-[#fafbfc] p-6 text-center">
              <div className="text-[14px] font-[700]">📷 Tirar foto ou escolher ficheiro</div>
              <div className="mt-1 text-[12px] text-[#667085]">Podes selecionar várias fotos para a mesma fatura.</div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                capture="environment"
                onChange={handleFiles}
                className="mt-3"
              />
            </div>
            {previews.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-3">
                {previews.map((src, i) => (
                  <img key={i} src={src} alt="" className="h-[110px] w-full rounded-[10px] border border-[#eee] object-cover" />
                ))}
              </div>
            )}
            {files.filter(f => !f.type.startsWith("image/")).map((f, i) => (
              <div key={i} className="mt-1.5 text-[12px] text-[#667085]">📄 {f.name}</div>
            ))}
          </Field>

          <Field label="Observações" optional>
            <textarea
              value={observacoes}
              onChange={e => setObservacoes(e.target.value)}
              placeholder="Alguma informação importante…"
              rows={3}
              className="field resize-y"
            />
          </Field>

          <button
            onClick={handleSubmit}
            disabled={sending}
            className="mt-5 w-full rounded-[12px] border-0 bg-[#d63384] px-4 py-3.5 text-[16px] font-[800] text-white disabled:opacity-55"
          >
            {sending ? "A enviar…" : "Enviar fatura"}
          </button>

          {success && (
            <div className="mt-3.5 rounded-[10px] bg-[#ecfdf3] px-3.5 py-3 text-[13px] text-[#067647]">
              ✓ Fatura enviada. Já ficou disponível na aplicação principal.
            </div>
          )}
          {error && (
            <div className="mt-3.5 rounded-[10px] bg-[#fef3f2] px-3.5 py-3 text-[13px] text-[#b42318]">
              {error}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .field {
          width: 100%;
          padding: 13px 14px;
          border: 1px solid #d9dde7;
          border-radius: 11px;
          font: inherit;
          background: #fff;
          font-size: 14px;
        }
        .field:focus {
          outline: none;
          border-color: #d63384;
          box-shadow: 0 0 0 3px rgba(214, 51, 132, 0.12);
        }
      `}</style>
    </div>
  );
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <label className="mb-1.5 block text-[14px] font-[700]">
        {label}
        {optional && <span className="ml-1 font-[400] text-[#98a2b3]">(opcional)</span>}
      </label>
      {children}
    </div>
  );
}
