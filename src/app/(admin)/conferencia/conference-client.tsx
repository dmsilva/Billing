"use client";

import { useState, useRef, useEffect, useCallback, useTransition } from "react";
import { confirmCheck, editCheck, resetAllChecks, type ConferenceState } from "./actions";
import {
  formatDate,
  euroShort,
  checkLabel,
  checkIcon,
  shiftLabel,
  shiftHours,
  type ReconcileItem,
} from "@/lib/domain/reconciliation";

export function ConferenceClient({ initialState }: { initialState: ConferenceState }) {
  const [state, setState] = useState(initialState);
  const [inputValue, setInputValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const { items, currentIndex, stats } = state;
  const current = items[currentIndex];
  const allDone = items.every(i => i.check);
  const progressPct = stats.totalChecks > 0 ? (stats.doneChecks / stats.totalChecks) * 100 : 0;

  useEffect(() => {
    if (inputRef.current && !allDone) {
      inputRef.current.focus();
    }
  }, [currentIndex, allDone]);

  const handleConfirm = useCallback(() => {
    if (!current || isPending) return;

    const actualValue = inputValue.trim() === ""
      ? null
      : parseFloat(inputValue.replace(",", "."));

    if (inputValue.trim() !== "" && (actualValue === null || isNaN(actualValue))) return;

    startTransition(async () => {
      await confirmCheck(current.cashClose.id, current.type, actualValue);

      setState(prev => {
        const newItems = [...prev.items];
        const expected = current.expected;
        const actual = actualValue ?? expected;
        const diff = actual - expected;

        newItems[currentIndex] = {
          ...newItems[currentIndex],
          check: {
            id: 0,
            cash_close_id: current.cashClose.id,
            type: current.type,
            expected_value: expected,
            actual_value: actual,
            difference: diff,
            status: Math.abs(diff) < 0.01 ? "Conferido" : "Diferença",
            checked_by: null,
            checked_at: new Date().toISOString(),
          },
        };

        const nextPending = newItems.findIndex((item, i) => i > currentIndex && !item.check);
        const newIndex = nextPending === -1
          ? newItems.findIndex(item => !item.check)
          : nextPending;

        return {
          ...prev,
          items: newItems,
          currentIndex: newIndex === -1 ? newItems.length - 1 : newIndex,
          stats: {
            ...prev.stats,
            doneChecks: prev.stats.doneChecks + 1,
            okChecks: prev.stats.okChecks + (Math.abs(diff) < 0.01 ? 1 : 0),
            diffChecks: prev.stats.diffChecks + (Math.abs(diff) >= 0.01 ? 1 : 0),
          },
        };
      });

      setInputValue("");
    });
  }, [current, inputValue, isPending, currentIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    }
  }, [handleConfirm]);

  const handleEdit = useCallback((item: ReconcileItem) => {
    if (!item.check) return;
    const current = item.check.actual_value;
    const input = prompt(
      `Editar ${checkLabel(item.type)} — ${formatDate(item.cashClose.date)} · Fecho ${item.cashClose.shift}\nValor atual: ${euroShort(current)}\nNovo valor:`,
      String(current ?? "")
    );
    if (input === null) return;

    const newVal = parseFloat(input.replace(",", "."));
    if (isNaN(newVal)) return;

    startTransition(async () => {
      await editCheck(item.cashClose.id, item.type, newVal);

      setState(prev => {
        const newItems = [...prev.items];
        const idx = newItems.findIndex(
          i => i.cashClose.id === item.cashClose.id && i.type === item.type
        );
        if (idx !== -1 && newItems[idx].check) {
          const expected = newItems[idx].expected;
          const diff = newVal - expected;
          const wasOk = newItems[idx].check!.status === "Conferido";
          const nowOk = Math.abs(diff) < 0.01;

          newItems[idx] = {
            ...newItems[idx],
            check: {
              ...newItems[idx].check!,
              actual_value: newVal,
              difference: diff,
              status: nowOk ? "Conferido" : "Diferença",
            },
          };

          return {
            ...prev,
            items: newItems,
            stats: {
              ...prev.stats,
              okChecks: prev.stats.okChecks + (nowOk && !wasOk ? 1 : 0) - (!nowOk && wasOk ? 1 : 0),
              diffChecks: prev.stats.diffChecks + (!nowOk && wasOk ? 1 : 0) - (nowOk && !wasOk ? 1 : 0),
            },
          };
        }
        return prev;
      });
    });
  }, []);

  const handleReset = useCallback(() => {
    if (!confirm("Tens a certeza que queres limpar todas as conferências?")) return;
    startTransition(async () => {
      await resetAllChecks();
      setState(prev => ({
        ...prev,
        items: prev.items.map(i => ({ ...i, check: null })),
        currentIndex: 0,
        stats: { ...prev.stats, doneChecks: 0, okChecks: 0, diffChecks: 0 },
      }));
    });
  }, []);

  // Build history grouped by cash close
  const historyCloses = new Map<number, { close: typeof current.cashClose; checks: ReconcileItem[] }>();
  for (const item of items) {
    if (!historyCloses.has(item.cashClose.id)) {
      historyCloses.set(item.cashClose.id, { close: item.cashClose, checks: [] });
    }
    historyCloses.get(item.cashClose.id)!.checks.push(item);
  }

  return (
    <div className="max-w-[1500px]">
      {/* Header */}
      <div className="mb-5 flex items-end justify-between gap-5">
        <div>
          <div className="text-[10px] font-[850] tracking-[0.14em] text-[#5c78c9]">
            ENTRADAS · CONFERÊNCIA
          </div>
          <h1 className="mt-1 text-[28px] font-[820] tracking-tight">Conferência de caixa</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            Uma fila simples para conferires os envelopes, sem andares a procurar o dia e o turno.
          </p>
        </div>
        <div className="rounded-xl border border-[#dfe6f1] bg-white px-4 py-3 text-sm font-[800] text-[#315fd8]">
          {stats.doneChecks} / {stats.totalChecks} conferências
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4 rounded-[15px] border border-[var(--line)] bg-white px-4 py-3.5">
        <div className="mb-2 flex justify-between text-[12px]">
          <strong>Progresso</strong>
          <span className="font-[750] text-[#60708a]">
            {stats.doneChecks} / {stats.totalChecks} ({progressPct.toFixed(1)}%)
          </span>
        </div>
        <div className="h-[9px] overflow-hidden rounded-full bg-[#edf1f7]">
          <div
            className="h-full rounded-full transition-all duration-200"
            style={{
              width: `${progressPct}%`,
              background: "linear-gradient(90deg, #5e83f4, #2f60e8)",
            }}
          />
        </div>
      </div>

      {/* Main grid */}
      <div className="mb-4 grid grid-cols-[1.45fr_0.75fr] gap-4">
        {/* Current envelope */}
        <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-base font-[780]">
                {allDone ? "Conferência completa!" : "Próximo envelope"}
              </h3>
              <p className="text-[11px] text-[var(--muted)]">
                Confirma os valores pela ordem apresentada.
              </p>
            </div>
            {!allDone && (
              <span className="rounded-full bg-[#fff3dc] px-2 py-1 text-[9px] font-[800] text-[#a66a05]">
                Por conferir
              </span>
            )}
          </div>

          {allDone ? (
            <div className="rounded-xl bg-[#eaf8f1] p-6 text-center">
              <div className="text-2xl">🎉</div>
              <p className="mt-2 font-[750] text-[#13724f]">
                Todos os {stats.totalChecks} envelopes foram conferidos!
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {stats.okChecks} OK · {stats.diffChecks} com diferença
              </p>
            </div>
          ) : current && (
            <div className="grid grid-cols-[1.4fr_0.8fr_1fr] items-center gap-4 rounded-[15px] border border-[#dce4f0] bg-[#fbfcff] p-5">
              <div>
                <div className="text-[11px] font-[700] text-[var(--muted)]">PRÓXIMA CONFERÊNCIA</div>
                <div className="mt-1 text-[15px] font-[800]">
                  {formatDate(current.cashClose.date)} · Fecho {current.cashClose.shift}
                </div>
                <div className="mt-1 text-[11px] text-[var(--muted)]">
                  {shiftHours(current.cashClose.shift)} · {shiftLabel(current.cashClose.shift)}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-[700] text-[var(--muted)]">
                  {checkIcon(current.type)} Valor {checkLabel(current.type)}: confere?
                </div>
                <div className="mt-1 text-[28px] font-[850]">
                  {euroShort(current.expected)}
                </div>
                <div className="mt-1 text-[11px] text-[var(--muted)]">Valor esperado neste fecho</div>
              </div>

              <div>
                <div className="text-[11px] font-[700] text-[var(--muted)]">
                  Se não bater, escreve o valor real
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="decimal"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Valor real"
                    disabled={isPending}
                    className="h-[52px] w-full rounded-[11px] border-2 border-[#cfd9e8] px-3.5 text-right text-[22px] font-[800] font-tabular focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_#edf2ff]"
                  />
                  <button
                    onClick={handleConfirm}
                    disabled={isPending}
                    className="shrink-0 rounded-[11px] bg-[var(--accent)] px-4 text-sm font-[750] text-white shadow-[0_7px_16px_rgba(59,99,232,0.18)] transition-transform hover:-translate-y-[1px] disabled:opacity-50"
                  >
                    ✓ OK
                  </button>
                </div>
                <div className="mt-2 rounded-[11px] bg-[#fff8df] px-3 py-2 text-[11px] font-[800] text-[#8a6500]">
                  OK / ENTER = bate certo · ou escreve o valor real
                </div>
              </div>
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
          <h3 className="text-base font-[780]">Como funciona</h3>
          <p className="mb-3 text-[11px] text-[var(--muted)]">Três confirmações por envelope.</p>

          {(["cv", "mb", "money"] as const).map((type, i) => (
            <div key={type} className="flex items-center gap-3 border-b border-[#edf0f5] py-3 last:border-0">
              <span className="grid h-[27px] w-[27px] place-items-center rounded-[9px] bg-[#edf3ff] text-[11px] font-[800] text-[#3164e5]">
                {i + 1}
              </span>
              <div>
                <strong className="block text-[12px]">{checkLabel(type)}</strong>
                <span className="block text-[10px] text-[var(--muted)]">
                  {type === "cv" && "Compara com o valor do fecho."}
                  {type === "mb" && "Confirma o valor dos cartões."}
                  {type === "money" && "Conta o dinheiro físico do envelope."}
                </span>
              </div>
            </div>
          ))}

          <div className="mt-3 rounded-[11px] border border-[#f2e2bc] bg-[#fff8e8] px-3 py-2.5 text-[10px] leading-relaxed text-[#765d24]">
            💡 <strong>Enter</strong> confirma. Se houver diferença, escreve o valor real e carrega Enter.
          </div>
        </div>
      </div>

      {/* History table */}
      <div className="rounded-[17px] border border-[var(--line)] bg-white p-5 shadow-[0_7px_24px_rgba(26,44,78,0.045)]">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-base font-[780]">Histórico da conferência</h3>
            <p className="text-[11px] text-[var(--muted)]">
              🟢 Conferido · 🔴 Diferença · 🟡 Por conferir
            </p>
          </div>
          <button
            onClick={handleReset}
            className="rounded-[9px] border border-[#d7dfeb] bg-white px-3 py-2 text-[12px] font-[700] hover:bg-gray-50"
          >
            Limpar conferências
          </button>
        </div>

        <div className="max-h-[650px] overflow-auto rounded-xl border border-[#e7ebf1]">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[12px] font-[750] text-[var(--muted)]">Data</th>
                <th className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[12px] font-[750] text-[var(--muted)]">Turno</th>
                <th className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[12px] font-[750] text-[var(--muted)]">CV</th>
                <th className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[12px] font-[750] text-[var(--muted)]">MB</th>
                <th className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[#f8fafc] px-2.5 py-2.5 text-left text-[12px] font-[750] text-[var(--muted)]">Numerário</th>
              </tr>
            </thead>
            <tbody>
              {[...historyCloses.values()].map(({ close, checks }) => {
                const cv = checks.find(c => c.type === "cv");
                const mb = checks.find(c => c.type === "mb");
                const money = checks.find(c => c.type === "money");

                return (
                  <tr key={close.id} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-2.5 py-2.5 text-[13px] font-[600]">{formatDate(close.date)}</td>
                    <td className="px-2.5 py-2.5 text-[13px]">Fecho {close.shift}</td>
                    <td className="px-2.5 py-2.5"><CheckCell item={cv} onEdit={handleEdit} /></td>
                    <td className="px-2.5 py-2.5"><CheckCell item={mb} onEdit={handleEdit} /></td>
                    <td className="px-2.5 py-2.5"><CheckCell item={money} onEdit={handleEdit} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CheckCell({ item, onEdit }: { item?: ReconcileItem; onEdit: (item: ReconcileItem) => void }) {
  if (!item) return <span className="text-[var(--muted)]">—</span>;

  const check = item.check;
  if (!check) {
    return (
      <span className="inline-block rounded-full bg-[#fff8df] px-2 py-0.5 text-[10px] font-[800] text-[#8a6500]">
        🟡 {euroShort(item.expected)}
      </span>
    );
  }

  const isOk = check.status === "Conferido";
  return (
    <button
      onClick={() => onEdit(item)}
      className="inline-block cursor-pointer rounded-full px-2 py-0.5 text-[10px] font-[800] transition-opacity hover:opacity-80"
      style={{
        background: isOk ? "#eaf8f1" : "#fff0f1",
        color: isOk ? "#13724f" : "#b52e3d",
      }}
      title="Clica para editar"
    >
      {isOk ? "🟢" : "🔴"} {euroShort(check.actual_value)}
      {!isOk && check.difference !== null && (
        <span className="ml-1 opacity-70">
          ({check.difference > 0 ? "+" : ""}{check.difference.toFixed(2)})
        </span>
      )}
    </button>
  );
}
