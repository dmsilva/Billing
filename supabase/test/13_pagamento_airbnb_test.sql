-- Testes do pagamento "Airbnb" (supabase/17_pagamento_airbnb.sql). Executado por scripts/test-sql.sh.
\set ON_ERROR_STOP on

-- Receção envia um documento da Airbnb e escolhe numerário → fica "Airbnb" pela regra.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into public.invoices (data, fornecedor, pagamento, valor, origem, estado)
values ('2026-11-13', 'Airbnb Ireland UC', 'Numerário', 42.50, 'rececao', 'Por validar');
-- E pode escolher "Airbnb" diretamente.
insert into public.invoices (data, fornecedor, pagamento, valor, origem, estado)
values ('2026-11-13', 'Reserva HM123', 'Airbnb', 120, 'rececao', 'Por validar');
reset role;
do $$
begin
  if (select pagamento from public.invoices where fornecedor = 'Airbnb Ireland UC') <> 'Airbnb' then raise exception 'FALHOU: regra Airbnb'; end if;
  if (select pagamento from public.invoices where fornecedor = 'Reserva HM123') <> 'Airbnb' then raise exception 'FALHOU: escolha Airbnb'; end if;
end $$;

-- Antigas em numerário passam a Airbnb ao voltar a correr o 17.
update public.invoices set pagamento = 'Numerário' where fornecedor = 'Airbnb Ireland UC';
\i supabase/17_pagamento_airbnb.sql
do $$
begin
  if (select pagamento from public.invoices where fornecedor = 'Airbnb Ireland UC') <> 'Airbnb' then raise exception 'FALHOU: conversão das antigas'; end if;
end $$;
delete from public.invoices where fornecedor in ('Airbnb Ireland UC', 'Reserva HM123');

-- Nota de crédito: a receção grava com valor negativo (supabase/18_notas_credito.sql).
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into public.invoices (data, fornecedor, pagamento, valor, iva, origem, estado)
values ('2026-11-13', 'Loja NC', 'Numerário', -10.50, -1.96, 'rececao', 'Por validar');
reset role;
delete from public.invoices where fornecedor = 'Loja NC';
