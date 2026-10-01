import { describe, it, expect } from "vitest";
import {
  isSalaryTransaction,
  isFinancingTransaction,
  groupSuppliers,
  groupByCategory,
  computeMonthlyTotals,
  computePropertySummary,
} from "@/lib/domain/classification";
import type { BankTransaction } from "@/lib/db";

function makeTx(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: 1,
    data_mov: "2026-07-15",
    data_valor: "2026-07-15",
    descricao: "SOME TRANSACTION",
    valor: 100,
    saldo: null,
    category_id: 1,
    property_id: 1,
    payment_source: "CGD",
    is_expense: 1,
    is_company_transfer: 0,
    notes: null,
    ...overrides,
  };
}

describe("isSalaryTransaction", () => {
  it("detects ORDENADO", () => {
    expect(isSalaryTransaction(makeTx({ descricao: "TRANSF ORDENADO JOANA" }), "")).toBe(true);
  });

  it("detects ORDENADOS", () => {
    expect(isSalaryTransaction(makeTx({ descricao: "ORDENADOS JUNHO" }), "")).toBe(true);
  });

  it("detects SALÁRIO", () => {
    expect(isSalaryTransaction(makeTx({ descricao: "SALÁRIO COLABORADORES" }), "")).toBe(true);
  });

  it("detects via category name", () => {
    expect(isSalaryTransaction(makeTx({ descricao: "some payment" }), "Salários")).toBe(true);
  });

  it("rejects non-salary", () => {
    expect(isSalaryTransaction(makeTx({ descricao: "PINGO DOCE COMPRAS" }), "Alimentação")).toBe(false);
  });
});

describe("isFinancingTransaction", () => {
  it("detects COBRANCA PRESTACAO", () => {
    expect(isFinancingTransaction(makeTx({ descricao: "COBRANCA PRESTACAO LEASE" }), "")).toBe(true);
  });

  it("detects PRESTAÇÃO", () => {
    expect(isFinancingTransaction(makeTx({ descricao: "PRESTAÇÃO MENSAL AUTO" }), "")).toBe(true);
  });

  it("detects via category name", () => {
    expect(isFinancingTransaction(makeTx({ descricao: "random" }), "Prestações / financiamento")).toBe(true);
  });

  it("rejects non-financing", () => {
    expect(isFinancingTransaction(makeTx({ descricao: "SUPERMERCADO" }), "Alimentação")).toBe(false);
  });
});

describe("groupSuppliers", () => {
  it("groups salary transactions under single entry", () => {
    const txs = [
      makeTx({ id: 1, descricao: "ORDENADO JOANA", valor: 1000, category_id: 10 }),
      makeTx({ id: 2, descricao: "ORDENADO PEDRO", valor: 1200, category_id: 10 }),
      makeTx({ id: 3, descricao: "PINGO DOCE", valor: 50, category_id: 5 }),
    ];
    const catLookup = new Map([[10, "Salários"], [5, "Alimentação"]]);
    const result = groupSuppliers(txs, catLookup);

    const salaryGroup = result.find(g => g.name === "Salários (total)");
    expect(salaryGroup).toBeDefined();
    expect(salaryGroup!.total).toBe(2200);
    expect(salaryGroup!.count).toBe(2);
  });

  it("excludes company transfers", () => {
    const txs = [
      makeTx({ id: 1, descricao: "TRANSFER EMPRESA", valor: 5000, is_company_transfer: 1 }),
      makeTx({ id: 2, descricao: "PINGO DOCE", valor: 50, category_id: 5 }),
    ];
    const catLookup = new Map([[5, "Alimentação"]]);
    const result = groupSuppliers(txs, catLookup);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("PINGO DOCE");
  });
});

describe("groupByCategory", () => {
  it("merges CGD and Numerário into same category", () => {
    const txs = [makeTx({ valor: 100, category_id: 5 })];
    const invoices = [{ category_name: "Alimentação", total: 50 }];
    const catLookup = new Map([[5, "Alimentação"]]);

    const result = groupByCategory(txs, invoices, catLookup);
    const cat = result.find(c => c.name === "Alimentação");

    expect(cat).toBeDefined();
    expect(cat!.cgd).toBe(100);
    expect(cat!.numerario).toBe(50);
    expect(cat!.total).toBe(150);
  });

  it("excludes company transfers from categories", () => {
    const txs = [
      makeTx({ valor: 100, category_id: 5 }),
      makeTx({ valor: 5000, category_id: 5, is_company_transfer: 1, id: 2 }),
    ];
    const catLookup = new Map([[5, "Alimentação"]]);

    const result = groupByCategory(txs, [], catLookup);
    const cat = result.find(c => c.name === "Alimentação");

    expect(cat!.cgd).toBe(100);
  });
});

describe("computeMonthlyTotals", () => {
  it("aggregates by month", () => {
    const txs = [
      makeTx({ data_mov: "2026-07-01", valor: 100, id: 1 }),
      makeTx({ data_mov: "2026-07-15", valor: 200, id: 2 }),
      makeTx({ data_mov: "2026-08-01", valor: 300, id: 3 }),
    ];

    const result = computeMonthlyTotals(txs, []);
    expect(result).toHaveLength(2);

    const jul = result.find(m => m.month === "2026-07");
    expect(jul!.cgd).toBe(300);
    expect(jul!.label).toBe("Jul");
  });
});

describe("computePropertySummary", () => {
  it("groups by property", () => {
    const txs = [
      makeTx({ property_id: 1, valor: 100, id: 1 }),
      makeTx({ property_id: 2, valor: 200, id: 2 }),
    ];
    const propLookup = new Map([[1, "Chalet D'Ávila"], [2, "Chalet do Lago"]]);

    const result = computePropertySummary(txs, [], propLookup);
    expect(result).toHaveLength(2);

    const lago = result.find(p => p.name === "Chalet do Lago");
    expect(lago!.cgd).toBe(200);
  });
});
