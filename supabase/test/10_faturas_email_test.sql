-- Testes da fila de faturas do email. Executado por scripts/test-sql.sh (depois do 02, que cria os utilizadores).
\set ON_ERROR_STOP on

-- Sem sessão (programa do Gmail): com a chave certa entra, repetida não duplica, sem chave é recusada.
set role anon;
do $$
declare r text; n int;
begin
  begin
    perform public.receber_fatura_email('errada', 'm1', 'a.pdf', 'application/pdf', 'JVBERi0=');
    raise exception 'FALHOU: aceitou chave errada';
  exception when insufficient_privilege then null;
  end;
  -- O RLS esconde tudo a quem não tem sessão.
  select count(*) into n from public.email_faturas;
  if n <> 0 then raise exception 'FALHOU: anon lê a fila (%)', n; end if;
  select count(*) into n from public.email_faturas_chave;
  if n <> 0 then raise exception 'FALHOU: anon lê a chave'; end if;
end $$;
reset role;
-- A chave só se lê como superutilizador aqui; no Supabase a administração vê-a na página.
select set_config('teste.chave', chave, false) from public.email_faturas_chave;
set role anon;
do $$
declare r text;
begin
  r := public.receber_fatura_email(current_setting('teste.chave'), 'm1', 'fatura.pdf', 'application/octet-stream', 'JVBERi0xLjQ=', 'office@x.pt', 'CUR <no-reply@cur.pt>', 'A sua fatura', now());
  if r <> 'recebida' then raise exception 'FALHOU: primeira receção (%)', r; end if;
  r := public.receber_fatura_email(current_setting('teste.chave'), 'm1', 'fatura.pdf', 'application/pdf', 'JVBERi0xLjQ=');
  if r <> 'repetida' then raise exception 'FALHOU: repetida (%)', r; end if;
  r := public.receber_fatura_email(current_setting('teste.chave'), 'm1', 'detalhe_fatura_20261009.pdf', 'application/pdf', 'JVBERi0xLjQ=');
  if r <> 'ignorada' then raise exception 'FALHOU: detalhe da Vodafone não foi ignorado (%)', r; end if;
  begin
    perform public.receber_fatura_email(current_setting('teste.chave'), 'm2', 'virus.exe', 'application/x-msdownload', 'TVo=');
    raise exception 'FALHOU: aceitou .exe';
  exception when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
end $$;
reset role;

set role authenticated;
-- Receção não vê a fila nem a chave.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare n int; begin
  select count(*) into n from public.email_faturas;
  if n <> 0 then raise exception 'FALHOU: receção vê faturas do email'; end if;
  select count(*) into n from public.email_faturas_chave;
  if n <> 0 then raise exception 'FALHOU: receção vê a chave'; end if;
  begin
    perform public.nova_chave_email_faturas();
    raise exception 'FALHOU: receção mudou a chave';
  exception when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
end $$;

-- Administração: vê a fila, o PDF veio com o tipo certo, marca como ignorada e muda a chave.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ declare v record; c1 text; c2 text; begin
  select * into v from public.email_faturas where mensagem_id = 'm1';
  if v.id is null then raise exception 'FALHOU: administração não vê a fila'; end if;
  if exists (select 1 from public.email_faturas where nome_ficheiro like 'detalhe%') then raise exception 'FALHOU: detalhe ficou guardado'; end if;
  if v.mime <> 'application/pdf' or v.estado <> 'pendente' then raise exception 'FALHOU: tipo/estado (%/%)', v.mime, v.estado; end if;
  update public.email_faturas set estado = 'ignorada', tratado_em = now(), tratado_por = auth.uid() where id = v.id;
  select chave into c1 from public.email_faturas_chave;
  c2 := public.nova_chave_email_faturas();
  if c1 is null or c1 = c2 then raise exception 'FALHOU: nova chave'; end if;
end $$;
reset role;

\echo 'Todos os testes das faturas do email passaram.'
