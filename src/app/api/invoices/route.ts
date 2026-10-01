import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createInvoice } from "@/lib/db/queries";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

function ensureInvoiceFilesTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS invoice_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { fornecedor, data, imovel, pagamento, enviadoPor, documento, observacoes, files } = body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "Adiciona pelo menos uma foto ou PDF." }, { status: 400 });
    }

    if (!fornecedor) {
      return NextResponse.json({ error: "Indica o fornecedor." }, { status: 400 });
    }

    const propertyId = imovel === "Chalet do Lago" ? 2 : 1;

    const invoiceId = createInvoice({
      supplier_name: fornecedor,
      property_id: propertyId,
      payment_source: pagamento || "Numerário",
      invoice_number: documento || null,
      invoice_date: data || null,
      description: observacoes || null,
      total: 0,
      category_name: null,
      validation_status: "Por validar",
      submitted_by: enviadoPor || null,
    });

    ensureInvoiceFilesTable();

    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const invoiceDir = path.join(UPLOADS_DIR, String(invoiceId));
    fs.mkdirSync(invoiceDir, { recursive: true });

    const db = getDb();
    const insertFile = db.prepare(`
      INSERT INTO invoice_files (invoice_id, filename, original_name, mime_type, size, path)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const file of files) {
      const { name, type, data: dataUrl } = file;
      const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64, "base64");
      const ext = path.extname(name) || (type.includes("pdf") ? ".pdf" : ".jpg");
      const filename = `${crypto.randomUUID()}${ext}`;
      const filePath = path.join(invoiceDir, filename);

      fs.writeFileSync(filePath, buffer);

      insertFile.run(
        invoiceId,
        filename,
        name,
        type,
        buffer.length,
        `uploads/${invoiceId}/${filename}`,
      );
    }

    return NextResponse.json({ ok: true, invoiceId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erro interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
