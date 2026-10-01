"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erro ao entrar.");
        return;
      }

      if (data.user.role === "reception") {
        router.push("/rececao");
      } else {
        router.push("/");
      }
    } catch {
      setError("Erro de ligação.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: "linear-gradient(135deg, #0a1630 0%, #162040 50%, #1a2850 100%)" }}>
      <form onSubmit={handleSubmit} className="w-full max-w-[380px] rounded-[22px] bg-white p-8 shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        <div className="mb-1 text-center text-[28px] font-[850] tracking-tight">
          Fatura<span className="text-[#3b63e8]">Claro</span>
        </div>
        <p className="mb-8 text-center text-[13px] text-[#667085]">Controlo de Despesas</p>

        <div className="mb-4">
          <label className="mb-1.5 block text-[13px] font-[700]">Utilizador</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            className="w-full rounded-[11px] border border-[#d9dde7] bg-white px-3.5 py-3 text-[14px] focus:border-[#3b63e8] focus:outline-none focus:ring-2 focus:ring-[#3b63e8]/20"
          />
        </div>

        <div className="mb-6">
          <label className="mb-1.5 block text-[13px] font-[700]">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-[11px] border border-[#d9dde7] bg-white px-3.5 py-3 text-[14px] focus:border-[#3b63e8] focus:outline-none focus:ring-2 focus:ring-[#3b63e8]/20"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-[10px] bg-[#fef3f2] px-3.5 py-2.5 text-[13px] text-[#b42318]">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-[12px] bg-gradient-to-r from-[#3154ad] to-[#3b63e8] px-4 py-3.5 text-[15px] font-[800] text-white shadow-[0_4px_14px_rgba(59,99,232,0.3)] disabled:opacity-55"
        >
          {loading ? "A entrar…" : "Entrar"}
        </button>

        <p className="mt-6 text-center text-[11px] text-[#98a2b3]">
          Acesso interno — contacta o administrador para credenciais.
        </p>
      </form>
    </div>
  );
}
