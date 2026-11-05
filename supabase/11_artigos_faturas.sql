-- =====================================================================
-- FaturaClaro — 11 Artigos lidos das faturas (gasto por produto)
-- Executar depois do 01 e 02 (pode ser executado mais do que uma vez).
--
-- A leitura automática passa a ler também as linhas de cada fatura (manteiga, leite,
-- detergente…). Cada linha fica com um "artigo" (nome genérico, sem marca nem tamanho)
-- para somar o gasto do mesmo produto em faturas de fornecedores diferentes.
-- =====================================================================

alter table public.invoice_lines add column if not exists artigo text;           -- ex.: Manteiga, Leite, Detergente da loiça
alter table public.invoice_lines add column if not exists lido_auto boolean not null default false;
create index if not exists invoice_lines_artigo_idx on public.invoice_lines (artigo);

-- Quando a administração mandou ler os artigos da fatura (para não voltar a ler as mesmas).
alter table public.invoices add column if not exists artigos_lidos_em timestamptz;

-- A receção grava as linhas lidas das faturas que ela própria acabou de enviar (ainda por validar).
drop policy if exists "rececao_insert_line" on public.invoice_lines;
create policy "rececao_insert_line" on public.invoice_lines for insert to authenticated
  with check (
    public.is_staff() and lido_auto and legacy_idx is null
    and exists (select 1 from public.invoices i where i.id = invoice_id and i.submitted_by = auth.uid() and i.estado = 'Por validar')
  );

-- Nomes de artigos já usados, para a leitura escrever "Manteiga" sempre da mesma forma.
-- A receção não vê as linhas; esta função só devolve os nomes (sem valores).
create or replace function public.artigos_conhecidos()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(artigo order by n desc, artigo), '{}')
  from (
    select artigo, count(*) as n from public.invoice_lines
    where public.is_staff() and artigo is not null and btrim(artigo) <> ''
    group by artigo order by count(*) desc, artigo limit 300
  ) t
$$;
revoke all on function public.artigos_conhecidos() from public, anon;
grant execute on function public.artigos_conhecidos() to authenticated;
