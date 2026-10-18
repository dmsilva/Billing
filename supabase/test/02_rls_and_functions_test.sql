-- Testes de permissões (RLS), Storage e funções. Executado por scripts/test-sql.sh.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'patricia@exemplo.pt'),
  ('00000000-0000-0000-0000-00000000000b', 'rececao@exemplo.pt'),
  ('00000000-0000-0000-0000-00000000000c', 'novo@exemplo.pt');
update public.profiles set role = 'admin' where email = 'patricia@exemplo.pt';
update public.profiles set role = 'rececao' where email = 'rececao@exemplo.pt';

-- Não é possível ficar sem administradora
do $$ begin
  begin
    update public.profiles set role = 'rececao' where email = 'patricia@exemplo.pt';
    raise exception 'FALHOU: permitiu retirar a única administradora';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
end $$;

-- ---------- Receção ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);

do $$
declare v_id bigint; n int;
begin
  select count(*) into n from public.bank_transactions;
  if n <> 0 then raise exception 'FALHOU: receção vê % movimentos CGD', n; end if;
  select count(*) into n from public.cash_closes;
  if n <> 0 then raise exception 'FALHOU: receção vê fechos de caixa'; end if;
  select count(*) into n from public.invoices;
  if n <> 0 then raise exception 'FALHOU: receção vê faturas de outros (%)', n; end if;
  select count(*) into n from public.properties;
  if n <> 2 then raise exception 'FALHOU: receção devia ver os 2 imóveis, vê %', n; end if;

  insert into public.invoices (data, fornecedor, pagamento, origem, estado, enviado_por)
  values ('2026-10-10', 'Pingo Doce', 'Numerário', 'rececao', 'Por validar', 'Ana') returning id into v_id;
  insert into public.invoice_files (invoice_id, storage_path, nome_ficheiro, mime)
  values (v_id, '00000000-0000-0000-0000-00000000000b/' || v_id || '/foto.jpg', 'foto.jpg', 'image/jpeg');
  insert into storage.objects (bucket_id, name) values ('faturas', '00000000-0000-0000-0000-00000000000b/' || v_id || '/foto.jpg');

  select count(*) into n from public.invoices;
  if n <> 1 then raise exception 'FALHOU: receção devia ver a sua fatura'; end if;

  begin
    insert into public.invoices (data, fornecedor, pagamento, origem, estado) values ('2026-10-10', 'X', 'Numerário', 'rececao', 'Validada');
    raise exception 'FALHOU: receção criou fatura já validada';
  exception when insufficient_privilege then null; end;

  begin
    insert into storage.objects (bucket_id, name) values ('faturas', '00000000-0000-0000-0000-00000000000a/1/x.jpg');
    raise exception 'FALHOU: receção escreveu na pasta de outra pessoa';
  exception when insufficient_privilege then null; end;

  update public.invoices set valor = 1000, estado = 'Validada' where id = v_id;
  if exists (select 1 from public.invoices where id = v_id and estado = 'Validada') then
    raise exception 'FALHOU: receção validou a própria fatura';
  end if;

  update public.profiles set role = 'admin' where id = auth.uid();
  if public.my_role() <> 'rececao' then raise exception 'FALHOU: receção promoveu-se a administradora'; end if;

  begin
    perform public.import_cash_closes('[{"data":"2026-10-01","turno":"7h","dinheiro":1}]'::jsonb, 'x.xlsx');
    raise exception 'FALHOU: receção importou caixa';
  exception when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
end $$;

-- ---------- Utilizador pendente ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$
declare n int;
begin
  select count(*) into n from public.properties;
  if n <> 0 then raise exception 'FALHOU: pendente vê imóveis'; end if;
  begin
    insert into public.invoices (data, fornecedor, pagamento, origem, estado) values ('2026-10-10', 'X', 'Numerário', 'rececao', 'Por validar');
    raise exception 'FALHOU: pendente criou fatura';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- Anónimo ----------
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare n int;
begin
  select count(*) into n from public.invoices;
  if n <> 0 then raise exception 'FALHOU: anónimo vê faturas'; end if;
  select count(*) into n from storage.objects;
  if n <> 0 then raise exception 'FALHOU: anónimo vê ficheiros'; end if;
end $$;

-- ---------- Administradora ----------
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare n int; v_imp bigint; v_close bigint; r jsonb; v_check bigint;
begin
  select count(*) into n from public.bank_transactions;
  if n <> 143 then raise exception 'FALHOU: administradora vê % movimentos', n; end if;
  select count(*) into n from storage.objects;
  if n <> 1 then raise exception 'FALHOU: administradora devia ver o ficheiro da receção'; end if;

  -- Alteração de categoria fica registada
  update public.bank_transactions set categoria_id = (select id from public.categories where nome = 'Salários')
  where descricao like 'PATR CIA PEREIRA ORDE%';
  select count(*) into n from public.category_changes where para = 'Salários' and de = 'Outros / por classificar';
  if n <> 1 then raise exception 'FALHOU: alteração de categoria não registada'; end if;

  -- Conferência com diferença e correção, com histórico
  select id into v_close from public.cash_closes where data = '2026-01-03' and turno = '7h';
  insert into public.cash_checks (cash_close_id, tipo, valor_esperado, valor_real) values (v_close, 'cv', 165.642, 165.642);
  insert into public.cash_checks (cash_close_id, tipo, valor_esperado, valor_real) values (v_close, 'dinheiro', 10, 8.5) returning id into v_check;
  if (select diferenca from public.cash_checks where id = v_check) <> -1.5 then raise exception 'FALHOU: diferença mal calculada'; end if;
  update public.cash_checks set valor_real = 10 where id = v_check;
  select count(*) into n from public.cash_check_history where cash_check_id = v_check;
  if n <> 2 then raise exception 'FALHOU: histórico da conferência tem % registos', n; end if;
  if (select valor_real_anterior from public.cash_check_history where cash_check_id = v_check and acao = 'corrigido') <> 8.5 then
    raise exception 'FALHOU: valor anterior não guardado';
  end if;

  -- Importação: 1 novo, 1 alterado, 1 igual; depois anulação repõe tudo
  v_imp := public.import_cash_closes('[
    {"data":"2026-10-01","turno":"7h","dinheiro":10,"cv":20,"mb":30,"city_mb":0,"registos":3},
    {"data":"2026-07-02","turno":"23h","dinheiro":300,"cv":1192.18,"mb":364.92,"city_mb":0},
    {"data":"2026-01-01","turno":"7h","dinheiro":16,"cv":210.68,"mb":262,"city_mb":0}
  ]'::jsonb, 'teste.xlsx');
  select to_jsonb(i) into r from public.cash_imports i where id = v_imp;
  if (r->>'novos')::int <> 1 or (r->>'alterados')::int <> 1 or (r->>'iguais')::int <> 1 then raise exception 'FALHOU: contagens da importação %', r; end if;
  if (select dinheiro from public.cash_closes where data = '2026-07-02' and turno = '23h') <> 300 then raise exception 'FALHOU: fecho não atualizado'; end if;
  r := public.undo_cash_import(v_imp);
  if (select dinheiro from public.cash_closes where data = '2026-07-02' and turno = '23h') <> 251.95 then raise exception 'FALHOU: anulação não repôs o valor'; end if;
  if exists (select 1 from public.cash_closes where data = '2026-10-01') then raise exception 'FALHOU: anulação não removeu o fecho novo'; end if;
  if (select origem from public.cash_closes where data = '2026-07-02' and turno = '23h') <> 'legado' then raise exception 'FALHOU: origem não reposta'; end if;

  -- Extrato: reimportar um movimento legado não duplica
  r := public.import_bank_transactions(jsonb_build_array(
    jsonb_build_object('import_hash', (select import_hash from public.bank_transactions where legacy_idx = 0),
      'data_mov', '2026-07-01', 'descricao', 'BBVA IFIC', 'valor', 402.31, 'saldo', 57086.61),
    jsonb_build_object('import_hash', '2026-08-01|NOVO|10.00|', 'data_mov', '2026-08-01', 'descricao', 'NOVO', 'valor', 10)
  ), 'extrato.csv');
  if (r->>'novos')::int <> 1 or (r->>'duplicados')::int <> 1 then raise exception 'FALHOU: importação de extrato %', r; end if;
end $$;
reset role;

\echo 'Todos os testes de permissões e funções passaram.'
