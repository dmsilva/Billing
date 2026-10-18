-- =====================================================================
-- FaturaClaro — 1/3 Esquema da base de dados
-- Executar no Supabase > SQL Editor > New query (pode ser executado mais do que uma vez).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Perfis e papéis ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nome text,
  role text not null default 'pendente' check (role in ('admin', 'rececao', 'pendente')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email, nome)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon')
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin'
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin', 'rececao')
$$;

-- Nunca deixar a aplicação sem administradora.
create or replace function public.keep_one_admin()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin') or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    if not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
      raise exception 'Tem de existir pelo menos uma administradora.';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists profiles_keep_one_admin on public.profiles;
create trigger profiles_keep_one_admin before update or delete on public.profiles
  for each row execute function public.keep_one_admin();

-- ---------- updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Tabelas de referência ----------
create table if not exists public.properties (
  id bigint generated always as identity primary key,
  nome text not null unique,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id bigint generated always as identity primary key,
  nome text not null unique,
  -- false = não é despesa (ex.: transferências entre empresas do grupo)
  conta_como_despesa boolean not null default true,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Extrato CGD ----------
create table if not exists public.bank_transactions (
  id bigint generated always as identity primary key,
  legacy_idx integer unique,                 -- posição no HTML legado (para migrar alterações do navegador)
  import_hash text not null unique,          -- data|descrição|valor|saldo, evita duplicados ao reimportar
  data_mov date not null,
  data_valor date,
  descricao text not null,
  valor numeric(14,2) not null check (valor >= 0),   -- saída da conta (valor positivo)
  saldo numeric(14,2),
  categoria_id bigint references public.categories(id),
  categoria_original text,                   -- classificação com que o movimento chegou
  imovel_id bigint references public.properties(id),
  notas text,
  origem text not null default 'extrato' check (origem in ('legado', 'extrato', 'manual')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bank_transactions_data_idx on public.bank_transactions (data_mov);
drop trigger if exists bank_transactions_touch on public.bank_transactions;
create trigger bank_transactions_touch before update on public.bank_transactions
  for each row execute function public.touch_updated_at();

create table if not exists public.category_changes (
  id bigint generated always as identity primary key,
  bank_transaction_id bigint references public.bank_transactions(id) on delete set null,
  de text,
  para text,
  alterado_por uuid default auth.uid(),
  alterado_em timestamptz not null default now()
);

create or replace function public.log_category_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.categoria_id is distinct from old.categoria_id then
    insert into public.category_changes (bank_transaction_id, de, para, alterado_por)
    values (new.id,
      (select nome from public.categories where id = old.categoria_id),
      (select nome from public.categories where id = new.categoria_id),
      auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists bank_transactions_category_log on public.bank_transactions;
create trigger bank_transactions_category_log after update of categoria_id on public.bank_transactions
  for each row execute function public.log_category_change();

-- ---------- Faturas e documentos ----------
create table if not exists public.invoices (
  id bigint generated always as identity primary key,
  legacy_idx integer unique,
  data date,
  fornecedor text,
  documento text,
  descricao text,
  categoria_id bigint references public.categories(id),
  imovel_id bigint references public.properties(id),
  pagamento text not null check (pagamento in ('CGD', 'Numerário')),
  valor numeric(14,2) check (valor is null or valor >= 0),
  iva numeric(14,2) check (iva is null or iva >= 0),
  iva_estado text not null default 'A apurar' check (iva_estado in ('A apurar', 'Apurado', 'Isento')),
  estado text not null default 'Por validar' check (estado in ('Por validar', 'Validada', 'Rejeitada')),
  origem text not null default 'manual' check (origem in ('legado', 'rececao', 'manual')),
  -- fatura paga por CGD: movimento do extrato a que corresponde (não soma duas vezes)
  bank_transaction_id bigint references public.bank_transactions(id) on delete set null,
  enviado_por text,
  observacoes text,
  motivo_rejeicao text,
  submitted_by uuid default auth.uid() references auth.users(id) on delete set null,
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_data_idx on public.invoices (data);
create index if not exists invoices_estado_idx on public.invoices (estado);
drop trigger if exists invoices_touch on public.invoices;
create trigger invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();

create table if not exists public.invoice_files (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  storage_path text not null unique,
  nome_ficheiro text,
  mime text,
  tamanho bigint,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists invoice_files_invoice_idx on public.invoice_files (invoice_id);

-- Linhas de produtos (podem existir sem fatura associada: produtos lidos de talões antigos)
create table if not exists public.invoice_lines (
  id bigint generated always as identity primary key,
  legacy_idx integer unique,
  invoice_id bigint references public.invoices(id) on delete cascade,
  produto text not null,
  unidade text,
  quantidade numeric(14,3),
  valor numeric(14,2),
  tipo text,                 -- categoria do produto (Pequeno-almoço, Limpeza, ...)
  fornecedor text,
  data date,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id);
drop trigger if exists invoice_lines_touch on public.invoice_lines;
create trigger invoice_lines_touch before update on public.invoice_lines
  for each row execute function public.touch_updated_at();

-- ---------- Caixa diária ----------
create table if not exists public.cash_closes (
  id bigint generated always as identity primary key,
  data date not null,
  turno text not null check (turno in ('7h', '15h', '23h')),
  dinheiro numeric(14,3) not null default 0,   -- 3 casas: o Excel tem valores como 165,642
  cv numeric(14,3) not null default 0,
  mb numeric(14,3) not null default 0,
  city_mb numeric(14,3) not null default 0,
  registos integer,
  origem text not null default 'excel' check (origem in ('legado', 'excel', 'navegador', 'manual')),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (data, turno)
);
drop trigger if exists cash_closes_touch on public.cash_closes;
create trigger cash_closes_touch before update on public.cash_closes
  for each row execute function public.touch_updated_at();

create table if not exists public.cash_checks (
  id bigint generated always as identity primary key,
  cash_close_id bigint not null references public.cash_closes(id) on delete cascade,
  tipo text not null check (tipo in ('cv', 'mb', 'dinheiro')),
  valor_esperado numeric(14,3) not null,
  valor_real numeric(14,3) not null check (valor_real >= 0),
  diferenca numeric(14,3) generated always as (valor_real - valor_esperado) stored,
  nota text,
  conferido_por uuid default auth.uid(),
  conferido_em timestamptz not null default now(),
  unique (cash_close_id, tipo)
);

-- Histórico de todas as conferências e correções (nunca se perde um valor registado).
create table if not exists public.cash_check_history (
  id bigint generated always as identity primary key,
  cash_check_id bigint,
  cash_close_id bigint,
  data date,
  turno text,
  tipo text,
  acao text not null check (acao in ('conferido', 'corrigido', 'removido')),
  valor_esperado numeric(14,3),
  valor_real_anterior numeric(14,3),
  valor_real_novo numeric(14,3),
  por uuid default auth.uid(),
  em timestamptz not null default now()
);

create or replace function public.log_cash_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.cash_closes;
begin
  select * into c from public.cash_closes where id = coalesce(new.cash_close_id, old.cash_close_id);
  if tg_op = 'INSERT' then
    insert into public.cash_check_history (cash_check_id, cash_close_id, data, turno, tipo, acao, valor_esperado, valor_real_novo, por)
    values (new.id, new.cash_close_id, c.data, c.turno, new.tipo, 'conferido', new.valor_esperado, new.valor_real, auth.uid());
  elsif tg_op = 'UPDATE' then
    if new.valor_real is distinct from old.valor_real or new.valor_esperado is distinct from old.valor_esperado then
      insert into public.cash_check_history (cash_check_id, cash_close_id, data, turno, tipo, acao, valor_esperado, valor_real_anterior, valor_real_novo, por)
      values (new.id, new.cash_close_id, c.data, c.turno, new.tipo, 'corrigido', new.valor_esperado, old.valor_real, new.valor_real, auth.uid());
    end if;
  else
    insert into public.cash_check_history (cash_check_id, cash_close_id, data, turno, tipo, acao, valor_esperado, valor_real_anterior, por)
    values (old.id, old.cash_close_id, c.data, c.turno, old.tipo, 'removido', old.valor_esperado, old.valor_real, auth.uid());
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists cash_checks_log on public.cash_checks;
create trigger cash_checks_log after insert or update or delete on public.cash_checks
  for each row execute function public.log_cash_check();

create table if not exists public.tpa_records (
  id bigint generated always as identity primary key,
  data date not null,
  turno text not null check (turno in ('7h', '15h', '23h')),
  cv numeric(14,3) not null default 0,
  mb numeric(14,3) not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (data, turno)
);

create table if not exists public.cash_imports (
  id bigint generated always as identity primary key,
  nome_ficheiro text,
  novos integer not null default 0,
  alterados integer not null default 0,
  iguais integer not null default 0,
  detalhes jsonb not null default '{}'::jsonb,   -- valores anteriores de cada fecho alterado
  anulada_em timestamptz,
  importado_por uuid default auth.uid(),
  importado_em timestamptz not null default now()
);

create table if not exists public.bank_imports (
  id bigint generated always as identity primary key,
  nome_ficheiro text,
  novos integer not null default 0,
  duplicados integer not null default 0,
  importado_por uuid default auth.uid(),
  importado_em timestamptz not null default now()
);

create table if not exists public.legacy_browser_imports (
  id bigint generated always as identity primary key,
  payload jsonb not null,        -- cópia integral do que veio do navegador antigo
  resumo jsonb,
  importado_por uuid default auth.uid(),
  importado_em timestamptz not null default now()
);

-- ---------- Funções transacionais ----------

-- Importa fechos de caixa (novos e alterados) numa só transação e guarda os valores anteriores.
create or replace function public.import_cash_closes(p_rows jsonb, p_file text, p_origem text default 'excel')
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  r jsonb;
  cur public.cash_closes;
  v_novos jsonb := '[]'::jsonb;
  v_alterados jsonb := '[]'::jsonb;
  v_iguais int := 0;
  v_id bigint;
begin
  if not public.is_admin() then raise exception 'Apenas a administradora pode importar a caixa.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into cur from public.cash_closes where data = (r->>'data')::date and turno = r->>'turno';
    if not found then
      insert into public.cash_closes (data, turno, dinheiro, cv, mb, city_mb, registos, origem)
      values ((r->>'data')::date, r->>'turno', coalesce((r->>'dinheiro')::numeric, 0), coalesce((r->>'cv')::numeric, 0),
              coalesce((r->>'mb')::numeric, 0), coalesce((r->>'city_mb')::numeric, 0), (r->>'registos')::int, p_origem);
      v_novos := v_novos || jsonb_build_object('data', r->>'data', 'turno', r->>'turno');
    elsif cur.dinheiro is distinct from coalesce((r->>'dinheiro')::numeric, 0)
       or cur.cv is distinct from coalesce((r->>'cv')::numeric, 0)
       or cur.mb is distinct from coalesce((r->>'mb')::numeric, 0)
       or cur.city_mb is distinct from coalesce((r->>'city_mb')::numeric, 0) then
      v_alterados := v_alterados || jsonb_build_object('data', r->>'data', 'turno', r->>'turno', 'antes', to_jsonb(cur), 'depois', r);
      update public.cash_closes set dinheiro = coalesce((r->>'dinheiro')::numeric, 0), cv = coalesce((r->>'cv')::numeric, 0),
        mb = coalesce((r->>'mb')::numeric, 0), city_mb = coalesce((r->>'city_mb')::numeric, 0),
        registos = coalesce((r->>'registos')::int, registos), origem = p_origem, updated_by = auth.uid()
      where id = cur.id;
    else
      v_iguais := v_iguais + 1;
    end if;
  end loop;
  insert into public.cash_imports (nome_ficheiro, novos, alterados, iguais, detalhes)
  values (p_file, jsonb_array_length(v_novos), jsonb_array_length(v_alterados), v_iguais,
          jsonb_build_object('novos', v_novos, 'alterados', v_alterados, 'origem', p_origem))
  returning id into v_id;
  return v_id;
end $$;

-- Anula uma importação: repõe os valores anteriores e remove os fechos que ela criou
-- (desde que ainda não tenham conferências).
create or replace function public.undo_cash_import(p_import_id bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  imp public.cash_imports;
  a jsonb;
  n jsonb;
  v_repostos int := 0;
  v_removidos int := 0;
  v_mantidos int := 0;
  v_close bigint;
begin
  if not public.is_admin() then raise exception 'Apenas a administradora pode anular importações.'; end if;
  select * into imp from public.cash_imports where id = p_import_id for update;
  if not found then raise exception 'Importação não encontrada.'; end if;
  if imp.anulada_em is not null then raise exception 'Esta importação já foi anulada.'; end if;
  for a in select * from jsonb_array_elements(coalesce(imp.detalhes->'alterados', '[]'::jsonb)) loop
    update public.cash_closes set dinheiro = (a->'antes'->>'dinheiro')::numeric, cv = (a->'antes'->>'cv')::numeric,
      mb = (a->'antes'->>'mb')::numeric, city_mb = (a->'antes'->>'city_mb')::numeric,
      registos = (a->'antes'->>'registos')::int, origem = a->'antes'->>'origem', updated_by = auth.uid()
    where data = (a->>'data')::date and turno = a->>'turno';
    v_repostos := v_repostos + 1;
  end loop;
  for n in select * from jsonb_array_elements(coalesce(imp.detalhes->'novos', '[]'::jsonb)) loop
    select id into v_close from public.cash_closes where data = (n->>'data')::date and turno = n->>'turno';
    if v_close is not null and not exists (select 1 from public.cash_checks where cash_close_id = v_close) then
      delete from public.cash_closes where id = v_close;
      v_removidos := v_removidos + 1;
    elsif v_close is not null then
      v_mantidos := v_mantidos + 1;
    end if;
  end loop;
  update public.cash_imports set anulada_em = now() where id = p_import_id;
  return jsonb_build_object('repostos', v_repostos, 'removidos', v_removidos, 'mantidos_com_conferencia', v_mantidos);
end $$;

-- Importa movimentos do extrato CGD, ignorando os que já existem.
create or replace function public.import_bank_transactions(p_rows jsonb, p_file text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_novos int;
  v_total int := jsonb_array_length(p_rows);
begin
  if not public.is_admin() then raise exception 'Apenas a administradora pode importar o extrato.'; end if;
  with ins as (
    insert into public.bank_transactions (import_hash, data_mov, data_valor, descricao, valor, saldo, categoria_id, categoria_original, imovel_id, origem)
    select r->>'import_hash', (r->>'data_mov')::date, nullif(r->>'data_valor', '')::date, r->>'descricao', (r->>'valor')::numeric,
           nullif(r->>'saldo', '')::numeric,
           coalesce(nullif(r->>'categoria_id', '')::bigint, (select id from public.categories where nome = 'Por classificar')),
           coalesce((select nome from public.categories where id = nullif(r->>'categoria_id', '')::bigint), 'Por classificar'),
           nullif(r->>'imovel_id', '')::bigint, 'extrato'
    from jsonb_array_elements(p_rows) r
    on conflict (import_hash) do nothing
    returning 1
  )
  select count(*) into v_novos from ins;
  insert into public.bank_imports (nome_ficheiro, novos, duplicados) values (p_file, v_novos, v_total - v_novos);
  return jsonb_build_object('novos', v_novos, 'duplicados', v_total - v_novos);
end $$;

-- ---------- Sincronização em tempo real ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['properties', 'categories', 'bank_transactions', 'invoices', 'invoice_files', 'invoice_lines',
                             'cash_closes', 'cash_checks', 'tpa_records', 'cash_imports', 'profiles'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
