import { describe, it, expect } from "vitest";
import {
  buildReconcileQueue,
  findNextPendingIndex,
  getExpectedValue,
  checkLabel,
  checkIcon,
  shiftLabel,
  shiftHours,
  formatDate,
  euro,
  euroShort,
  CHECK_TYPES,
} from "@/lib/domain/reconciliation";
import type { CashClose, CashCheck } from "@/lib/db";

function makeClose(overrides: Partial<CashClose> = {}): CashClose {
  return {
    id: 1,
    date: "2026-07-02",
    shift: "7h",
    money: 150.50,
    cv: 230.00,
    mb: 412.75,
    city_mb: 0,
    guest_records: null,
    source: "excel_import",
    ...overrides,
  };
}

describe("CHECK_TYPES", () => {
  it("has the correct order: cv, mb, money", () => {
    expect(CHECK_TYPES).toEqual(["cv", "mb", "money"]);
  });
});

describe("getExpectedValue", () => {
  it("returns cv value for cv type", () => {
    const close = makeClose({ cv: 230.00 });
    expect(getExpectedValue(close, "cv")).toBe(230.00);
  });

  it("returns mb value for mb type", () => {
    const close = makeClose({ mb: 412.75 });
    expect(getExpectedValue(close, "mb")).toBe(412.75);
  });

  it("returns money value for money type", () => {
    const close = makeClose({ money: 150.50 });
    expect(getExpectedValue(close, "money")).toBe(150.50);
  });
});

describe("checkLabel", () => {
  it("returns CV for cv", () => {
    expect(checkLabel("cv")).toBe("CV");
  });

  it("returns MB for mb", () => {
    expect(checkLabel("mb")).toBe("MB");
  });

  it("returns Numerário for money", () => {
    expect(checkLabel("money")).toBe("Numerário");
  });
});

describe("checkIcon", () => {
  it("returns card icon for cv", () => {
    expect(checkIcon("cv")).toBe("💳");
  });

  it("returns card icon for mb", () => {
    expect(checkIcon("mb")).toBe("💳");
  });

  it("returns money icon for money", () => {
    expect(checkIcon("money")).toBe("💶");
  });
});

describe("shiftLabel / shiftHours", () => {
  it("maps shifts correctly", () => {
    expect(shiftLabel("7h")).toBe("Noite");
    expect(shiftLabel("15h")).toBe("Manhã");
    expect(shiftLabel("23h")).toBe("Tarde");
  });

  it("maps shift hours correctly", () => {
    expect(shiftHours("7h")).toBe("23:00–07:00");
    expect(shiftHours("15h")).toBe("07:00–15:00");
    expect(shiftHours("23h")).toBe("15:00–23:00");
  });
});

describe("buildReconcileQueue", () => {
  it("creates 3 items per close (cv, mb, money)", () => {
    const closes = [makeClose()];
    const items = buildReconcileQueue(closes, []);

    expect(items).toHaveLength(3);
    expect(items[0].type).toBe("cv");
    expect(items[1].type).toBe("mb");
    expect(items[2].type).toBe("money");
  });

  it("marks items with existing checks", () => {
    const closes = [makeClose({ id: 1 })];
    const checks: CashCheck[] = [{
      id: 1,
      cash_close_id: 1,
      type: "cv",
      expected_value: 230,
      actual_value: 230,
      difference: 0,
      status: "Conferido",
      checked_by: null,
      checked_at: null,
    }];

    const items = buildReconcileQueue(closes, checks);
    expect(items[0].check).toBeDefined();
    expect(items[0].check!.status).toBe("Conferido");
    expect(items[1].check).toBeNull();
  });
});

describe("findNextPendingIndex", () => {
  it("returns 0 when nothing is checked", () => {
    const closes = [makeClose()];
    const items = buildReconcileQueue(closes, []);
    expect(findNextPendingIndex(items)).toBe(0);
  });

  it("returns correct index after some checks", () => {
    const closes = [makeClose({ id: 1 })];
    const checks: CashCheck[] = [
      { id: 1, cash_close_id: 1, type: "cv", expected_value: 230, actual_value: 230, difference: 0, status: "Conferido", checked_by: null, checked_at: null },
      { id: 2, cash_close_id: 1, type: "mb", expected_value: 412.75, actual_value: 412.75, difference: 0, status: "Conferido", checked_by: null, checked_at: null },
    ];

    const items = buildReconcileQueue(closes, checks);
    expect(findNextPendingIndex(items)).toBe(2);
  });

  it("returns last index when all checked", () => {
    const closes = [makeClose({ id: 1 })];
    const checks: CashCheck[] = [
      { id: 1, cash_close_id: 1, type: "cv", expected_value: 230, actual_value: 230, difference: 0, status: "Conferido", checked_by: null, checked_at: null },
      { id: 2, cash_close_id: 1, type: "mb", expected_value: 412.75, actual_value: 412.75, difference: 0, status: "Conferido", checked_by: null, checked_at: null },
      { id: 3, cash_close_id: 1, type: "money", expected_value: 150.5, actual_value: 150.5, difference: 0, status: "Conferido", checked_by: null, checked_at: null },
    ];

    const items = buildReconcileQueue(closes, checks);
    expect(findNextPendingIndex(items)).toBe(items.length - 1);
  });
});

describe("formatDate", () => {
  it("converts ISO to dd/mm/yyyy", () => {
    expect(formatDate("2026-07-02")).toBe("02/07/2026");
  });
});

describe("euro / euroShort", () => {
  it("formats currency correctly", () => {
    const result = euro(1234.56);
    expect(result).toContain("1");
    expect(result).toContain("234");
    expect(result).toContain("56");
    expect(result).toContain("€");
  });

  it("euroShort formats smaller values", () => {
    const result = euroShort(50);
    expect(result).toContain("50");
    expect(result).toContain("€");
  });
});
