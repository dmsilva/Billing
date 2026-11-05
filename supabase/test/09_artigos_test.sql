-- Testes dos artigos lidos das faturas. Executado por scripts/test-sql.sh (depois do 02, que cria os utilizadores).
\set ON_ERROR_STOP on

set role authenticated;
-- Receção: grava as linhas lidas da fatura que acabou de enviar, mas não as vê nem mexe noutras.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
declare v_id bigint; n int; nomes text[];
begin
  insert into public.invoices (data, fornecedor, pagamento, origem, estado)
    values ('2026-10-20', 'Makro', 'Numerário', 'rececao', 'Por validar') returning id into v_id;
  insert into public.invoice_lines (invoice_id, produto, artigo, tipo, quantidade, unidade, valor, fornecedor, data, lido_auto)
    values (v_id, 'MANTEIGA MIMOSA 250G', 'Manteiga', 'Laticínios', 4, 'un', 9.56, 'Makro', '2026-10-20', true);
  select count(*) into n from public.invoice_lines;
  if n <> 0 then raise exception 'FALHOU: receção vê linhas'; end if;
  begin
    insert into public.invoice_lines (invoice_id, produto, lido_auto) values (v_id, 'à mão', false);
    raise exception 'FALHOU: receção gravou linha manual';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.invoice_lines (invoice_id, produto, lido_auto)
      select id, 'x', true from public.invoices where submitted_by is distinct from auth.uid() limit 1;
    if found then raise exception 'FALHOU: receção gravou linha em fatura de outra pessoa'; end if;
  exception when insufficient_privilege then null;
  end;
  nomes := public.artigos_conhecidos();
  if not ('Manteiga' = any(nomes)) then raise exception 'FALHOU: artigos conhecidos (%)', nomes; end if;
end $$;

-- Administração: vê as linhas, marca a fatura como lida e muda o nome do artigo.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare v_id bigint;
begin
  select invoice_id into v_id from public.invoice_lines where artigo = 'Manteiga' limit 1;
  if v_id is null then raise exception 'FALHOU: administração não vê a linha'; end if;
  update public.invoices set artigos_lidos_em = now() where id = v_id;
  update public.invoice_lines set artigo = 'Manteiga com sal' where invoice_id = v_id;
  if not exists (select 1 from public.invoice_lines where artigo = 'Manteiga com sal' and lido_auto) then raise exception 'FALHOU: mudar artigo'; end if;
end $$;

-- Sem sessão não há nomes de artigos.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  if cardinality(public.artigos_conhecidos()) <> 0 then raise exception 'FALHOU: utilizador pendente vê artigos'; end if;
end $$;
reset role;

\echo 'Todos os testes dos artigos das faturas passaram.'
