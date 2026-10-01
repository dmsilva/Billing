import { getDb } from "@/lib/db";

export interface AuditEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export function ensureAuditTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

export function logAudit(entry: {
  userId?: number | null;
  username?: string | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
}) {
  ensureAuditTable();
  getDb().prepare(`
    INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, field_name, old_value, new_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.userId ?? null,
    entry.username ?? null,
    entry.action,
    entry.entityType,
    entry.entityId ?? null,
    entry.fieldName ?? null,
    entry.oldValue ?? null,
    entry.newValue ?? null,
  );
}

export function getAuditLog(limit = 100): AuditEntry[] {
  ensureAuditTable();
  return getDb().prepare(
    "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as AuditEntry[];
}
