-- Testes das caixas vindas da app da receção (supabase/15_caixas_app.sql). Executado por scripts/test-sql.sh.
\set ON_ERROR_STOP on

-- A receção não consegue importar nem ler.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
declare n int;
begin
  begin
    perform public.importar_caixas_app('[]'::jsonb);
    raise exception 'FALHOU: receção importou';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
  select count(*) into n from public.caixa_app_dias;
  if n <> 0 then raise exception 'FALHOU: receção lê os dias'; end if;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare
  r jsonb;
  dias jsonb := $j$[
    {"data": "2026-11-05", "diaFechado": true, "turnos": [], "totais": {}, "documentos": []},
    {"data": "2026-11-06", "diaFechado": false,
     "turnos": [
       {"turno": "7h", "fechado": true, "fechadoEm": "2026-11-06T07:02:00Z", "fechadoPor": "Ana", "fundoInicial": 100, "numerarioEsperado": 180,
        "numerarioContado": 175, "diferenca": -5, "envelope": 75, "fundoSegue": 100, "observacao": "Faltam 5 €",
        "totais": {"numerario": 80, "cartao": 20, "cvVirtual": 120, "multibanco": 30, "transferencia": 0, "expedia": 200, "airbnb": 0, "total": 450, "taxaTuristica": 8, "faturas": 4}},
       {"turno": "15h", "fechado": false, "totais": {"numerario": 10}}
     ],
     "totais": {"numerario": 90, "cartao": 20, "cvVirtual": 120, "multibanco": 30, "expedia": 200, "total": 460},
     "documentos": [
       {"tipo": "fatura_recibo", "numero": "FR 1", "turno": "7h", "valor": 120, "pagamentos": {"cvVirtual": 120}, "cliente": "A"},
       {"tipo": "fatura_recibo", "numero": "FR 2", "turno": "7h", "valor": 200, "pagamentos": {"expedia": 200}, "reserva": "E9"},
       {"tipo": "fatura_recibo", "numero": "FR 3", "turno": "7h", "valor": 50, "pagamentos": {"airbnb": 50}, "anulada": true},
       {"tipo": "fatura_recibo", "numero": "FR 4", "turno": "7h", "valor": 80, "pagamentos": {"numerario": 80}}
     ]}
  ]$j$;
  v_imports int;
  c public.cash_closes;
begin
  select count(*) into v_imports from public.cash_imports;
  r := public.importar_caixas_app(dias, now());
  if (r->>'dias')::int <> 1 or (r->>'ignorados')::int <> 1 then raise exception 'FALHOU: dias antes de 06/11 têm de ser ignorados (%)', r; end if;
  if (r->>'fechos')::int <> 1 then raise exception 'FALHOU: só o turno fechado vai para a Caixa diária (%)', r; end if;
  if exists (select 1 from public.caixa_app_dias where data = '2026-11-05') then raise exception 'FALHOU: guardou dia anterior'; end if;
  select * into c from public.cash_closes where data = '2026-11-06' and turno = '7h';
  if c.origem <> 'app' or c.dinheiro <> 80 or c.cv <> 120 or c.mb <> 50 or c.city_mb <> 0 or c.registos <> 3 then raise exception 'FALHOU: fecho na caixa diária %', to_jsonb(c); end if;
  if exists (select 1 from public.cash_closes where data = '2026-11-06' and turno = '15h') then raise exception 'FALHOU: turno aberto na caixa diária'; end if;
  if (select count(*) from public.caixa_app_pendentes) <> 2 then raise exception 'FALHOU: pendentes (anulada não conta)'; end if;

  -- Conferências da administradora.
  update public.caixa_app_turnos set envelope_recebido = 70, envelope_esperado = 75, envelope_nota = 'faltam 5' where data = '2026-11-06' and turno = '7h';
  update public.caixa_app_dias set tpa_talao = 50 where data = '2026-11-06';
  update public.caixa_app_pendentes set confirmado_em = now(), nota = 'payout' where numero = 'FR 2';

  -- Reimportar o mesmo dia não duplica nem apaga conferências; FR 1 deixa de ter CV (anulada) → sai.
  dias := jsonb_set(dias, '{1,documentos,0,anulada}', 'true');
  dias := jsonb_set(dias, '{1,documentos,1,anulada}', 'true');
  r := public.importar_caixas_app(dias, now());
  if (r->>'fechos')::int <> 0 then raise exception 'FALHOU: fecho igual voltou a importar (%)', r; end if;
  if (select count(*) from public.caixa_app_turnos) <> 2 or (select count(*) from public.caixa_app_dias) <> 1 then raise exception 'FALHOU: duplicou'; end if;
  if (select envelope_recebido from public.caixa_app_turnos where turno = '7h') <> 70 then raise exception 'FALHOU: perdeu o envelope'; end if;
  if (select tpa_talao from public.caixa_app_dias) <> 50 then raise exception 'FALHOU: perdeu o talão'; end if;
  if exists (select 1 from public.caixa_app_pendentes where numero = 'FR 1') then raise exception 'FALHOU: pendente anulado ficou'; end if;
  if not (select anulada from public.caixa_app_pendentes where numero = 'FR 2') then raise exception 'FALHOU: confirmado anulado não marcado'; end if;
  if (select count(*) from public.cash_imports) <> v_imports + 1 then raise exception 'FALHOU: importações na caixa diária'; end if;

  -- Valor do turno muda na app → fecho atualizado (fica no histórico).
  dias := jsonb_set(dias, '{1,turnos,0,totais,numerario}', '85');
  r := public.importar_caixas_app(dias, now());
  if (r->>'fechos')::int <> 1 or (select dinheiro from public.cash_closes where data = '2026-11-06' and turno = '7h') <> 85 then raise exception 'FALHOU: atualização do fecho'; end if;
end $$;
reset role;

-- Limpa para não afetar outros testes.
delete from public.cash_closes where origem = 'app';
delete from public.caixa_app_dias;
select 'caixas app: ok' as resultado;
