-- =====================================================================
-- FaturaClaro — 5 Faturas por pagar e pagamentos agrupados
-- Executar depois do 01 e do 02 (pode ser executado mais do que uma vez).
--
-- A receção pode registar uma fatura como "Por pagar". Fica por liquidar até a
-- administradora a pagar, sozinha ou junto com outras (ex.: todas as faturas do mês
-- de um fornecedor numa só transferência). Ao liquidar, a fatura passa a CGD ou
-- Numerário e segue as regras de sempre: em numerário soma, por CGD não soma (o
-- movimento do extrato já conta). Enquanto está por pagar, não entra nos totais.
-- =====================================================================

alter table public.invoices drop constraint if exists invoices_pagamento_check;
alter table public.invoices add constraint invoices_pagamento_check
  check (pagamento in ('CGD', 'Numerário', 'Por pagar'));

create table if not exists public.invoice_payments (
  id bigint generated always as identity primary key,
  data date not null,
  meio text not null check (meio in ('CGD', 'Numerário')),
  valor numeric(14,2) not null check (valor >= 0),
  fornecedor text,
  referencia text,
  observacoes text,
  -- pagamento por CGD: movimento do extrato que corresponde ao pagamento agrupado
  bank_transaction_id bigint references public.bank_transactions(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists invoice_payments_data_idx on public.invoice_payments (data);

alter table public.invoices add column if not exists payment_id bigint references public.invoice_payments(id) on delete set null;
alter table public.invoices add column if not exists liquidada_em date;
create index if not exists invoices_payment_idx on public.invoices (payment_id);
create index if not exists invoices_por_pagar_idx on public.invoices (pagamento) where pagamento = 'Por pagar';

-- Liquida uma ou mais faturas por pagar num único pagamento (tudo ou nada).
create or replace function public.liquidar_faturas(p_ids bigint[], p_data date, p_meio text,
  p_referencia text default null, p_observacoes text default null, p_bank_transaction_id bigint default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_n int;
  v_total numeric(14,2);
  v_fornecedor text;
  v_payment bigint;
begin
  if not public.is_admin() then raise exception 'Apenas a administradora pode liquidar faturas.'; end if;
  if p_meio not in ('CGD', 'Numerário') then raise exception 'Meio de pagamento inválido: %', p_meio; end if;
  if p_data is null then raise exception 'Indica a data do pagamento.'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Escolhe pelo menos uma fatura.'; end if;

  perform 1 from public.invoices where id = any(p_ids) for update;
  select count(*), sum(valor), case when count(distinct coalesce(fornecedor, '')) = 1 then max(fornecedor) end
    into v_n, v_total, v_fornecedor
  from public.invoices where id = any(p_ids);
  if v_n <> (select count(distinct x) from unnest(p_ids) x) then raise exception 'Alguma das faturas escolhidas já não existe.'; end if;
  if exists (select 1 from public.invoices where id = any(p_ids) and pagamento <> 'Por pagar') then
    raise exception 'Alguma das faturas escolhidas já está liquidada.';
  end if;
  if exists (select 1 from public.invoices where id = any(p_ids) and estado = 'Rejeitada') then
    raise exception 'Não é possível liquidar faturas rejeitadas.';
  end if;
  if exists (select 1 from public.invoices where id = any(p_ids) and valor is null) then
    raise exception 'Há faturas sem valor. Preenche o valor antes de liquidar.';
  end if;

  insert into public.invoice_payments (data, meio, valor, fornecedor, referencia, observacoes, bank_transaction_id)
  values (p_data, p_meio, v_total, v_fornecedor, nullif(trim(p_referencia), ''), nullif(trim(p_observacoes), ''),
          case when p_meio = 'CGD' then p_bank_transaction_id end)
  returning id into v_payment;

  update public.invoices
     set pagamento = p_meio, payment_id = v_payment, liquidada_em = p_data,
         bank_transaction_id = case when p_meio = 'CGD' and v_n = 1 then p_bank_transaction_id else bank_transaction_id end
   where id = any(p_ids);

  return jsonb_build_object('pagamento', v_payment, 'faturas', v_n, 'valor', v_total);
end $$;

-- Anula um pagamento: as faturas voltam a ficar por pagar.
create or replace function public.anular_pagamento(p_payment_id bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_n int;
  v_bank bigint;
begin
  if not public.is_admin() then raise exception 'Apenas a administradora pode anular pagamentos.'; end if;
  select bank_transaction_id into v_bank from public.invoice_payments where id = p_payment_id for update;
  if not found then raise exception 'Pagamento não encontrado.'; end if;
  update public.invoices
     set pagamento = 'Por pagar', payment_id = null, liquidada_em = null,
         bank_transaction_id = case when bank_transaction_id = v_bank then null else bank_transaction_id end
   where payment_id = p_payment_id;
  get diagnostics v_n = row_count;
  delete from public.invoice_payments where id = p_payment_id;
  return jsonb_build_object('faturas', v_n);
end $$;

-- ---------- Permissões ----------
alter table public.invoice_payments enable row level security;
drop policy if exists "admin_all" on public.invoice_payments;
create policy "admin_all" on public.invoice_payments for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on function public.liquidar_faturas(bigint[], date, text, text, text, bigint) from public, anon;
revoke all on function public.anular_pagamento(bigint) from public, anon;
grant execute on function public.liquidar_faturas(bigint[], date, text, text, text, bigint) to authenticated;
grant execute on function public.anular_pagamento(bigint) to authenticated;

-- A receção pode enviar faturas por pagar, mas nunca ligá-las a um pagamento.
drop policy if exists "rececao_insert_invoice" on public.invoices;
create policy "rececao_insert_invoice" on public.invoices for insert to authenticated
  with check (public.is_staff() and submitted_by = auth.uid() and origem = 'rececao' and estado = 'Por validar'
              and validated_by is null and bank_transaction_id is null and payment_id is null and liquidada_em is null);

-- ---------- Sincronização em tempo real ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoice_payments') then
    alter publication supabase_realtime add table public.invoice_payments;
  end if;
end $$;
