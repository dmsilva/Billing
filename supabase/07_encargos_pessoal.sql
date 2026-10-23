-- =====================================================================
-- FaturaClaro — 7 Encargos com pessoal (TSU e IRS mensais)
-- Executar depois do 01 e 02 (pode ser executado mais do que uma vez).
--
-- A TSU e o IRS dos funcionários são pagos dentro dos "Gastos do mês" (o pagamento à
-- contabilidade). Esta tabela guarda quanto, desse valor, foi TSU e IRS em cada mês, para
-- se saber o custo real com o pessoal (salários + TSU + IRS). Não soma às despesas:
-- o dinheiro já saiu da CGD no movimento "Gastos do mês".
-- =====================================================================

create table if not exists public.encargos_pessoal (
  id bigint generated always as identity primary key,
  mes text not null unique check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- AAAA-MM
  tsu numeric(14,2) not null default 0 check (tsu >= 0),
  irs numeric(14,2) not null default 0 check (irs >= 0),
  notas text,
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists encargos_pessoal_touch on public.encargos_pessoal;
create trigger encargos_pessoal_touch before update on public.encargos_pessoal
  for each row execute function public.touch_updated_at();

alter table public.encargos_pessoal enable row level security;
drop policy if exists "admin_all" on public.encargos_pessoal;
create policy "admin_all" on public.encargos_pessoal for all to authenticated using (public.is_admin()) with check (public.is_admin());
