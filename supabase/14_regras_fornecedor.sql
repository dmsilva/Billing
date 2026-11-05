-- =====================================================================
-- Fatura Chalet — 14 Regras por fornecedor (categoria e pagamento por defeito)
-- Executar depois do 01, 02 e 05 (pode ser executado mais do que uma vez).
--
-- Há fornecedores cujas faturas são sempre iguais: a Grão de Trigo é sempre pequeno-almoço /
-- pastelaria e fica por pagar até ao fim do mês. Com uma regra aqui, qualquer fatura nova
-- desse fornecedor (receção, arrastar faturas, faturas do email) fica logo assim, mesmo que
-- quem a regista se esqueça. As regras gerem-se na página "Editar categorias".
-- =====================================================================

-- Nome do fornecedor reduzido ao essencial, para comparar: minúsculas, sem acentos,
-- sem "de/da/do" e sem espaços nem pontuação. "Grão de Trigo, Lda" → "graotrigolda".
create or replace function public.chave_fornecedor(p_nome text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             translate(lower(coalesce(p_nome, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
             '(^|[^a-z0-9])(de|da|do|das|dos|e)(?=[^a-z0-9]|$)', '\1', 'g'),
           '[^a-z0-9]+', '', 'g')
$$;

create table if not exists public.regras_fornecedor (
  id bigint generated always as identity primary key,
  fornecedor text not null,                  -- como a administração o escreveu (ex.: Grão de Trigo)
  chave text generated always as (public.chave_fornecedor(fornecedor)) stored,
  categoria_id bigint references public.categories(id) on delete set null,
  pagamento text check (pagamento in ('Por pagar', 'CGD', 'Numerário')),   -- null = o que quem regista escolher
  nota text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (length(public.chave_fornecedor(fornecedor)) >= 3)
);
create unique index if not exists regras_fornecedor_chave_idx on public.regras_fornecedor (chave);

alter table public.regras_fornecedor enable row level security;
drop policy if exists "admin_all" on public.regras_fornecedor;
create policy "admin_all" on public.regras_fornecedor for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.regras_fornecedor to authenticated;

-- Regra que serve a este fornecedor (a mais específica, se houver várias).
create or replace function public.regra_do_fornecedor(p_fornecedor text)
returns public.regras_fornecedor language sql stable security definer set search_path = public as $$
  select r.* from public.regras_fornecedor r
  where length(public.chave_fornecedor(p_fornecedor)) >= 3
    and public.chave_fornecedor(p_fornecedor) like '%' || r.chave || '%'
  order by length(r.chave) desc, r.id
  limit 1
$$;

-- Ao gravar uma fatura:
--  - sem categoria (ou "Por classificar") → categoria da regra;
--  - fatura nova enviada pela receção → pagamento da regra (ex.: "Por pagar"; liquida-se depois
--    em "Por liquidar"). Na administração (arrastar, email) a regra vem pré-escolhida no ecrã de
--    revisão e vale o que lá ficar. Alterações posteriores (liquidar, editar) não mexem.
create or replace function public.invoices_regra_fornecedor()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.regras_fornecedor;
begin
  r := public.regra_do_fornecedor(new.fornecedor);
  if r.id is null then return new; end if;
  if r.categoria_id is not null and (new.categoria_id is null or exists (
    select 1 from public.categories c where c.id = new.categoria_id and c.nome in ('Por classificar', 'Outros / por classificar'))) then
    new.categoria_id := r.categoria_id;
  end if;
  if tg_op = 'INSERT' and r.pagamento is not null and new.origem = 'rececao'
     and new.payment_id is null and new.bank_transaction_id is null then
    new.pagamento := r.pagamento;
  end if;
  return new;
end $$;
drop trigger if exists invoices_regra_fornecedor on public.invoices;
create trigger invoices_regra_fornecedor before insert or update of fornecedor, categoria_id on public.invoices
  for each row execute function public.invoices_regra_fornecedor();

-- Primeiras regras (pedido do Daniel, 2026-11-05).
insert into public.categories (nome) values ('Pequeno-almoço / pastelaria'), ('Sistema de reservas (Starline)') on conflict (nome) do nothing;
insert into public.regras_fornecedor (fornecedor, categoria_id, pagamento, nota)
select 'Grão de Trigo', id, 'Por pagar', 'Pão e bolos do pequeno-almoço; liquida-se no fim do mês.' from public.categories where nome = 'Pequeno-almoço / pastelaria'
on conflict (chave) do nothing;
insert into public.regras_fornecedor (fornecedor, categoria_id, nota)
select 'Starline', id, 'Sistema de reservas.' from public.categories where nome = 'Sistema de reservas (Starline)'
on conflict (chave) do nothing;

-- As faturas que já existem destes fornecedores passam para a categoria da regra
-- (as sem categoria e, na Grão de Trigo, as que a classificação automática pôs em "padeiro / Grão Trigo").
-- O pagamento das antigas não muda aqui: vê-se e corrige-se em Editar categorias.
update public.invoices i
set categoria_id = r.categoria_id
from public.regras_fornecedor r
where r.categoria_id is not null
  and public.chave_fornecedor(i.fornecedor) like '%' || r.chave || '%'
  and i.estado <> 'Rejeitada'
  and i.categoria_id is distinct from r.categoria_id
  and (i.categoria_id is null or i.categoria_id in (
    select id from public.categories where nome in ('Por classificar', 'Outros / por classificar', 'Fornecedor — padeiro / Grão Trigo')));
