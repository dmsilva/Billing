"use client";

import { downloadCSV } from "@/lib/export";

export function ExportButton({ filename, headers, rows }: {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <button
      onClick={() => downloadCSV(filename, headers, rows)}
      className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-[11px] font-[700] text-[var(--muted)] hover:bg-[#f8fafc]"
    >
      Exportar CSV
    </button>
  );
}
