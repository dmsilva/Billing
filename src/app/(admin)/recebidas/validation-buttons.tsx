"use client";

import { useTransition } from "react";
import { validateInvoice, rejectInvoice } from "./actions";

export function ValidationButtons({ invoiceId }: { invoiceId: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-1.5">
      <button
        disabled={pending}
        onClick={() => startTransition(() => validateInvoice(invoiceId))}
        className="rounded-lg bg-[#eaf8f1] px-2 py-1 text-[10px] font-[800] text-[#13724f] hover:bg-[#d4f0e2] disabled:opacity-50"
      >
        Validar
      </button>
      <button
        disabled={pending}
        onClick={() => startTransition(() => rejectInvoice(invoiceId))}
        className="rounded-lg bg-[#fef3f2] px-2 py-1 text-[10px] font-[800] text-[#b42318] hover:bg-[#fde1de] disabled:opacity-50"
      >
        Rejeitar
      </button>
    </div>
  );
}
