-- =====================================================================
-- Fatura Chalet — 12 Faturas recebidas por email
-- Executar depois do 01 e 02 (pode ser executado mais do que uma vez).
--
-- Um pequeno programa na conta Google (Apps Script, ver a página "Faturas do email")
-- manda os PDFs/fotos de faturas que chegam ao email para esta fila. Nada vira fatura
-- sozinho: a administração abre cada uma, confirma os campos no ecrã de revisão e grava.
-- =====================================================================

create table if not exists public.email_faturas (
  id bigserial primary key,
  mensagem_id text not null,                 -- id da mensagem no Gmail (evita receber a mesma duas vezes)
  nome_ficheiro text not null,
  mime text not null,
  conteudo_b64 text not null,                -- o ficheiro em base64 (PDF ou foto)
  tamanho int,
  conta text,                                -- caixa de email que recebeu (ex.: officedochalet@gmail.com)
  remetente text,
  assunto text,
  recebido_em timestamptz,
  estado text not null default 'pendente' check (estado in ('pendente', 'gravada', 'ignorada')),
  invoice_id bigint references public.invoices(id) on delete set null,
  tratado_em timestamptz,
  tratado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (mensagem_id, nome_ficheiro)
);
create index if not exists email_faturas_estado_idx on public.email_faturas (estado, recebido_em desc);

alter table public.email_faturas enable row level security;
drop policy if exists "admin_all" on public.email_faturas;
create policy "admin_all" on public.email_faturas for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Chave secreta que o programa do Gmail tem de enviar. Só a administração a vê.
create table if not exists public.email_faturas_chave (
  id int primary key default 1 check (id = 1),
  chave text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  criada_em timestamptz not null default now()
);
insert into public.email_faturas_chave (id) values (1) on conflict (id) do nothing;
alter table public.email_faturas_chave enable row level security;
drop policy if exists "admin_select" on public.email_faturas_chave;
create policy "admin_select" on public.email_faturas_chave for select to authenticated using (public.is_admin());
drop policy if exists "admin_update" on public.email_faturas_chave;
create policy "admin_update" on public.email_faturas_chave for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Chamada pelo programa do Gmail (sem sessão). Só aceita com a chave certa e só acrescenta à fila.
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
  if v_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    if lower(p_nome_ficheiro) like '%.pdf' then v_mime := 'application/pdf';
    else raise exception 'Formato não aceite: %', p_mime; end if;
  end if;
  if coalesce(length(p_conteudo_b64), 0) = 0 then raise exception 'Ficheiro vazio.'; end if;
  -- Até cerca de 5 MB por ficheiro (é o que a leitura automática aceita).
  if length(p_conteudo_b64) > 7000000 then raise exception 'Ficheiro demasiado grande.'; end if;
  insert into public.email_faturas (mensagem_id, nome_ficheiro, mime, conteudo_b64, tamanho, conta, remetente, assunto, recebido_em)
  values (btrim(p_mensagem_id), btrim(p_nome_ficheiro), v_mime, p_conteudo_b64, (length(p_conteudo_b64) * 3) / 4,
          left(p_conta, 200), left(p_remetente, 300), left(p_assunto, 500), coalesce(p_recebido_em, now()))
  on conflict (mensagem_id, nome_ficheiro) do nothing;
  return case when found then 'recebida' else 'repetida' end;
end $$;
revoke all on function public.receber_fatura_email(text, text, text, text, text, text, text, text, timestamptz) from public;
grant execute on function public.receber_fatura_email(text, text, text, text, text, text, text, text, timestamptz) to anon, authenticated;

-- Gerar uma chave nova (se a antiga tiver sido partilhada por engano). O programa do Gmail tem de ser atualizado.
create or replace function public.nova_chave_email_faturas()
returns text language plpgsql security definer set search_path = public as $$
declare v text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_admin() then raise exception 'Apenas a administradora pode mudar a chave.'; end if;
  update public.email_faturas_chave set chave = v, criada_em = now() where id = 1;
  return v;
end $$;
revoke all on function public.nova_chave_email_faturas() from public, anon;
grant execute on function public.nova_chave_email_faturas() to authenticated;
