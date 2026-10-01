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

export interface CashClose {
  id: number;
  date: string;
  shift: string;
  money: number;
  cv: number;
  mb: number;
  city_mb: number;
  guest_records: number | null;
  source: string;
}

export interface CashCheck {
  id: number;
  cash_close_id: number;
  type: string;
  expected_value: number;
  actual_value: number | null;
  difference: number | null;
  status: string;
  checked_by: string | null;
  checked_at: string | null;
}

export interface BankTransaction {
  id: number;
  data_mov: string;
  data_valor: string;
  descricao: string;
  valor: number;
  saldo: number | null;
  category_id: number | null;
  property_id: number | null;
  payment_source: string;
  is_expense: number;
  is_company_transfer: number;
  notes: string | null;
}

export interface Invoice {
  id: number;
  supplier_name: string | null;
  property_id: number | null;
  payment_source: string;
  invoice_number: string | null;
  invoice_date: string | null;
  description: string | null;
  total: number;
  category_name: string | null;
  validation_status: string;
  submitted_by: string | null;
}

export interface Product {
  id: number;
  name: string;
  unit: string | null;
  quantity: number | null;
  total_spent: number | null;
  category_name: string | null;
  notes: string | null;
}

export interface Category {
  id: number;
  name: string;
  is_active: number;
}
