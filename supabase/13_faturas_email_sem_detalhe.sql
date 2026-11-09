-- =====================================================================
-- Fatura Chalet — 13 Faturas do email: não guardar anexos de "detalhe"
-- Executar depois do 12 (pode ser executado mais do que uma vez).
--
-- A Vodafone manda a fatura e um "detalhe_fatura_….pdf" (lista de chamadas/consumos).
-- O detalhe não é uma fatura: a função passa a ignorá-lo e os que já estão na fila ficam "ignorada".
-- =====================================================================

create or replace function public.email_anexo_ignorado(p_nome text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_nome, '')) ~ '(^|[^a-z])detalhe'
$$;

create or replace function public.receber_fatura_email(
  p_chave text, p_mensagem_id text, p_nome_ficheiro text, p_mime text, p_conteudo_b64 text,
  p_conta text default null, p_remetente text default null, p_assunto text default null, p_recebido_em timestamptz default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_mime text := lower(coalesce(p_mime, ''));
begin
  if p_chave is null or not exists (select 1 from public.email_faturas_chave where chave = p_chave) then
    raise exception 'Chave inválida.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_mensagem_id), '') = '' or coalesce(btrim(p_nome_ficheiro), '') = '' then
    raise exception 'Falta o id da mensagem ou o nome do ficheiro.';
  end if;
  -- Anexos que não são faturas (ex.: detalhe da Vodafone): aceites mas não guardados.
  if public.email_anexo_ignorado(p_nome_ficheiro) then return 'ignorada'; end if;
  if v_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    if lower(p_nome_ficheiro) like '%.pdf' then v_mime := 'application/pdf';
    else raise exception 'Formato não aceite: %', p_mime; end if;
  end if;
  if coalesce(length(p_conteudo_b64), 0) = 0 then raise exception 'Ficheiro vazio.'; end if;
  if length(p_conteudo_b64) > 7000000 then raise exception 'Ficheiro demasiado grande.'; end if;
  insert into public.email_faturas (mensagem_id, nome_ficheiro, mime, conteudo_b64, tamanho, conta, remetente, assunto, recebido_em)
  values (btrim(p_mensagem_id), btrim(p_nome_ficheiro), v_mime, p_conteudo_b64, (length(p_conteudo_b64) * 3) / 4,
          left(p_conta, 200), left(p_remetente, 300), left(p_assunto, 500), coalesce(p_recebido_em, now()))
  on conflict (mensagem_id, nome_ficheiro) do nothing;
  return case when found then 'recebida' else 'repetida' end;
end $$;
revoke all on function public.receber_fatura_email(text, text, text, text, text, text, text, text, timestamptz) from public;
grant execute on function public.receber_fatura_email(text, text, text, text, text, text, text, text, timestamptz) to anon, authenticated;

update public.email_faturas set estado = 'ignorada', tratado_em = now()
where estado = 'pendente' and public.email_anexo_ignorado(nome_ficheiro);
