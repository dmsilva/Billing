-- =====================================================================
-- FaturaClaro — 9 Histórico dos ficheiros de salários enviados ao banco
-- Executar depois do 01 e 02 (pode ser executado mais do que uma vez).
--
-- Cada vez que se descarrega o ficheiro para o banco (página "Salários p/ banco") fica aqui
-- uma cópia: quem foi pago, quanto, o TSV e o Excel preenchido, para voltar a descarregar.
-- Só a administração vê (tem IBANs).
-- =====================================================================

create table if not exists public.salarios_banco_envios (
  id bigint generated always as identity primary key,
  mes text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- AAAA-MM dos recibos
  nome_ficheiro text not null,
  linhas jsonb not null default '[]'::jsonb,                    -- [{ nome, iban, bic, valor }]
  total numeric(14,2) not null default 0,
  tsv text not null,
  excel_base64 text,                                            -- Excel preenchido (pode faltar)
  notas text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists salarios_banco_envios_mes on public.salarios_banco_envios (mes);

alter table public.salarios_banco_envios enable row level security;
drop policy if exists "admin_all" on public.salarios_banco_envios;
create policy "admin_all" on public.salarios_banco_envios for all to authenticated using (public.is_admin()) with check (public.is_admin());
