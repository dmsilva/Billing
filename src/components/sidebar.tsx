"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";

interface SidebarUser {
  display_name: string;
  role: string;
}

const NAV_SECTIONS = [
  {
    label: "GESTÃO",
    items: [
      { href: "/", label: "Visão geral", icon: "▦" },
    ],
  },
  {
    label: "ENTRADAS",
    items: [
      { href: "/caixa", label: "Caixa diária", icon: "▣" },
      { href: "/conferencia", label: "Conferência", icon: "✓" },
    ],
  },
  {
    label: "MOVIMENTOS",
    items: [
      { href: "/cgd", label: "CGD / Extrato", icon: "▤" },
      { href: "/faturas", label: "Faturas", icon: "▧" },
      { href: "/numerario", label: "Numerário", icon: "◉" },
      { href: "/recebidas", label: "Faturas recebidas", icon: "▥" },
    ],
  },
  {
    label: "ANÁLISE",
    items: [
      { href: "/produtos", label: "Produtos", icon: "◌" },
      { href: "/categorias", label: "Categorias", icon: "◈" },
      { href: "/analise", label: "Análise mensal", icon: "◐" },
    ],
  },
  {
    label: "GESTÃO",
    items: [
      { href: "/editar", label: "Editar categorias", icon: "⚙" },
    ],
  },
  {
    label: "DEFINIÇÕES",
    items: [
      { href: "/utilizadores", label: "Utilizadores", icon: "👤" },
      { href: "/configuracao", label: "Configuração", icon: "⛭" },
    ],
  },
];

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  }

  const nav = (
    <>
      <div className="px-4 pt-6 pb-5">
        <span className="text-[21px] font-[850] tracking-tight text-white">
          Fatura<span className="text-[#7ca0ff]">Claro</span>
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si}>
            <div className="px-3 pt-4 pb-2 text-[10px] font-[850] tracking-[0.12em] text-[#7187b4]">
              {section.label}
            </div>
            {section.items.map((item) => {
              const isActive = item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-[11px] px-3 py-[11px] text-[13px] font-[650] transition-all duration-150
                    ${isActive
                      ? "bg-gradient-to-r from-[#3154ad] to-[#294891] text-white shadow-[0_7px_18px_rgba(24,57,125,0.25)]"
                      : "text-[#cbd6f3] hover:bg-white/[0.07] hover:translate-x-[1px]"
                    }`}
                >
                  <span className="w-5 text-center">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-[700] text-white">{user.display_name}</div>
            <div className="text-[10px] text-[#7187b4]">{user.role === "admin" ? "Administrador" : "Receção"}</div>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-[700] text-[#cbd6f3] hover:bg-white/20"
          >
            Sair
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between px-4 lg:hidden"
        style={{ background: "linear-gradient(180deg, #0a1630 0%, #101f40 100%)" }}>
        <span className="text-[18px] font-[850] tracking-tight text-white">
          Fatura<span className="text-[#7ca0ff]">Claro</span>
        </span>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-white"
          aria-label="Menu"
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar — desktop: always visible; mobile: slide-over */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[246px] flex-col transition-transform duration-200
        lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "linear-gradient(180deg, #0a1630 0%, #101f40 100%)" }}>
        {nav}
      </aside>
    </>
  );
}
