-- Testes das regras por fornecedor (supabase/14_regras_fornecedor.sql). Executado por scripts/test-sql.sh.
\set ON_ERROR_STOP on

do $$
begin
  if public.chave_fornecedor('Grão de Trigo, Lda') <> 'graotrigolda' then raise exception 'FALHOU: chave %', public.chave_fornecedor('Grão de Trigo, Lda'); end if;
  if public.chave_fornecedor('GRAOTRIGO LDA') <> 'graotrigolda' then raise exception 'FALHOU: chave sem espaço'; end if;
  if (select count(*) from public.regras_fornecedor) < 2 then raise exception 'FALHOU: regras iniciais'; end if;
end $$;

-- Receção: Grão de Trigo sem categoria e marcada como numerário → pequeno-almoço / pastelaria e por pagar.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
declare n int;
begin
  -- A receção não vê as regras.
  select count(*) into n from public.regras_fornecedor;
  if n <> 0 then raise exception 'FALHOU: receção lê as regras'; end if;
  insert into public.invoices (data, fornecedor, pagamento, valor, origem, estado)
  values ('2026-11-03', 'Graotrigo Lda', 'Numerário', 33.10, 'rececao', 'Por validar');
  insert into public.invoices (data, fornecedor, pagamento, valor, origem, estado)
  values ('2026-11-03', 'Starline', 'CGD', 50, 'rececao', 'Por validar');
end $$;
reset role;
do $$
declare v_cat bigint; v_pag text;
begin
  select categoria_id, pagamento into v_cat, v_pag from public.invoices where fornecedor = 'Graotrigo Lda';
  if v_cat is distinct from (select id from public.categories where nome = 'Pequeno-almoço / pastelaria') then raise exception 'FALHOU: categoria Grão de Trigo'; end if;
  if v_pag <> 'Por pagar' then raise exception 'FALHOU: pagamento Grão de Trigo (%)', v_pag; end if;
  -- Starline: categoria fixa, pagamento o que a receção escolheu.
  select categoria_id, pagamento into v_cat, v_pag from public.invoices where fornecedor = 'Starline';
  if v_cat is distinct from (select id from public.categories where nome = 'Sistema de reservas (Starline)') then raise exception 'FALHOU: categoria Starline'; end if;
  if v_pag <> 'CGD' then raise exception 'FALHOU: pagamento Starline (%)', v_pag; end if;
end $$;

-- Administração: o que escolher no ecrã de revisão fica (a categoria só se preenche se faltar).
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare v_outra bigint := (select id from public.categories where nome = 'Bebidas');
begin
  insert into public.invoices (data, fornecedor, pagamento, valor, origem, estado, categoria_id)
  values ('2026-11-04', 'Grão de Trigo', 'Numerário', 5, 'manual', 'Validada', v_outra);
  if (select pagamento from public.invoices where fornecedor = 'Grão de Trigo' and data = '2026-11-04') <> 'Numerário' then raise exception 'FALHOU: regra mudou o pagamento da administração'; end if;
  if (select categoria_id from public.invoices where fornecedor = 'Grão de Trigo' and data = '2026-11-04') <> v_outra then raise exception 'FALHOU: regra mudou a categoria escolhida'; end if;
  -- Liquidar uma fatura por pagar continua a funcionar (a regra não volta a pôr "Por pagar").
  perform public.liquidar_faturas(array(select id from public.invoices where fornecedor = 'Graotrigo Lda'), '2026-11-30', 'Numerário');
  if (select pagamento from public.invoices where fornecedor = 'Graotrigo Lda') <> 'Numerário' then raise exception 'FALHOU: liquidar'; end if;
end $$;
reset role;

-- Correr o 14 outra vez não duplica regras e corrige faturas antigas sem categoria.
do $$
declare v_padeiro bigint := (select id from public.categories where nome = 'Fornecedor — padeiro / Grão Trigo');
begin
  insert into public.invoices (data, fornecedor, pagamento, valor, origem, estado) values ('2026-10-01', 'X', 'Numerário', 1, 'manual', 'Validada');
  update public.invoices set fornecedor = 'Grao Trigo', categoria_id = v_padeiro where fornecedor = 'X';
  -- A mudança do fornecedor com categoria escolhida mantém a categoria (padeiro); o 14 é que a corrige.
  if (select categoria_id from public.invoices where fornecedor = 'Grao Trigo') <> v_padeiro then raise exception 'FALHOU: preparação'; end if;
end $$;
\ir ../14_regras_fornecedor.sql
do $$
begin
  if (select count(*) from public.regras_fornecedor where chave = 'graotrigo') <> 1 then raise exception 'FALHOU: regra duplicada'; end if;
  if (select categoria_id from public.invoices where fornecedor = 'Grao Trigo') is distinct from (select id from public.categories where nome = 'Pequeno-almoço / pastelaria') then raise exception 'FALHOU: correção das antigas'; end if;
end $$;
-- Limpeza
delete from public.invoice_payments where id in (select payment_id from public.invoices where fornecedor in ('Graotrigo Lda', 'Starline', 'Grão de Trigo', 'Grao Trigo') and data >= '2026-10-01' and payment_id is not null);
delete from public.invoices where fornecedor in ('Graotrigo Lda', 'Starline', 'Grao Trigo') or (fornecedor = 'Grão de Trigo' and data = '2026-11-04');
