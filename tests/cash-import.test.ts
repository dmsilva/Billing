import { describe, it, expect } from "vitest";
import { parseCashExcel } from "@/lib/domain/cash-import";
import * as XLSX from "xlsx";

function makeExcelBuffer(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Caixa");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return buf;
}

describe("parseCashExcel", () => {
  it("parses valid data with all columns", () => {
    const buffer = makeExcelBuffer([
      ["Data", "Turno", "Dinheiro", "CV", "MB", "City MB"],
      ["2026-07-01", "7h", 150.50, 230.00, 412.75, 0],
      ["2026-07-01", "15h", 200.00, 180.50, 350.00, 25.00],
      ["2026-07-01", "23h", 100.00, 90.00, 200.00, 10.00],
    ]);

    const result = parseCashExcel(buffer);

    expect(result.records).toHaveLength(3);
    expect(result.errors).toHaveLength(0);

    expect(result.records[0].date).toBe("2026-07-01");
    expect(result.records[0].shift).toBe("7h");
    expect(result.records[0].money).toBe(150.50);
    expect(result.records[0].cv).toBe(230.00);

    expect(result.records[1].shift).toBe("15h");
    expect(result.records[2].shift).toBe("23h");
  });

  it("detects Fecho 7h / Fecho 15h / Fecho 23h format", () => {
    const buffer = makeExcelBuffer([
      ["Data", "Fecho", "Dinheiro", "CV", "MB", "City MB"],
      ["2026-07-02", "Fecho 7h", 50, 100, 200, 0],
      ["2026-07-02", "Fecho 15h", 75, 150, 300, 10],
    ]);

    const result = parseCashExcel(buffer);
    expect(result.records).toHaveLength(2);
    expect(result.records[0].shift).toBe("7h");
    expect(result.records[1].shift).toBe("15h");
  });

  it("reports error for unrecognized shift", () => {
    const buffer = makeExcelBuffer([
      ["Data", "Turno", "Dinheiro", "CV", "MB", "City MB"],
      ["2026-07-01", "12h", 100, 100, 100, 0],
    ]);

    const result = parseCashExcel(buffer);
    expect(result.records).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("12h");
  });

  it("reports error when no date column found", () => {
    const buffer = makeExcelBuffer([
      ["Turno", "Dinheiro", "CV"],
      ["7h", 100, 200],
    ]);

    const result = parseCashExcel(buffer);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("data");
  });

  it("skips empty rows", () => {
    const buffer = makeExcelBuffer([
      ["Data", "Turno", "Dinheiro", "CV", "MB", "City MB"],
      ["2026-07-01", "7h", 100, 200, 300, 0],
      [null, null, null, null, null, null],
      ["2026-07-02", "15h", 50, 100, 200, 0],
    ]);

    const result = parseCashExcel(buffer);
    expect(result.records).toHaveLength(2);
  });

  it("handles dd/mm/yyyy date format", () => {
    const buffer = makeExcelBuffer([
      ["Data", "Turno", "Dinheiro", "CV", "MB", "City MB"],
      ["01/07/2026", "7h", 100, 200, 300, 0],
    ]);

    const result = parseCashExcel(buffer);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].date).toBe("2026-07-01");
  });
});
