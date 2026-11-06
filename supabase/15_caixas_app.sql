-- =====================================================================
-- Fatura Chalet — 15 Caixas vindas da app de caixa da receção
-- Executar depois do 01 e 02 (pode ser executado mais do que uma vez).
--
-- A partir de 06/11/2026 os fechos de caixa deixam de vir do Excel e passam a vir da app
-- caixa-chaletdavila.netlify.app. A função do Netlify "caixas-app" vai buscar os dias e chama
-- importar_caixas_app(), que:
--   - guarda cada dia, turno e documento tal como a app os envia (sem duplicar: reimportar o
--     mesmo dia atualiza-o);
--   - nunca mexe nas conferências feitas aqui (envelope recebido, talão do TPA, entrada das
--     plataformas);
--   - passa os turnos fechados para a Caixa diária (cash_closes, origem 'app'), para os
--     Resultados continuarem a somar a caixa como antes: Dinheiro = numerário,
--     CV = CV virtual, MB = multibanco + cartão. Transferências, Expedia e Airbnb não entram
--     na caixa (chegam ao banco / PayPal e já contam lá).
-- Os dias anteriores a 06/11/2026 nunca são tocados.
-- =====================================================================

alter table public.cash_closes drop constraint if exists cash_closes_origem_check;
alter table public.cash_closes add constraint cash_closes_origem_check
  check (origem in ('legado', 'excel', 'navegador', 'manual', 'app'));

create or replace function public.caixas_app_inicio()
returns date language sql immutable as $$ select date '2026-11-06' $$;

create table if not exists public.caixa_app_dias (
  data date primary key,
  dia_fechado boolean not null default false,
  totais jsonb not null default '{}'::jsonb,
  documentos jsonb not null default '[]'::jsonb,
  gerado_em timestamptz,                      -- "geradoEm" da app
  importado_em timestamptz not null default now(),
  -- Talão de fecho do TPA do dia (multibanco + cartão), escrito pela administradora.
  tpa_talao numeric(14,2),
  tpa_nota text,
  tpa_por uuid,
  tpa_em timestamptz,
  check (data >= date '2026-11-06')
);

create table if not exists public.caixa_app_turnos (
  id bigint generated always as identity primary key,
  data date not null references public.caixa_app_dias(data) on delete cascade,
  turno text not null check (turno in ('7h', '15h', '23h')),
  fechado boolean not null default false,
  fechado_em timestamptz,
  fechado_por text,
  fundo_inicial numeric(14,2),
  numerario_esperado numeric(14,2),
  numerario_contado numeric(14,2),
  diferenca numeric(14,2),
  envelope numeric(14,2),
  fundo_segue numeric(14,2),
  observacao text,
  totais jsonb not null default '{}'::jsonb,
  importado_em timestamptz not null default now(),
  -- Conferência do envelope (administradora). envelope_esperado guarda o que a app dizia na altura.
  envelope_recebido numeric(14,2) check (envelope_recebido >= 0),
  envelope_esperado numeric(14,2),
  envelope_nota text,
  envelope_por uuid,
  envelope_em timestamptz,
  unique (data, turno)
);

-- Pagamentos por CV virtual, Expedia e Airbnb: ficam pendentes até a administradora confirmar
-- que o dinheiro da plataforma entrou. Uma linha por documento e forma de pagamento.
create table if not exists public.caixa_app_pendentes (
  id bigint generated always as identity primary key,
  data date not null references public.caixa_app_dias(data) on delete cascade,
  numero text not null,
  metodo text not null check (metodo in ('cvVirtual', 'expedia', 'airbnb')),
  tipo text,
  valor numeric(14,2) not null,
  cliente text,
  reserva text,
  quarto text,
  turno text,
  anulada boolean not null default false,     -- o documento foi anulado na app depois de confirmado
  confirmado_em timestamptz,
  confirmado_por uuid,
  nota text,
  unique (numero, metodo)
);
create index if not exists caixa_app_pendentes_abertos_idx on public.caixa_app_pendentes (metodo) where confirmado_em is null;

do $$
declare t text;
begin
  foreach t in array array['caixa_app_dias', 'caixa_app_turnos', 'caixa_app_pendentes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admin_all" on public.%I', t);
    execute format('create policy "admin_all" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function public.caixa_app_num(v jsonb)
returns numeric language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
              when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then (v #>> '{}')::numeric
              else null end
$$;

-- Guarda os dias enviados pela app. p_dias = o array "dias" da resposta de /api/export.
create or replace function public.importar_caixas_app(p_dias jsonb, p_gerado_em timestamptz default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  d jsonb;
  t jsonb;
  doc jsonb;
  m text;
  v_data date;
  v_dias int := 0;
  v_ignorados int := 0;
  v_turnos int := 0;
  v_docs int := 0;
  v_closes jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_import bigint;
  r jsonb;
  cur public.cash_closes;
  v_valor numeric;
  v_chaves text[];
  n int;
begin
  if not public.is_admin() then raise exception 'Apenas a administradora pode importar as caixas.'; end if;
  if jsonb_typeof(p_dias) <> 'array' then raise exception 'Formato inválido: falta a lista de dias.'; end if;

  for d in select * from jsonb_array_elements(p_dias) loop
    v_data := (d->>'data')::date;
    if v_data is null or v_data < public.caixas_app_inicio() or v_data > current_date + 1 then
      v_ignorados := v_ignorados + 1;
      continue;
    end if;
    v_dias := v_dias + 1;
    insert into public.caixa_app_dias (data, dia_fechado, totais, documentos, gerado_em, importado_em)
    values (v_data, coalesce((d->>'diaFechado')::boolean, false), coalesce(d->'totais', '{}'::jsonb),
            coalesce(d->'documentos', '[]'::jsonb), p_gerado_em, now())
    on conflict (data) do update set dia_fechado = excluded.dia_fechado, totais = excluded.totais,
      documentos = excluded.documentos, gerado_em = excluded.gerado_em, importado_em = now();

    for t in select * from jsonb_array_elements(coalesce(d->'turnos', '[]'::jsonb)) loop
      if t->>'turno' not in ('7h', '15h', '23h') then continue; end if;
      v_turnos := v_turnos + 1;
      insert into public.caixa_app_turnos (data, turno, fechado, fechado_em, fechado_por, fundo_inicial, numerario_esperado,
        numerario_contado, diferenca, envelope, fundo_segue, observacao, totais, importado_em)
      values (v_data, t->>'turno', coalesce((t->>'fechado')::boolean, false), nullif(t->>'fechadoEm', '')::timestamptz,
        nullif(t->>'fechadoPor', ''), public.caixa_app_num(t->'fundoInicial'), public.caixa_app_num(t->'numerarioEsperado'),
        public.caixa_app_num(t->'numerarioContado'), public.caixa_app_num(t->'diferenca'), public.caixa_app_num(t->'envelope'),
        public.caixa_app_num(t->'fundoSegue'), nullif(btrim(t->>'observacao'), ''), coalesce(t->'totais', '{}'::jsonb), now())
      on conflict (data, turno) do update set fechado = excluded.fechado, fechado_em = excluded.fechado_em,
        fechado_por = excluded.fechado_por, fundo_inicial = excluded.fundo_inicial, numerario_esperado = excluded.numerario_esperado,
        numerario_contado = excluded.numerario_contado, diferenca = excluded.diferenca, envelope = excluded.envelope,
        fundo_segue = excluded.fundo_segue, observacao = excluded.observacao, totais = excluded.totais, importado_em = now();

      -- Turno fechado → fecho da Caixa diária.
      if coalesce((t->>'fechado')::boolean, false) then
        select count(*) into n from jsonb_array_elements(coalesce(d->'documentos', '[]'::jsonb)) x
          where x->>'turno' = t->>'turno' and not coalesce((x->>'anulada')::boolean, false);
        v_closes := v_closes || jsonb_build_object('data', v_data, 'turno', t->>'turno',
          'dinheiro', coalesce(public.caixa_app_num(t->'totais'->'numerario'), 0),
          'cv', coalesce(public.caixa_app_num(t->'totais'->'cvVirtual'), 0),
          'mb', coalesce(public.caixa_app_num(t->'totais'->'multibanco'), 0) + coalesce(public.caixa_app_num(t->'totais'->'cartao'), 0),
          'city_mb', 0, 'registos', n);
      end if;
    end loop;

    -- Pendentes das plataformas (um por documento e forma de pagamento).
    v_chaves := array[]::text[];
    for doc in select * from jsonb_array_elements(coalesce(d->'documentos', '[]'::jsonb)) loop
      if coalesce(doc->>'numero', '') = '' or coalesce((doc->>'anulada')::boolean, false) then continue; end if;
      foreach m in array array['cvVirtual', 'expedia', 'airbnb'] loop
        v_valor := public.caixa_app_num(doc->'pagamentos'->m);
        if v_valor is null or v_valor = 0 then continue; end if;
        -- Notas de crédito vêm com valor negativo; os pagamentos podem vir positivos.
        if doc->>'tipo' = 'nota_credito' and v_valor > 0 then v_valor := -v_valor; end if;
        v_chaves := v_chaves || (doc->>'numero' || '|' || m);
        v_docs := v_docs + 1;
        insert into public.caixa_app_pendentes (data, numero, metodo, tipo, valor, cliente, reserva, quarto, turno, anulada)
        values (v_data, doc->>'numero', m, doc->>'tipo', v_valor, nullif(doc->>'cliente', ''), nullif(doc->>'reserva', ''),
                nullif(doc->>'quarto', ''), nullif(doc->>'turno', ''), false)
        on conflict (numero, metodo) do update set data = excluded.data, tipo = excluded.tipo, valor = excluded.valor,
          cliente = excluded.cliente, reserva = excluded.reserva, quarto = excluded.quarto, turno = excluded.turno, anulada = false;
      end loop;
    end loop;
    -- Documentos que deixaram de ter estes pagamentos (anulados na app): sai da lista se ainda
    -- não estava confirmado; se já estava, fica marcado como anulado.
    delete from public.caixa_app_pendentes p
      where p.data = v_data and p.confirmado_em is null and not ((p.numero || '|' || p.metodo) = any (v_chaves));
    update public.caixa_app_pendentes p set anulada = true
      where p.data = v_data and p.confirmado_em is not null and not ((p.numero || '|' || p.metodo) = any (v_chaves));
  end loop;

  -- Só os fechos novos ou que mudaram passam pela importação da Caixa diária (fica no histórico e pode ser anulada).
  for r in select * from jsonb_array_elements(v_closes) loop
    select * into cur from public.cash_closes where data = (r->>'data')::date and turno = r->>'turno';
    if not found or cur.dinheiro is distinct from (r->>'dinheiro')::numeric or cur.cv is distinct from (r->>'cv')::numeric
       or cur.mb is distinct from (r->>'mb')::numeric or cur.city_mb is distinct from 0 then
      v_rows := v_rows || r;
    end if;
  end loop;
  if jsonb_array_length(v_rows) > 0 then
    v_import := public.import_cash_closes(v_rows, 'App de caixa da receção', 'app');
  end if;

  return jsonb_build_object('dias', v_dias, 'turnos', v_turnos, 'pendentes', v_docs, 'ignorados', v_ignorados,
                            'fechos', jsonb_array_length(v_rows), 'importacao', v_import);
end $$;
grant execute on function public.importar_caixas_app(jsonb, timestamptz) to authenticated;
