import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FaturaClaro — Controlo de Despesas",
  description: "Gestão financeira para alojamento turístico",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
