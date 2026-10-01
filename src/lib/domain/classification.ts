import type { BankTransaction } from "@/lib/db";

const SALARY_RE = /\bORDEN(?:ADO|ADOS|AR|OS)?\b|\bORDE\b|\bSAL[ÁA]RIO(?:S)?\b/i;
const FINANCING_RE = /COBRANCA\s+PRESTACAO|PRESTA[CÇ][AÃ]O/i;

export function isSalaryTransaction(t: BankTransaction, categoryName: string): boolean {
  return categoryName === "Salários" || SALARY_RE.test(t.descricao);
}

export function isFinancingTransaction(t: BankTransaction, categoryName: string): boolean {
  return categoryName === "Prestações / financiamento" || FINANCING_RE.test(t.descricao);
}

export interface SupplierGroup {
  name: string;
  category: string;
  total: number;
  count: number;
}

export function groupSuppliers(
  txs: BankTransaction[],
  categoryLookup: Map<number, string>
): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();

  for (const t of txs) {
    if (t.is_company_transfer) continue;
    const cat = categoryLookup.get(t.category_id ?? -1) || "Por classificar";
    let key: string;
    let displayName: string;

    if (isSalaryTransaction(t, cat)) {
      key = "__salarios__";
      displayName = "Salários (total)";
    } else if (isFinancingTransaction(t, cat)) {
      key = "__financiamentos__";
      displayName = "Financiamentos (total)";
    } else if (/^Rendas\b/.test(t.descricao)) {
      key = "__rendas__";
      displayName = "Rendas";
    } else {
      key = t.descricao;
      displayName = t.descricao;
    }

    const existing = groups.get(key);
    if (existing) {
      existing.total += t.valor;
      existing.count++;
    } else {
      groups.set(key, { name: displayName, category: cat, total: t.valor, count: 1 });
    }
  }

  return [...groups.values()].sort((a, b) => b.total - a.total);
}

export interface CategoryTotal {
  name: string;
  cgd: number;
  numerario: number;
  total: number;
}

export function groupByCategory(
  bankTxs: BankTransaction[],
  cashInvoices: { category_name: string | null; total: number }[],
  categoryLookup: Map<number, string>
): CategoryTotal[] {
  const cats = new Map<string, CategoryTotal>();

  for (const t of bankTxs) {
    if (t.is_company_transfer) continue;
    let cat = categoryLookup.get(t.category_id ?? -1) || "Por classificar";
    if (isSalaryTransaction(t, cat)) cat = "Salários";
    if (isFinancingTransaction(t, cat)) cat = "Financiamentos";

    const existing = cats.get(cat);
    if (existing) {
      existing.cgd += t.valor;
      existing.total += t.valor;
    } else {
      cats.set(cat, { name: cat, cgd: t.valor, numerario: 0, total: t.valor });
    }
  }

  for (const inv of cashInvoices) {
    const cat = inv.category_name || "Por classificar";
    const existing = cats.get(cat);
    if (existing) {
      existing.numerario += inv.total;
      existing.total += inv.total;
    } else {
      cats.set(cat, { name: cat, cgd: 0, numerario: inv.total, total: inv.total });
    }
  }

  return [...cats.values()].sort((a, b) => b.total - a.total);
}

export interface MonthlyTotal {
  month: string;
  label: string;
  cgd: number;
  numerario: number;
  total: number;
}

const MONTH_NAMES: Record<string, string> = {
  "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr",
  "05": "Mai", "06": "Jun", "07": "Jul", "08": "Ago",
  "09": "Set", "10": "Out", "11": "Nov", "12": "Dez",
};

const MONTH_NAMES_FULL: Record<string, string> = {
  "01": "Janeiro", "02": "Fevereiro", "03": "Março", "04": "Abril",
  "05": "Maio", "06": "Junho", "07": "Julho", "08": "Agosto",
  "09": "Setembro", "10": "Outubro", "11": "Novembro", "12": "Dezembro",
};

export function monthShortLabel(monthKey: string): string {
  return MONTH_NAMES[monthKey.slice(5, 7)] || monthKey;
}

export function monthFullLabel(monthKey: string): string {
  const m = monthKey.slice(5, 7);
  const y = monthKey.slice(0, 4);
  return `${MONTH_NAMES_FULL[m] || m} ${y}`;
}

export function computeMonthlyTotals(
  bankTxs: BankTransaction[],
  cashInvoices: { invoice_date: string | null; total: number }[],
): MonthlyTotal[] {
  const months = new Map<string, MonthlyTotal>();

  for (const t of bankTxs) {
    if (t.is_company_transfer) continue;
    const key = t.data_mov.slice(0, 7);
    const existing = months.get(key);
    if (existing) {
      existing.cgd += t.valor;
      existing.total += t.valor;
    } else {
      months.set(key, { month: key, label: monthShortLabel(key), cgd: t.valor, numerario: 0, total: t.valor });
    }
  }

  for (const inv of cashInvoices) {
    const key = (inv.invoice_date || "").slice(0, 7);
    if (!key) continue;
    const existing = months.get(key);
    if (existing) {
      existing.numerario += inv.total;
      existing.total += inv.total;
    } else {
      months.set(key, { month: key, label: monthShortLabel(key), cgd: 0, numerario: inv.total, total: inv.total });
    }
  }

  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface PropertySummary {
  name: string;
  cgd: number;
  numerario: number;
  total: number;
}

export function computePropertySummary(
  bankTxs: BankTransaction[],
  cashInvoices: { property_id: number | null; total: number }[],
  propertyLookup: Map<number, string>
): PropertySummary[] {
  const props = new Map<string, PropertySummary>();

  for (const t of bankTxs) {
    if (t.is_company_transfer) continue;
    const name = propertyLookup.get(t.property_id ?? -1) || "Sem imóvel";
    const existing = props.get(name);
    if (existing) {
      existing.cgd += t.valor;
      existing.total += t.valor;
    } else {
      props.set(name, { name, cgd: t.valor, numerario: 0, total: t.valor });
    }
  }

  for (const inv of cashInvoices) {
    const name = propertyLookup.get(inv.property_id ?? -1) || "Sem imóvel";
    const existing = props.get(name);
    if (existing) {
      existing.numerario += inv.total;
      existing.total += inv.total;
    } else {
      props.set(name, { name, cgd: 0, numerario: inv.total, total: inv.total });
    }
  }

  return [...props.values()].sort((a, b) => b.total - a.total);
}
