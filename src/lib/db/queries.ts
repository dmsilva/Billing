import { getDb, type CashClose, type CashCheck, type BankTransaction, type Invoice, type Product, type Category } from ".";

// ─── Cash Closes ────────────────────────────────────────────────────────────

export function getAllCashCloses(): CashClose[] {
  return getDb().prepare("SELECT * FROM cash_closes ORDER BY date, CASE shift WHEN '7h' THEN 1 WHEN '15h' THEN 2 WHEN '23h' THEN 3 END").all() as CashClose[];
}

export function getCashClosesByMonth(month: string): CashClose[] {
  return getDb().prepare("SELECT * FROM cash_closes WHERE date LIKE ? ORDER BY date, CASE shift WHEN '7h' THEN 1 WHEN '15h' THEN 2 WHEN '23h' THEN 3 END").all(`${month}%`) as CashClose[];
}

export function getCashCloseById(id: number): CashClose | undefined {
  return getDb().prepare("SELECT * FROM cash_closes WHERE id = ?").get(id) as CashClose | undefined;
}

// ─── Cash Checks (Reconciliation) ───────────────────────────────────────────

export function getCashChecksByCloseId(closeId: number): CashCheck[] {
  return getDb().prepare("SELECT * FROM cash_checks WHERE cash_close_id = ?").all(closeId) as CashCheck[];
}

export function getAllCashChecks(): CashCheck[] {
  return getDb().prepare("SELECT * FROM cash_checks").all() as CashCheck[];
}

export function upsertCashCheck(
  cashCloseId: number,
  type: string,
  expectedValue: number,
  actualValue: number,
  checkedBy?: string
): CashCheck {
  const db = getDb();
  const diff = actualValue - expectedValue;
  const status = Math.abs(diff) < 0.01 ? "Conferido" : "Diferença";
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO cash_checks (cash_close_id, type, expected_value, actual_value, difference, status, checked_by, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cash_close_id, type) DO UPDATE SET
      actual_value = excluded.actual_value,
      difference = excluded.difference,
      status = excluded.status,
      checked_by = excluded.checked_by,
      checked_at = excluded.checked_at
  `).run(cashCloseId, type, expectedValue, actualValue, diff, status, checkedBy || null, now);

  return db.prepare("SELECT * FROM cash_checks WHERE cash_close_id = ? AND type = ?").get(cashCloseId, type) as CashCheck;
}

export function clearAllCashChecks(): void {
  getDb().prepare("DELETE FROM cash_checks").run();
}

// ─── Reconciliation stats ───────────────────────────────────────────────────

export function getReconciliationStats() {
  const db = getDb();
  const totalCloses = (db.prepare("SELECT COUNT(*) as cnt FROM cash_closes").get() as { cnt: number }).cnt;
  const totalChecks = totalCloses * 3;
  const doneChecks = (db.prepare("SELECT COUNT(*) as cnt FROM cash_checks WHERE status != 'Por conferir'").get() as { cnt: number }).cnt;
  const okChecks = (db.prepare("SELECT COUNT(*) as cnt FROM cash_checks WHERE status = 'Conferido'").get() as { cnt: number }).cnt;
  const diffChecks = (db.prepare("SELECT COUNT(*) as cnt FROM cash_checks WHERE status = 'Diferença'").get() as { cnt: number }).cnt;

  return { totalCloses, totalChecks, doneChecks, okChecks, diffChecks };
}

// ─── Bank Transactions ──────────────────────────────────────────────────────

export function getAllBankTransactions(): BankTransaction[] {
  return getDb().prepare("SELECT * FROM bank_transactions ORDER BY data_mov").all() as BankTransaction[];
}

export function getBankTransactionsByMonth(month: string): BankTransaction[] {
  return getDb().prepare("SELECT * FROM bank_transactions WHERE data_mov LIKE ? ORDER BY data_mov").all(`${month}%`) as BankTransaction[];
}

// ─── Invoices ───────────────────────────────────────────────────────────────

export function getAllInvoices(): Invoice[] {
  return getDb().prepare("SELECT * FROM invoices ORDER BY invoice_date DESC").all() as Invoice[];
}

// ─── Products ───────────────────────────────────────────────────────────────

export function getAllProducts(): Product[] {
  return getDb().prepare("SELECT * FROM products ORDER BY total_spent DESC").all() as Product[];
}

// ─── Categories ─────────────────────────────────────────────────────────────

export function getAllCategories(): Category[] {
  return getDb().prepare("SELECT * FROM categories ORDER BY name").all() as Category[];
}

export function updateTransactionCategory(txId: number, categoryId: number | null): void {
  getDb().prepare("UPDATE bank_transactions SET category_id = ? WHERE id = ?").run(categoryId, txId);
}

export function updateTransactionProperty(txId: number, propertyId: number | null): void {
  getDb().prepare("UPDATE bank_transactions SET property_id = ? WHERE id = ?").run(propertyId, txId);
}

export function getBankTransactionById(id: number): BankTransaction | undefined {
  return getDb().prepare("SELECT * FROM bank_transactions WHERE id = ?").get(id) as BankTransaction | undefined;
}

export function createCategory(name: string): number {
  const result = getDb().prepare("INSERT INTO categories (name, is_active) VALUES (?, 1)").run(name);
  return Number(result.lastInsertRowid);
}

export function updateCategoryName(id: number, name: string): void {
  getDb().prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, id);
}

export function toggleCategoryActive(id: number, isActive: boolean): void {
  getDb().prepare("UPDATE categories SET is_active = ? WHERE id = ?").run(isActive ? 1 : 0, id);
}

// ─── Lookups ────────────────────────────────────────────────────────────────

export function getCategoryLookup(): Map<number, string> {
  const rows = getDb().prepare("SELECT id, name FROM categories").all() as { id: number; name: string }[];
  return new Map(rows.map(r => [r.id, r.name]));
}

export function getPropertyLookup(): Map<number, string> {
  const rows = getDb().prepare("SELECT id, name FROM properties").all() as { id: number; name: string }[];
  return new Map(rows.map(r => [r.id, r.name]));
}

// ─── Invoice creation ──────────────────────────────────────────────────────

export function createInvoice(data: {
  supplier_name: string;
  property_id: number | null;
  payment_source: string;
  invoice_number: string | null;
  invoice_date: string | null;
  description: string | null;
  total: number;
  category_name: string | null;
  validation_status: string;
  submitted_by: string | null;
}): number {
  const result = getDb().prepare(`
    INSERT INTO invoices (supplier_name, property_id, payment_source, invoice_number, invoice_date, description, total, category_name, validation_status, submitted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.supplier_name,
    data.property_id,
    data.payment_source,
    data.invoice_number,
    data.invoice_date,
    data.description,
    data.total,
    data.category_name,
    data.validation_status,
    data.submitted_by,
  );
  return Number(result.lastInsertRowid);
}

export function updateInvoiceStatus(id: number, status: string, validatedBy?: string): void {
  getDb().prepare(`
    UPDATE invoices SET validation_status = ?, validated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, validatedBy || null, id);
}

export function getInvoiceById(id: number): Invoice | undefined {
  return getDb().prepare("SELECT * FROM invoices WHERE id = ?").get(id) as Invoice | undefined;
}

// ─── Cash Summary ───────────────────────────────────────────────────────────

export function getCashSummary(month?: string) {
  const db = getDb();
  const where = month ? "WHERE date LIKE ?" : "";
  const params = month ? [`${month}%`] : [];

  const row = db.prepare(`
    SELECT
      COUNT(DISTINCT date) as days,
      SUM(money) as total_money,
      SUM(cv) as total_cv,
      SUM(mb) as total_mb,
      SUM(city_mb) as total_city_mb,
      COUNT(*) as total_closes
    FROM cash_closes ${where}
  `).get(...params) as {
    days: number;
    total_money: number;
    total_cv: number;
    total_mb: number;
    total_city_mb: number;
    total_closes: number;
  };

  return row;
}
