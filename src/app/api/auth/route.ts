import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials, createSession, deleteSession } from "@/lib/auth";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Utilizador e password obrigatórios." }, { status: 400 });
  }

  const user = verifyCredentials(username, password);
  if (!user) {
    return NextResponse.json({ error: "Credenciais inválidas." }, { status: 401 });
  }

  const sessionId = createSession(user.id);
  const cookieStore = await cookies();
  cookieStore.set("session", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  return NextResponse.json({ ok: true, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } });
}

export async function DELETE() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;
  if (sessionId) {
    deleteSession(sessionId);
    cookieStore.delete("session");
  }
  return NextResponse.json({ ok: true });
}
