import * as XLSX from "xlsx";

export interface ParsedCashClose {
  date: string;
  shift: string;
  money: number;
  cv: number;
  mb: number;
  city_mb: number;
}

export interface ImportResult {
  records: ParsedCashClose[];
  errors: string[];
  sheetName: string;
}

const SHIFT_PATTERNS: Record<string, string> = {
  "7h": "7h",
  "7H": "7h",
  "07h": "7h",
  "fecho 7h": "7h",
  "Fecho 7h": "7h",
  "15h": "15h",
  "15H": "15h",
  "fecho 15h": "15h",
  "Fecho 15h": "15h",
  "23h": "23h",
  "23H": "23h",
  "fecho 23h": "23h",
  "Fecho 23h": "23h",
};

function detectShift(value: string): string | null {
  const trimmed = value.trim();
  if (SHIFT_PATTERNS[trimmed]) return SHIFT_PATTERNS[trimmed];
  if (/\b7\s*h/i.test(trimmed)) return "7h";
  if (/\b15\s*h/i.test(trimmed)) return "15h";
  if (/\b23\s*h/i.test(trimmed)) return "23h";
  return null;
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) {
      const y = String(d.y).padStart(4, "0");
      const m = String(d.m).padStart(2, "0");
      const day = String(d.d).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
  }
  if (typeof value === "string") {
    const match = value.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (match) {
      return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    }
    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return isoMatch[0];
  }
  return null;
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

export function parseCashExcel(buffer: ArrayBuffer): ImportResult {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const errors: string[] = [];
  const records: ParsedCashClose[] = [];
  let sheetName = "";

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

    if (rows.length < 2) continue;

    sheetName = name;
    let dateCol = -1;
    let shiftCol = -1;
    let moneyCol = -1;
    let cvCol = -1;
    let mbCol = -1;
    let cityMbCol = -1;

    const headerRow = rows[0];
    if (!headerRow) continue;

    for (let c = 0; c < headerRow.length; c++) {
      const h = String(headerRow[c] || "").toLowerCase().trim();
      if (h.includes("data") || h.includes("date")) dateCol = c;
      else if (h.includes("turno") || h.includes("shift") || h.includes("fecho")) shiftCol = c;
      else if (h === "dinheiro" || h === "cash" || h === "money") moneyCol = c;
      else if (h === "cv" || h === "cartão" || h === "cartao") cvCol = c;
      else if (h === "city mb" || h === "citymb" || h === "city_mb") cityMbCol = c;
      else if (h === "mb" || h === "multibanco") mbCol = c;
    }

    if (dateCol === -1) {
      errors.push(`Folha "${name}": coluna de data não encontrada.`);
      continue;
    }

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(v => v == null || v === "")) continue;

      const date = parseDate(row[dateCol]);
      if (!date) continue;

      const shiftRaw = shiftCol >= 0 ? String(row[shiftCol] || "") : "";
      const shift = detectShift(shiftRaw);
      if (!shift) {
        errors.push(`Linha ${r + 1}: turno não reconhecido "${shiftRaw}".`);
        continue;
      }

      records.push({
        date,
        shift,
        money: moneyCol >= 0 ? num(row[moneyCol]) : 0,
        cv: cvCol >= 0 ? num(row[cvCol]) : 0,
        mb: mbCol >= 0 ? num(row[mbCol]) : 0,
        city_mb: cityMbCol >= 0 ? num(row[cityMbCol]) : 0,
      });
    }

    if (records.length > 0) break;
  }

  if (records.length === 0 && errors.length === 0) {
    errors.push("Nenhum registo válido encontrado no ficheiro.");
  }

  return { records, errors, sheetName };
}
