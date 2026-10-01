import { getDb } from "@/lib/db";
import crypto from "crypto";
import { cookies } from "next/headers";

export type Role = "admin" | "reception";

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
}

export interface Session {
  id: string;
  user_id: number;
  expires_at: string;
}

export function ensureAuthTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'reception',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const count = (db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number }).cnt;
  if (count === 0) {
    createUser("admin", "admin", "Administrador", "admin");
    createUser("rececao", "rececao", "Receção", "reception");
  }
}

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function createUser(username: string, password: string, displayName: string, role: Role): number {
  const hash = hashPassword(password);
  const result = getDb().prepare(
    "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)"
  ).run(username, hash, displayName, role);
  return Number(result.lastInsertRowid);
}

export function verifyCredentials(username: string, password: string): User | null {
  ensureAuthTables();
  const hash = hashPassword(password);
  const user = getDb().prepare(
    "SELECT id, username, display_name, role FROM users WHERE username = ? AND password_hash = ? AND is_active = 1"
  ).get(username, hash) as User | undefined;
  return user || null;
}

export function createSession(userId: number): string {
  ensureAuthTables();
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(id, userId, expires);
  return id;
}

export function deleteSession(sessionId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function getSessionUser(sessionId: string): User | null {
  ensureAuthTables();
  const row = getDb().prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = 1
  `).get(sessionId) as User | undefined;
  return row || null;
}

export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;
  if (!sessionId) return null;
  return getSessionUser(sessionId);
}

export async function requireUser(allowedRoles?: Role[]): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("not_authenticated");
  if (allowedRoles && !allowedRoles.includes(user.role)) throw new AuthError("not_authorized");
  return user;
}

export class AuthError extends Error {
  constructor(public code: "not_authenticated" | "not_authorized") {
    super(code === "not_authenticated" ? "Login necessário" : "Sem permissão");
  }
}
