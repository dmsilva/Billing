-- =====================================================================
-- FaturaClaro — 10 Histórico dos ficheiros de ordenados enviados à contabilidade
-- Executar depois do 01 e 02 (pode ser executado mais do que uma vez).
--
-- Cada vez que se descarrega o ficheiro para a contabilidade (página "Ordenados") fica aqui
-- uma cópia do Excel e do PDF, com o resumo por funcionário, para voltar a descarregar.
-- Só a administração vê.
-- =====================================================================

create table if not exists public.ordenados_envios (
  id bigint generated always as identity primary key,
  mes text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- AAAA-MM do horário
  nome_ficheiro text not null,
  linhas jsonb not null default '[]'::jsonb,                    -- [{ codigo, nome, feriados, noites, ferias, nota }]
  excel_base64 text,
  pdf_base64 text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists ordenados_envios_mes on public.ordenados_envios (mes);

alter table public.ordenados_envios enable row level security;
drop policy if exists "admin_all" on public.ordenados_envios;
create policy "admin_all" on public.ordenados_envios for all to authenticated using (public.is_admin()) with check (public.is_admin());
