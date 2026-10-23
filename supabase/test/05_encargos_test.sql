-- Testes dos encargos com pessoal (TSU e IRS). Executado por scripts/test-sql.sh.
\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
begin
  insert into public.encargos_pessoal (mes, tsu, irs) values ('2026-09', 2100.50, 640);
  update public.encargos_pessoal set tsu = 2200 where mes = '2026-09';
  if (select tsu from public.encargos_pessoal where mes = '2026-09') <> 2200 then raise exception 'FALHOU: atualização'; end if;
  begin
    insert into public.encargos_pessoal (mes, tsu) values ('2026-13', 1);
    raise exception 'FALHOU: mês inválido aceite';
  exception when check_violation then null;
  end;
end $$;

-- A receção não vê nem altera os encargos.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
begin
  if exists (select 1 from public.encargos_pessoal) then raise exception 'FALHOU: receção vê encargos'; end if;
  begin
    insert into public.encargos_pessoal (mes, tsu) values ('2026-10', 1);
    raise exception 'FALHOU: receção gravou encargos';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'Todos os testes de encargos com pessoal passaram.'
