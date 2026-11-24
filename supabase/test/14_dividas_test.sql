-- Testes das dívidas e adiantamentos dos colaboradores. Executado por scripts/test-sql.sh.
\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
begin
  insert into public.colaboradores_movimentos (pessoa, tipo, data, valor) values ('Fábio', 'divida', '2026-04-17', 1000);
  insert into public.colaboradores_movimentos (pessoa, tipo, forma, data, horas, valor_hora, valor) values ('Fábio', 'pagamento', 'horas', '2026-08-31', 16, 7, 112);
  insert into public.colaboradores_movimentos (pessoa, tipo, data, valor, descontar_mes) values ('Fábio', 'adiantamento', '2026-11-10', 425, '2026-11');
  if (select count(*) from public.colaboradores_movimentos) <> 3 then raise exception 'FALHOU: gravar movimentos'; end if;
  begin
    insert into public.colaboradores_movimentos (pessoa, tipo, valor) values ('Fábio', 'adiantamento', 100);
    raise exception 'FALHOU: adiantamento sem mês aceite';
  exception when check_violation then null;
  end;
  begin
    insert into public.colaboradores_movimentos (pessoa, tipo, forma, valor) values ('Fábio', 'pagamento', 'horas', 10);
    raise exception 'FALHOU: pagamento por horas sem horas aceite';
  exception when check_violation then null;
  end;
  begin
    insert into public.colaboradores_movimentos (pessoa, tipo, valor) values ('Fábio', 'pagamento', 10);
    raise exception 'FALHOU: pagamento sem forma aceite';
  exception when check_violation then null;
  end;
  begin
    insert into public.colaboradores_movimentos (pessoa, tipo, valor) values ('Fábio', 'divida', 0);
    raise exception 'FALHOU: valor zero aceite';
  exception when check_violation then null;
  end;
end $$;

-- A receção não vê nem grava.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
begin
  if exists (select 1 from public.colaboradores_movimentos) then raise exception 'FALHOU: receção vê dívidas'; end if;
  begin
    insert into public.colaboradores_movimentos (pessoa, tipo, valor) values ('X', 'divida', 1);
    raise exception 'FALHOU: receção gravou dívida';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'Todos os testes das dívidas dos colaboradores passaram.'
