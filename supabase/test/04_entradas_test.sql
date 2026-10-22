-- Testes das entradas do extrato e das transferências da receção. Executado por scripts/test-sql.sh.
\set ON_ERROR_STOP on

-- Administradora importa entradas: uma vai para a receção, outra liga-se a uma transferência registada à mão.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare r jsonb; v_manual bigint; v_desp numeric; v_n int;
begin
  select coalesce(sum(valor), 0) into v_desp from public.bank_transactions;
  insert into public.transferencias (data, valor, ordenante) values ('2026-10-02', 250.00, 'Maria Silva') returning id into v_manual;
  r := public.import_bank_credits(jsonb_build_array(
    jsonb_build_object('import_hash', 'T1', 'data_mov', '2026-10-01', 'descricao', 'TRAVELSCAPE LLC', 'valor', 1830.55, 'tipo', 'Expedia'),
    jsonb_build_object('import_hash', 'T2', 'data_mov', '2026-10-03', 'descricao', 'TRF CRED SEPA JOHN SMITH', 'valor', 120, 'tipo', 'Transferência', 'rececao', true, 'ordenante', 'JOHN SMITH'),
    jsonb_build_object('import_hash', 'T3', 'data_mov', '2026-10-03', 'descricao', 'TRF CRED SEPA MARIA SILVA', 'valor', 250, 'tipo', 'Transferência', 'transferencia_id', v_manual)
  ), 'extrato.xlsx');
  if (r->>'novos')::int <> 3 or (r->>'transferencias')::int <> 1 or (r->>'ligadas')::int <> 1 then raise exception 'FALHOU: importação %', r; end if;
  -- Reimportar não duplica
  r := public.import_bank_credits(jsonb_build_array(jsonb_build_object('import_hash', 'T1', 'data_mov', '2026-10-01', 'descricao', 'TRAVELSCAPE LLC', 'valor', 1830.55)), 'extrato.xlsx');
  if (r->>'novos')::int <> 0 or (r->>'duplicados')::int <> 1 then raise exception 'FALHOU: reimportação %', r; end if;
  -- As entradas nunca entram nas saídas
  if (select coalesce(sum(valor), 0) from public.bank_transactions) <> v_desp then raise exception 'FALHOU: entradas somadas às saídas'; end if;
  select count(*) into v_n from public.transferencias where bank_credit_id is not null;
  if v_n <> 2 then raise exception 'FALHOU: % transferências ligadas ao extrato', v_n; end if;
  if (select ordenante from public.transferencias where id = v_manual) <> 'Maria Silva' then raise exception 'FALHOU: ordenante manual alterado'; end if;
  -- Publicar duas vezes devolve a mesma transferência
  if public.publicar_transferencia((select id from public.bank_credits where import_hash = 'T1'))
     <> public.publicar_transferencia((select id from public.bank_credits where import_hash = 'T1')) then
    raise exception 'FALHOU: publicação duplicada';
  end if;
end $$;
reset role;

-- Receção: vê as transferências e aloca, mas não vê o extrato nem altera valores.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
declare v_id bigint; r jsonb; n int;
begin
  if (select count(*) from public.bank_credits) <> 0 then raise exception 'FALHOU: receção vê as entradas do extrato'; end if;
  select count(*) into n from public.transferencias;
  if n <> 3 then raise exception 'FALHOU: receção vê % transferências', n; end if;
  select id into v_id from public.transferencias where ordenante = 'JOHN SMITH';
  update public.transferencias set valor = 1 where id = v_id;
  if (select valor from public.transferencias where id = v_id) <> 120 then raise exception 'FALHOU: receção alterou o valor'; end if;
  begin
    insert into public.transferencias (data, valor) values ('2026-10-05', 10);
    raise exception 'FALHOU: receção criou uma transferência';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
  r := public.alocar_transferencia(v_id, (select id from public.properties order by id limit 1), ' 12 ', 'BK-4411', 'Pagou o sinal');
  if not (r->>'alocada')::boolean then raise exception 'FALHOU: alocação %', r; end if;
  if not exists (select 1 from public.transferencias where id = v_id and quarto = '12' and reserva = 'BK-4411'
                 and alocada_por = '00000000-0000-0000-0000-00000000000b' and alocada_em is not null) then
    raise exception 'FALHOU: alocação não gravada';
  end if;
  r := public.alocar_transferencia(v_id, null, '', '', null);
  if exists (select 1 from public.transferencias where id = v_id and (alocada_em is not null or quarto is not null)) then
    raise exception 'FALHOU: desalocar';
  end if;
end $$;
reset role;

-- Sem papel (pendente) não vê nem aloca.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', false);
do $$
begin
  if exists (select 1 from public.transferencias) then raise exception 'FALHOU: utilizador sem papel vê transferências'; end if;
  begin
    perform public.alocar_transferencia((select min(id) from public.transferencias), null, '1', null);
    raise exception 'FALHOU: utilizador sem papel alocou';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
end $$;
reset role;

\echo 'Todos os testes de entradas e transferências passaram.'
