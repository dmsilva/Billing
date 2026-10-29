-- Testes do SAF-T. Executado por scripts/test-sql.sh.
\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare r jsonb;
begin
  -- Agosto: uma fatura sem recibo (paga em setembro).
  r := public.importar_saft('{"ficheiro":"ago.xml","nif":"513102914","inicio":"2026-08-01","fim":"2026-08-31","recibos":0,"total":100}',
    '[{"numero":"FT A/1","tipo":"FT","estado":"N","data":"2026-08-31","cliente":"Ana","total":100,"city_tax":4}]');
  if (r->>'documentos')::int <> 1 then raise exception 'FALHOU: importação de agosto %', r; end if;

  -- Setembro: duas faturas e o recibo da fatura de agosto.
  r := public.importar_saft('{"ficheiro":"set.xml","inicio":"2026-09-01","fim":"2026-09-30","recibos":2,"total":150}',
    '[{"numero":"FT A/2","tipo":"FT","data":"2026-09-01","cliente":"Rui","total":200,"recibos":["RG A/1"],"valor_recebido":200,"meios":["TB"]},
      {"numero":"NC A/1","tipo":"NC","data":"2026-09-02","cliente":"Rui","total":50,"referencias":["FT A/2"]}]',
    '[{"numero":"FT A/1","recibo":"RG A/2","valor":100,"meio":"TB"}]');
  if (r->>'recibos_fora')::int <> 1 then raise exception 'FALHOU: recibo de outro mês %', r; end if;
  if (select valor_recebido from public.saft_documentos where numero = 'FT A/1') <> 100 then raise exception 'FALHOU: valor recebido de agosto'; end if;
  if (select referencias from public.saft_documentos where numero = 'NC A/1') <> array['FT A/2'] then raise exception 'FALHOU: referências da NC'; end if;

  -- Voltar a importar setembro substitui só setembro e não repete o recibo de agosto.
  r := public.importar_saft('{"ficheiro":"set2.xml","inicio":"2026-09-01","fim":"2026-09-30"}',
    '[{"numero":"FT A/2","tipo":"FT","data":"2026-09-01","cliente":"Rui","total":210}]',
    '[{"numero":"FT A/1","recibo":"RG A/2","valor":100,"meio":"TB"}]');
  if (r->>'substituidos')::int <> 2 then raise exception 'FALHOU: substituição %', r; end if;
  if exists (select 1 from public.saft_documentos where numero = 'NC A/1') then raise exception 'FALHOU: NC antiga ficou'; end if;
  if (select total from public.saft_documentos where numero = 'FT A/2') <> 210 then raise exception 'FALHOU: total atualizado'; end if;
  if (select valor_recebido from public.saft_documentos where numero = 'FT A/1') <> 100 then raise exception 'FALHOU: recibo repetido'; end if;

  -- Voltar a importar agosto mantém o recibo que veio do ficheiro de setembro.
  r := public.importar_saft('{"ficheiro":"ago.xml","inicio":"2026-08-01","fim":"2026-08-31"}',
    '[{"numero":"FT A/1","tipo":"FT","data":"2026-08-31","cliente":"Ana","total":100,"city_tax":4}]');
  if (select recibos from public.saft_documentos where numero = 'FT A/1') <> array['RG A/2'] then raise exception 'FALHOU: recibo perdido ao reimportar'; end if;
  if (select valor_recebido from public.saft_documentos where numero = 'FT A/1') <> 100 then raise exception 'FALHOU: valor perdido ao reimportar'; end if;

  begin
    perform public.importar_saft('{"inicio":"2026-09-30","fim":"2026-09-01"}', '[]');
    raise exception 'FALHOU: período invertido aceite';
  exception when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
end $$;

-- A receção não vê nem importa o SAF-T.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
begin
  if exists (select 1 from public.saft_documentos) then raise exception 'FALHOU: receção vê o SAF-T'; end if;
  begin
    perform public.importar_saft('{"inicio":"2026-10-01","fim":"2026-10-31"}', '[]');
    raise exception 'FALHOU: receção importou o SAF-T';
  exception when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
end $$;
reset role;

\echo 'Todos os testes do SAF-T passaram.'
