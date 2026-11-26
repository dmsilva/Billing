-- =====================================================================
-- Fatura Chalet — 19 Dívidas e adiantamentos dos colaboradores (uso interno)
-- Executar depois do 01, 02 e 09 (pode ser executado mais do que uma vez).
--
-- Controlo interno: NÃO entra na folha da contabilidade nem nos ficheiros enviados ao contabilista.
-- Cada linha é um movimento de uma pessoa:
--   divida       → a pessoa ficou a dever-nos este valor
--   pagamento    → abate à dívida: horas extra (horas × valor/hora), dinheiro, ou desconto no salário
--   adiantamento → adiantamento de salário, a descontar no salário do mês "descontar_mes"
-- Os adiantamentos e os pagamentos por desconto no salário aparecem na página "Salários p/ banco"
-- desse mês e ficam marcados como descontados quando se descarrega o ficheiro para o banco.
-- Só a administração vê.
-- =====================================================================

create table if not exists public.colaboradores_movimentos (
  id bigint generated always as identity primary key,
  pessoa text not null check (btrim(pessoa) <> ''),
  tipo text not null check (tipo in ('divida', 'pagamento', 'adiantamento')),
  forma text check (forma in ('horas', 'dinheiro', 'salario')),           -- só nos pagamentos
  data date not null default current_date,
  descricao text,
  horas numeric(8,2) check (horas is null or horas > 0),
  valor_hora numeric(8,2) check (valor_hora is null or valor_hora > 0),
  valor numeric(12,2) not null check (valor > 0),
  descontar_mes text check (descontar_mes is null or descontar_mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),  -- AAAA-MM do salário
  descontado_em timestamptz,
  descontado_envio bigint references public.salarios_banco_envios(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint colaboradores_movimentos_forma check ((tipo = 'pagamento') = (forma is not null)),
  constraint colaboradores_movimentos_horas check (forma is distinct from 'horas' or horas is not null),
  constraint colaboradores_movimentos_mes check (
    (tipo = 'adiantamento' or forma = 'salario') = (descontar_mes is not null))
);
create index if not exists colaboradores_movimentos_pessoa on public.colaboradores_movimentos (pessoa);
create index if not exists colaboradores_movimentos_mes on public.colaboradores_movimentos (descontar_mes) where descontado_em is null;

alter table public.colaboradores_movimentos enable row level security;
drop policy if exists "admin_all" on public.colaboradores_movimentos;
create policy "admin_all" on public.colaboradores_movimentos for all to authenticated using (public.is_admin()) with check (public.is_admin());
