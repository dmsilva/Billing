-- Testes do histórico de salários para o banco. Executado por scripts/test-sql.sh.
\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
begin
  insert into public.salarios_banco_envios (mes, nome_ficheiro, linhas, total, tsv)
    values ('2026-10', 'Ordenados_Chalet_Outubro_2026.tsv', '[{"nome":"Ana","valor":100}]', 100, E'PT50\tAna\tBIC\t100.00\r\n');
  if (select count(*) from public.salarios_banco_envios) <> 1 then raise exception 'FALHOU: gravar envio'; end if;
  if (select created_by from public.salarios_banco_envios limit 1) is distinct from '00000000-0000-0000-0000-00000000000a' then raise exception 'FALHOU: autor'; end if;
  begin
    insert into public.salarios_banco_envios (mes, nome_ficheiro, tsv) values ('2026-13', 'x', '');
    raise exception 'FALHOU: mês inválido aceite';
  exception when check_violation then null;
  end;
end $$;

-- A receção não vê nem grava envios (têm IBANs).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
begin
  if exists (select 1 from public.salarios_banco_envios) then raise exception 'FALHOU: receção vê envios'; end if;
  begin
    insert into public.salarios_banco_envios (mes, nome_ficheiro, tsv) values ('2026-10', 'x', '');
    raise exception 'FALHOU: receção gravou envio';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'Todos os testes do histórico de salários passaram.'
