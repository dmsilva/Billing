-- =====================================================================
-- FaturaClaro — 8 SAF-T (faturação oficial)
-- Executar depois do 01 e 02 (pode ser executado mais do que uma vez).
--
-- O ficheiro SAF-T exportado do programa de faturação é a referência do que foi
-- faturado. Cada importação substitui os documentos do período do ficheiro, para se
-- poder voltar a importar o mesmo mês depois de correções.
-- =====================================================================

create table if not exists public.saft_imports (
  id bigint generated always as identity primary key,
  ficheiro text,
  nif text,
  empresa text,
  inicio date not null,
  fim date not null,
  documentos int not null default 0,
  recibos int not null default 0,
  total numeric(14,2) not null default 0,     -- faturado do período (faturas − notas de crédito, sem anuladas)
  importado_por uuid default auth.uid() references auth.users(id) on delete set null,
  importado_em timestamptz not null default now()
);

create table if not exists public.saft_documentos (
  id bigint generated always as identity primary key,
  numero text not null unique,                -- ex.: FT A/50242
  tipo text not null,                         -- FT, FS, FR, NC, ND
  estado text not null default 'N',           -- N normal, A anulado, F faturado
  data date not null,
  cliente text,
  nif_cliente text,
  liquido numeric(14,2) not null default 0,
  iva numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,     -- sempre positivo; as notas de crédito subtraem na aplicação
  city_tax numeric(14,2) not null default 0,  -- taxa turística incluída no total
  canal text,                                 -- Airbnb, Expedia, Booking, Grupo… quando o documento o indica
  referencias text[] not null default '{}',   -- faturas corrigidas por uma nota de crédito
  recibos text[] not null default '{}',
  valor_recebido numeric(14,2) not null default 0,
  meios text[] not null default '{}',         -- meios de pagamento indicados nos recibos (NU, CC, CD, MB, TB…)
  import_id bigint references public.saft_imports(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists saft_documentos_data_idx on public.saft_documentos (data);

-- Importa um SAF-T. p_info: { ficheiro, nif, empresa, inicio, fim, recibos, total }.
-- p_docs: documentos do período. p_recibos_fora: recibos deste ficheiro que pagam
-- documentos de meses anteriores ([{ numero, recibo, valor, meio }]).
create or replace function public.importar_saft(p_info jsonb, p_docs jsonb, p_recibos_fora jsonb default '[]'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_import bigint;
  v_inicio date := (p_info->>'inicio')::date;
  v_fim date := (p_info->>'fim')::date;
  v_apagados int;
  v_novos int;
  v_fora int := 0;
  v_antigos jsonb;
  r jsonb;
begin
  if not public.is_admin() then raise exception 'Apenas a administradora pode importar o SAF-T.'; end if;
  if v_inicio is null or v_fim is null or v_fim < v_inicio then raise exception 'Período do SAF-T inválido.'; end if;

  insert into public.saft_imports (ficheiro, nif, empresa, inicio, fim, documentos, recibos, total)
  values (p_info->>'ficheiro', p_info->>'nif', p_info->>'empresa', v_inicio, v_fim,
          jsonb_array_length(coalesce(p_docs, '[]'::jsonb)), coalesce((p_info->>'recibos')::int, 0), coalesce((p_info->>'total')::numeric, 0))
  returning id into v_import;

  -- Recibos de meses seguintes já gravados nos documentos deste período não se perdem.
  select coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'recibos', recibos, 'valor', valor_recebido, 'meios', meios)), '[]'::jsonb)
    into v_antigos
    from public.saft_documentos where data between v_inicio and v_fim and cardinality(recibos) > 0;

  delete from public.saft_documentos where data between v_inicio and v_fim;
  get diagnostics v_apagados = row_count;

  insert into public.saft_documentos (numero, tipo, estado, data, cliente, nif_cliente, liquido, iva, total, city_tax, canal, referencias, recibos, valor_recebido, meios, import_id)
  select d->>'numero', d->>'tipo', coalesce(nullif(d->>'estado', ''), 'N'), (d->>'data')::date, d->>'cliente', d->>'nif_cliente',
         coalesce((d->>'liquido')::numeric, 0), coalesce((d->>'iva')::numeric, 0), coalesce((d->>'total')::numeric, 0),
         coalesce((d->>'city_tax')::numeric, 0), nullif(d->>'canal', ''),
         coalesce(array(select jsonb_array_elements_text(d->'referencias')), '{}'),
         coalesce(array(select jsonb_array_elements_text(d->'recibos')), '{}'),
         coalesce((d->>'valor_recebido')::numeric, 0),
         coalesce(array(select jsonb_array_elements_text(d->'meios')), '{}'),
         v_import
    from jsonb_array_elements(coalesce(p_docs, '[]'::jsonb)) d
  on conflict (numero) do update set tipo = excluded.tipo, estado = excluded.estado, data = excluded.data, cliente = excluded.cliente,
    nif_cliente = excluded.nif_cliente, liquido = excluded.liquido, iva = excluded.iva, total = excluded.total, city_tax = excluded.city_tax,
    canal = excluded.canal, referencias = excluded.referencias, recibos = excluded.recibos, valor_recebido = excluded.valor_recebido,
    meios = excluded.meios, import_id = excluded.import_id;
  get diagnostics v_novos = row_count;

  -- Junta os recibos que já existiam (vindos de ficheiros de meses seguintes) e que este ficheiro não tem.
  update public.saft_documentos d
     set recibos = d.recibos || array(select x from unnest(a.recibos) x where x <> all(d.recibos)),
         valor_recebido = greatest(d.valor_recebido, a.valor),
         meios = d.meios || array(select x from unnest(a.meios) x where x <> all(d.meios))
    from jsonb_to_recordset(v_antigos) as a(numero text, recibos text[], valor numeric, meios text[])
   where a.numero = d.numero and exists (select 1 from unnest(a.recibos) x where x <> all(d.recibos));

  -- Recibos deste ficheiro que pagam documentos de períodos anteriores.
  for r in select * from jsonb_array_elements(coalesce(p_recibos_fora, '[]'::jsonb)) loop
    update public.saft_documentos
       set recibos = recibos || array[r->>'recibo'],
           valor_recebido = valor_recebido + coalesce((r->>'valor')::numeric, 0),
           meios = case when nullif(r->>'meio', '') is null or (r->>'meio') = any(meios) then meios else meios || array[r->>'meio'] end
     where numero = r->>'numero' and not ((r->>'recibo') = any(recibos));
    if found then v_fora := v_fora + 1; end if;
  end loop;

  return jsonb_build_object('import_id', v_import, 'documentos', v_novos, 'substituidos', v_apagados, 'recibos_fora', v_fora);
end $$;

alter table public.saft_imports enable row level security;
alter table public.saft_documentos enable row level security;
drop policy if exists "admin_all" on public.saft_imports;
create policy "admin_all" on public.saft_imports for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all" on public.saft_documentos;
create policy "admin_all" on public.saft_documentos for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on function public.importar_saft(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.importar_saft(jsonb, jsonb, jsonb) to authenticated;

-- ---------- Sincronização em tempo real ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['saft_imports', 'saft_documentos'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
