import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dbPath = join(root, "prisma", "faturaclaro.db");

const data = JSON.parse(readFileSync(join(root, "scripts", "legacy-data.json"), "utf-8"));
const { DATA, ITEMS, CASH_INVOICES, ALL_CASH_DATA } = data;

// Delete existing DB and create fresh
import { unlinkSync, existsSync } from "fs";
if (existsSync(dbPath)) unlinkSync(dbPath);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create tables
db.exec(`
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES categories(id),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    raw_descriptions TEXT,
    is_salary_group INTEGER DEFAULT 0,
    is_financing_group INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE bank_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data_mov TEXT NOT NULL,
    data_valor TEXT,
    descricao TEXT NOT NULL,
    valor REAL NOT NULL,
    saldo REAL,
    category_id INTEGER REFERENCES categories(id),
    property_id INTEGER REFERENCES properties(id),
    payment_source TEXT DEFAULT 'CGD',
    is_expense INTEGER DEFAULT 1,
    is_company_transfer INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name TEXT,
    property_id INTEGER REFERENCES properties(id),
    payment_source TEXT NOT NULL,
    invoice_number TEXT,
    invoice_date TEXT,
    description TEXT,
    subtotal REAL,
    vat_amount REAL,
    total REAL NOT NULL,
    category_name TEXT,
    vat_status TEXT DEFAULT 'pending',
    validation_status TEXT DEFAULT 'Por validar',
    submitted_by TEXT,
    validated_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit TEXT,
    quantity REAL,
    total_spent REAL,
    category_name TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE cash_closes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    shift TEXT NOT NULL,
    money REAL DEFAULT 0,
    cv REAL DEFAULT 0,
    mb REAL DEFAULT 0,
    city_mb REAL DEFAULT 0,
    guest_records INTEGER,
    source TEXT DEFAULT 'import',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(date, shift)
  );
  CREATE TABLE cash_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cash_close_id INTEGER REFERENCES cash_closes(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    expected_value REAL NOT NULL,
    actual_value REAL,
    difference REAL,
    status TEXT DEFAULT 'Por conferir',
    checked_by TEXT,
    checked_at TEXT,
    UNIQUE(cash_close_id, type)
  );
  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    previous_value TEXT,
    new_value TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed properties
const insertProperty = db.prepare("INSERT INTO properties (name) VALUES (?)");
insertProperty.run("Chalet D'Ávila");
insertProperty.run("Chalet do Lago");
console.log("Properties: 2");

// Collect and seed categories
const categorySet = new Set();
DATA.transactions.forEach(t => categorySet.add(t.categoria));
CASH_INVOICES.forEach(t => categorySet.add(t.categoria));
ITEMS.forEach(t => categorySet.add(t.tipo));

const insertCategory = db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
const insertCatMany = db.transaction((cats) => {
  for (const c of cats) insertCategory.run(c);
});
insertCatMany([...categorySet]);
console.log(`Categories: ${categorySet.size}`);

// Build category lookup
const catLookup = {};
db.prepare("SELECT id, name FROM categories").all().forEach(r => { catLookup[r.name] = r.id; });

// Property lookup
const propLookup = {};
db.prepare("SELECT id, name FROM properties").all().forEach(r => { propLookup[r.name] = r.id; });

// Seed bank transactions
const insertTx = db.prepare(`
  INSERT INTO bank_transactions (data_mov, data_valor, descricao, valor, saldo, category_id, property_id, payment_source, is_expense, is_company_transfer)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'CGD', ?, ?)
`);

const insertTxMany = db.transaction((txs) => {
  for (const t of txs) {
    const isTransfer = t.categoria === "Transferência — empresa" ? 1 : 0;
    const isExpense = isTransfer ? 0 : 1;
    insertTx.run(
      t.data_mov,
      t.data_valor,
      t.descricao,
      t.valor,
      t.saldo,
      catLookup[t.categoria] || null,
      propLookup[t.imovel] || null,
      isExpense,
      isTransfer
    );
  }
});
insertTxMany(DATA.transactions);
console.log(`Bank transactions: ${DATA.transactions.length}`);

// Verify bank total
const bankSum = db.prepare("SELECT SUM(valor) as total FROM bank_transactions").get();
console.log(`Bank total: €${bankSum.total.toFixed(2)} (expected €${DATA.total_out})`);
if (Math.abs(bankSum.total - DATA.total_out) > 0.02) {
  throw new Error("Bank total mismatch!");
}

// Seed cash invoices
const insertInv = db.prepare(`
  INSERT INTO invoices (supplier_name, property_id, payment_source, invoice_number, invoice_date, description, total, category_name)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertInvMany = db.transaction((invs) => {
  for (const inv of invs) {
    insertInv.run(
      inv.fornecedor,
      propLookup[inv.imovel] || null,
      inv.pagamento,
      inv.documento || null,
      inv.data,
      inv.descricao,
      inv.valor,
      inv.categoria
    );
  }
});
insertInvMany(CASH_INVOICES);
console.log(`Cash invoices: ${CASH_INVOICES.length}`);

// Seed products
const insertProd = db.prepare(`
  INSERT INTO products (name, unit, quantity, total_spent, category_name, notes)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertProdMany = db.transaction((items) => {
  for (const item of items) {
    insertProd.run(
      item.item,
      item.unidade || null,
      item.quantidade,
      item.gasto,
      item.tipo,
      item.observacao || null
    );
  }
});
insertProdMany(ITEMS);
console.log(`Products: ${ITEMS.length}`);

// Seed cash closes
const insertClose = db.prepare(`
  INSERT INTO cash_closes (date, shift, money, cv, mb, city_mb, source)
  VALUES (?, ?, ?, ?, ?, ?, 'legacy')
`);
const insertCloseMany = db.transaction((closes) => {
  for (const c of closes) {
    insertClose.run(c.date, c.shift, c.money, c.cv, c.mb, c.cityMB);
  }
});
insertCloseMany(ALL_CASH_DATA);
console.log(`Cash closes: ${ALL_CASH_DATA.length}`);

// Verify cash close count
const closeCount = db.prepare("SELECT COUNT(*) as cnt FROM cash_closes").get();
if (closeCount.cnt !== 819) {
  throw new Error(`Expected 819 cash closes, got ${closeCount.cnt}`);
}

// Verify spot check
const spot = db.prepare("SELECT * FROM cash_closes WHERE date = '2026-07-02' AND shift = '23h'").get();
if (Math.abs(spot.money - 251.95) > 0.01 || Math.abs(spot.cv - 1192.18) > 0.01) {
  throw new Error("Spot check failed!");
}

// Verify Jan 1 7h
const jan1 = db.prepare("SELECT * FROM cash_closes WHERE date = '2026-01-01' AND shift = '7h'").get();
if (Math.abs(jan1.money - 16) > 0.01 || Math.abs(jan1.cv - 210.68) > 0.01 || Math.abs(jan1.mb - 262) > 0.01) {
  throw new Error("Jan 1 7h check failed!");
}

console.log("\nAll verifications passed!");
console.log("Database seeded at:", dbPath);

db.close();
