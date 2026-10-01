import { NextRequest, NextResponse } from "next/server";
import { parseCashExcel } from "@/lib/domain/cash-import";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const action = formData.get("action") as string;

    if (!file) {
      return NextResponse.json({ error: "Ficheiro não enviado." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const result = parseCashExcel(buffer);

    if (action === "preview") {
      return NextResponse.json({
        records: result.records,
        errors: result.errors,
        sheetName: result.sheetName,
        count: result.records.length,
      });
    }

    if (action === "import") {
      if (result.records.length === 0) {
        return NextResponse.json({ error: "Nenhum registo para importar." }, { status: 400 });
      }

      const db = getDb();
      const insert = db.prepare(`
        INSERT OR REPLACE INTO cash_closes (date, shift, money, cv, mb, city_mb, source)
        VALUES (?, ?, ?, ?, ?, ?, 'excel_import')
      `);

      const tx = db.transaction(() => {
        for (const r of result.records) {
          insert.run(r.date, r.shift, r.money, r.cv, r.mb, r.city_mb);
        }
      });
      tx();

      logAudit({
        action: "import_cash",
        entityType: "cash_closes",
        newValue: `${result.records.length} registos importados de "${file.name}"`,
      });

      return NextResponse.json({
        ok: true,
        imported: result.records.length,
        errors: result.errors,
      });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro ao processar ficheiro.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
