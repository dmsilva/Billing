-- Testes das faturas por pagar e dos pagamentos agrupados. Executado por scripts/test-sql.sh.
\set ON_ERROR_STOP on

-- Receção envia uma fatura por pagar, mas não a pode marcar como liquidada.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
begin
  insert into public.invoices (data, fornecedor, pagamento, valor, origem, estado)
  values ('2026-10-05', 'Grão de Trigo', 'Por pagar', 12.40, 'rececao', 'Por validar');
  begin
    insert into public.invoices (data, fornecedor, pagamento, valor, origem, estado, liquidada_em)
    values ('2026-10-06', 'Grão de Trigo', 'Por pagar', 1, 'rececao', 'Por validar', '2026-10-06');
    raise exception 'FALHOU: receção registou uma fatura já liquidada';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
  begin
    perform public.liquidar_faturas(array(select id from public.invoices), '2026-10-31', 'CGD');
    raise exception 'FALHOU: receção liquidou faturas';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare r jsonb; v_ids bigint[]; v_pay bigint; v_bank bigint; n int; v_total numeric;
begin
  insert into public.invoices (data, fornecedor, pagamento, valor, origem, estado) values
    ('2026-10-12', 'Grão de Trigo', 'Por pagar', 20.10, 'manual', 'Validada'),
    ('2026-10-19', 'Grão de Trigo', 'Por pagar', 7.50, 'manual', 'Validada');
  select array_agg(id order by id) into v_ids from public.invoices where fornecedor = 'Grão de Trigo';
  if array_length(v_ids, 1) <> 3 then raise exception 'FALHOU: esperava 3 faturas por pagar, há %', array_length(v_ids, 1); end if;

  -- Por pagar não conta como despesa em numerário
  select coalesce(sum(valor), 0) into v_total from public.invoices where pagamento = 'Numerário' and fornecedor = 'Grão de Trigo';
  if v_total <> 0 then raise exception 'FALHOU: fatura por pagar contada como numerário'; end if;

  -- Fatura sem valor bloqueia a liquidação inteira
  update public.invoices set valor = null where id = v_ids[1];
  begin
    perform public.liquidar_faturas(v_ids, '2026-10-31', 'CGD');
    raise exception 'FALHOU: liquidou faturas sem valor';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
  if exists (select 1 from public.invoices where id = any(v_ids) and pagamento <> 'Por pagar') then raise exception 'FALHOU: liquidação parcial'; end if;
  update public.invoices set valor = 12.40 where id = v_ids[1];

  -- Pagamento agrupado por CGD ligado a um movimento do extrato
  select id into v_bank from public.bank_transactions where legacy_idx = 0;
  r := public.liquidar_faturas(v_ids, '2026-10-31', 'CGD', 'Transf. outubro', null, v_bank);
  v_pay := (r->>'pagamento')::bigint;
  if (r->>'faturas')::int <> 3 or (r->>'valor')::numeric <> 40.00 then raise exception 'FALHOU: resultado do pagamento %', r; end if;
  select count(*) into n from public.invoices where payment_id = v_pay and pagamento = 'CGD' and liquidada_em = '2026-10-31';
  if n <> 3 then raise exception 'FALHOU: % faturas marcadas como liquidadas', n; end if;
  if (select fornecedor from public.invoice_payments where id = v_pay) <> 'Grão de Trigo' then raise exception 'FALHOU: fornecedor do pagamento'; end if;
  if (select bank_transaction_id from public.invoice_payments where id = v_pay) <> v_bank then raise exception 'FALHOU: movimento não ligado'; end if;

  -- Não se liquida duas vezes
  begin
    perform public.liquidar_faturas(v_ids, '2026-10-31', 'Numerário');
    raise exception 'FALHOU: liquidou duas vezes';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;

  -- Anular volta a pôr por pagar
  r := public.anular_pagamento(v_pay);
  if (r->>'faturas')::int <> 3 then raise exception 'FALHOU: anulação %', r; end if;
  if exists (select 1 from public.invoices where id = any(v_ids) and (pagamento <> 'Por pagar' or payment_id is not null or liquidada_em is not null)) then
    raise exception 'FALHOU: anulação não repôs as faturas';
  end if;
  if exists (select 1 from public.invoice_payments where id = v_pay) then raise exception 'FALHOU: pagamento não apagado'; end if;

  -- Em numerário passam a contar como despesa
  r := public.liquidar_faturas(v_ids[2:3], '2026-10-31', 'Numerário');
  select sum(valor) into v_total from public.invoices where pagamento = 'Numerário' and fornecedor = 'Grão de Trigo';
  if v_total <> 27.60 then raise exception 'FALHOU: numerário liquidado soma %', v_total; end if;
end $$;
reset role;

\echo 'Todos os testes de pagamentos passaram.'
