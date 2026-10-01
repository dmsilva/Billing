import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "prisma", "faturaclaro.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
  }
  return _db;
}

export function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      raw_descriptions TEXT,
      is_salary_group INTEGER DEFAULT 0,
      is_financing_group INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER REFERENCES categories(id),
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS classification_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT DEFAULT 'contains',
      category_id INTEGER REFERENCES categories(id),
      supplier_id INTEGER REFERENCES suppliers(id),
      property_id INTEGER REFERENCES properties(id),
      priority INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS bank_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_mov TEXT NOT NULL,
      data_valor TEXT,
      descricao TEXT NOT NULL,
      valor REAL NOT NULL,
      saldo REAL,
      category_id INTEGER REFERENCES categories(id),
      supplier_id INTEGER REFERENCES suppliers(id),
      property_id INTEGER REFERENCES properties(id),
      payment_source TEXT DEFAULT 'CGD',
      is_expense INTEGER DEFAULT 1,
      is_company_transfer INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER REFERENCES suppliers(id),
      property_id INTEGER REFERENCES properties(id),
      payment_source TEXT NOT NULL,
      invoice_number TEXT,
      invoice_date TEXT,
      description TEXT,
      subtotal REAL,
      vat_amount REAL,
      total REAL NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      vat_status TEXT DEFAULT 'pending',
      validation_status TEXT DEFAULT 'Por validar',
      submitted_by TEXT,
      validated_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
      storage_path TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      mime_type TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      description TEXT,
      quantity REAL,
      unit_price REAL,
      vat_rate REAL,
      vat_amount REAL,
      total REAL,
      category_id INTEGER REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      unit TEXT,
      category_id INTEGER REFERENCES categories(id),
      is_breakfast INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cash_closes (
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

    CREATE TABLE IF NOT EXISTS cash_checks (
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

    CREATE TABLE IF NOT EXISTS audit_logs (
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

  return db;
}
