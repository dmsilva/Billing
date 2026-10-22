-- =====================================================================
-- FaturaClaro — 6 Entradas do extrato e transferências na receção
-- Executar depois do 01, 02 e 05 (pode ser executado mais do que uma vez).
--
-- Entradas: os créditos do extrato CGD (pagamentos da Expedia/Travelscape, do Stripe,
-- do Booking, transferências de hóspedes…) passam a ser importados como entradas.
-- Nunca contam como despesa; ficam numa tabela à parte das saídas.
--
-- Transferências: lista partilhada com a receção para saber se uma transferência
-- de um hóspede já chegou. A administradora publica-as (do extrato ou à mão) e a
-- receção pesquisa e aloca cada uma a um imóvel/quarto e reserva.
-- =====================================================================

create table if not exists public.bank_credits (
  id bigint generated always as identity primary key,
  import_hash text not null unique,          -- data|descrição|valor|saldo, evita duplicados ao reimportar
  data_mov date not null,
  data_valor date,
  descricao text not null,
  valor numeric(14,2) not null check (valor > 0),    -- entrada na conta (valor positivo)
  saldo numeric(14,2),
  tipo text not null default 'Outra',        -- Expedia, Stripe, Booking, Airbnb, Transferência, Depósito, Outra
  conta_como_entrada boolean not null default true,  -- falso para, por exemplo, transferências entre contas próprias
  imovel_id bigint references public.properties(id),
  notas text,
  origem text not null default 'extrato' check (origem in ('extrato', 'manual')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bank_credits_data_idx on public.bank_credits (data_mov);
drop trigger if exists bank_credits_touch on public.bank_credits;
create trigger bank_credits_touch before update on public.bank_credits
  for each row execute function public.touch_updated_at();

create table if not exists public.transferencias (
  id bigint generated always as identity primary key,
  data date not null,
  valor numeric(14,2) not null check (valor > 0),
  ordenante text,                            -- quem transferiu (hóspede, agência…)
  descricao text,                            -- texto do movimento no banco
  bank_credit_id bigint unique references public.bank_credits(id) on delete set null,
  imovel_id bigint references public.properties(id),
  quarto text,
  reserva text,
  notas text,
  alocada_por uuid references auth.users(id) on delete set null,
  alocada_em timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transferencias_data_idx on public.transferencias (data);
drop trigger if exists transferencias_touch on public.transferencias;
create trigger transferencias_touch before update on public.transferencias
  for each row execute function public.touch_updated_at();

-- Importa as entradas do extrato. Cada linha pode:
--   rececao = true          → cria também a transferência visível na receção;
--   transferencia_id = <id> → liga a entrada a uma transferência já registada à mão.
create or replace function public.import_bank_credits(p_rows jsonb, p_file text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  r jsonb;
  v_id bigint;
  v_novos int := 0;
  v_dup int := 0;
  v_trf int := 0;
  v_ligadas int := 0;
begin
  if not public.is_admin() then raise exception 'Apenas a administradora pode importar o extrato.'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.bank_credits (import_hash, data_mov, data_valor, descricao, valor, saldo, tipo, conta_como_entrada, imovel_id, notas, origem)
    values (r->>'import_hash', (r->>'data_mov')::date, nullif(r->>'data_valor', '')::date, r->>'descricao', (r->>'valor')::numeric,
            nullif(r->>'saldo', '')::numeric, coalesce(nullif(r->>'tipo', ''), 'Outra'),
            coalesce((r->>'conta_como_entrada')::boolean, true), nullif(r->>'imovel_id', '')::bigint,
            case when p_file is not null then 'Extrato: ' || p_file end, 'extrato')
    on conflict (import_hash) do nothing
    returning id into v_id;
    if v_id is null then v_dup := v_dup + 1; continue; end if;
    v_novos := v_novos + 1;
    if nullif(r->>'transferencia_id', '') is not null then
      update public.transferencias set bank_credit_id = v_id, descricao = coalesce(descricao, r->>'descricao')
       where id = (r->>'transferencia_id')::bigint and bank_credit_id is null;
      if found then v_ligadas := v_ligadas + 1; end if;
    elsif coalesce((r->>'rececao')::boolean, false) then
      insert into public.transferencias (data, valor, ordenante, descricao, bank_credit_id)
      values ((r->>'data_mov')::date, (r->>'valor')::numeric, coalesce(nullif(r->>'ordenante', ''), r->>'descricao'), r->>'descricao', v_id);
      v_trf := v_trf + 1;
    end if;
  end loop;
  return jsonb_build_object('novos', v_novos, 'duplicados', v_dup, 'transferencias', v_trf, 'ligadas', v_ligadas);
end $$;

-- Publica na receção uma entrada já importada.
create or replace function public.publicar_transferencia(p_credit_id bigint, p_ordenante text default null)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  c public.bank_credits;
  v_id bigint;
begin
  if not public.is_admin() then raise exception 'Apenas a administradora pode publicar transferências.'; end if;
  select * into c from public.bank_credits where id = p_credit_id;
  if not found then raise exception 'Entrada não encontrada.'; end if;
  select id into v_id from public.transferencias where bank_credit_id = p_credit_id;
  if v_id is not null then return v_id; end if;
  insert into public.transferencias (data, valor, ordenante, descricao, bank_credit_id)
  values (c.data_mov, c.valor, coalesce(nullif(trim(p_ordenante), ''), c.descricao), c.descricao, c.id)
  returning id into v_id;
  return v_id;
end $$;

-- A receção (e a administradora) alocam uma transferência a um imóvel/quarto e reserva.
-- Só mexe nestes campos; tudo vazio desfaz a alocação.
create or replace function public.alocar_transferencia(p_id bigint, p_imovel_id bigint, p_quarto text, p_reserva text, p_notas text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_alocada boolean := p_imovel_id is not null or nullif(trim(p_quarto), '') is not null or nullif(trim(p_reserva), '') is not null;
begin
  if not public.is_staff() then raise exception 'Sem permissão para alocar transferências.'; end if;
  update public.transferencias
     set imovel_id = p_imovel_id, quarto = nullif(trim(p_quarto), ''), reserva = nullif(trim(p_reserva), ''),
         notas = nullif(trim(p_notas), ''),
         alocada_por = case when v_alocada then auth.uid() end,
         alocada_em = case when v_alocada then now() end
   where id = p_id;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  return jsonb_build_object('id', p_id, 'alocada', v_alocada);
end $$;

-- ---------- Permissões ----------
alter table public.bank_credits enable row level security;
alter table public.transferencias enable row level security;
drop policy if exists "admin_all" on public.bank_credits;
create policy "admin_all" on public.bank_credits for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all" on public.transferencias;
create policy "admin_all" on public.transferencias for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- A receção só vê a lista de transferências (nunca o extrato nem o saldo) e só a altera pela função acima.
drop policy if exists "staff_read_transferencias" on public.transferencias;
create policy "staff_read_transferencias" on public.transferencias for select to authenticated using (public.is_staff());

revoke all on function public.import_bank_credits(jsonb, text) from public, anon;
revoke all on function public.publicar_transferencia(bigint, text) from public, anon;
revoke all on function public.alocar_transferencia(bigint, bigint, text, text, text) from public, anon;
grant execute on function public.import_bank_credits(jsonb, text) to authenticated;
grant execute on function public.publicar_transferencia(bigint, text) to authenticated;
grant execute on function public.alocar_transferencia(bigint, bigint, text, text, text) to authenticated;

-- ---------- Sincronização em tempo real ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['bank_credits', 'transferencias'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
