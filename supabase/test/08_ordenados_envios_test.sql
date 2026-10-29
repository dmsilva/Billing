-- Testes do histórico de ordenados para a contabilidade. Executado por scripts/test-sql.sh.
\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
begin
  insert into public.ordenados_envios (mes, nome_ficheiro, linhas, excel_base64, pdf_base64)
    values ('2026-10', 'Ordenados_contabilidade_Outubro_2026', '[{"nome":"Ana","feriados":1}]', 'UEs=', 'JVBERg==');
  if (select count(*) from public.ordenados_envios) <> 1 then raise exception 'FALHOU: gravar envio'; end if;
  begin
    insert into public.ordenados_envios (mes, nome_ficheiro) values ('2026-00', 'x');
    raise exception 'FALHOU: mês inválido aceite';
  exception when check_violation then null;
  end;
end $$;

-- A receção não vê nem grava envios.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
begin
  if exists (select 1 from public.ordenados_envios) then raise exception 'FALHOU: receção vê envios'; end if;
  begin
    insert into public.ordenados_envios (mes, nome_ficheiro) values ('2026-10', 'x');
    raise exception 'FALHOU: receção gravou envio';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'Todos os testes do histórico de ordenados passaram.'
