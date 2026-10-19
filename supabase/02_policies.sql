-- =====================================================================
-- FaturaClaro — 2/3 Permissões (Row Level Security) e Storage privado
-- Papéis: admin (administradora: tudo), rececao (só envia faturas), pendente (sem acesso).
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array['profiles', 'properties', 'categories', 'bank_transactions', 'category_changes', 'invoices',
                           'invoice_files', 'invoice_lines', 'cash_closes', 'cash_checks', 'cash_check_history',
                           'tpa_records', 'cash_imports', 'bank_imports', 'legacy_browser_imports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admin_all" on public.%I', t);
    execute format('create policy "admin_all" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Perfis: cada pessoa vê o seu; só a administradora altera papéis (política admin_all).
drop policy if exists "own_profile_read" on public.profiles;
create policy "own_profile_read" on public.profiles for select to authenticated using (id = auth.uid());

-- Receção: precisa da lista de imóveis para o formulário.
drop policy if exists "staff_read_properties" on public.properties;
create policy "staff_read_properties" on public.properties for select to authenticated using (public.is_staff());

-- Receção: cria faturas próprias, sempre "Por validar", e vê apenas as que enviou.
drop policy if exists "rececao_insert_invoice" on public.invoices;
create policy "rececao_insert_invoice" on public.invoices for insert to authenticated
  with check (public.is_staff() and submitted_by = auth.uid() and origem = 'rececao' and estado = 'Por validar'
              and validated_by is null and bank_transaction_id is null);

drop policy if exists "rececao_read_own_invoice" on public.invoices;
create policy "rececao_read_own_invoice" on public.invoices for select to authenticated
  using (public.is_staff() and submitted_by = auth.uid());

drop policy if exists "rececao_insert_file" on public.invoice_files;
create policy "rececao_insert_file" on public.invoice_files for insert to authenticated
  with check (
    public.is_staff() and uploaded_by = auth.uid()
    and exists (select 1 from public.invoices i where i.id = invoice_id and i.submitted_by = auth.uid() and i.estado = 'Por validar')
    and storage_path like auth.uid()::text || '/%'
  );

drop policy if exists "rececao_read_own_file" on public.invoice_files;
create policy "rececao_read_own_file" on public.invoice_files for select to authenticated
  using (public.is_staff() and uploaded_by = auth.uid());

-- Funções: só utilizadores autenticados (e dentro delas exige-se administradora).
revoke all on function public.import_cash_closes(jsonb, text, text) from public, anon;
revoke all on function public.undo_cash_import(bigint) from public, anon;
revoke all on function public.import_bank_transactions(jsonb, text) from public, anon;
grant execute on function public.import_cash_closes(jsonb, text, text) to authenticated;
grant execute on function public.undo_cash_import(bigint) to authenticated;
grant execute on function public.import_bank_transactions(jsonb, text) to authenticated;

-- ---------- Storage: bucket privado "faturas" ----------
-- Caminho dos ficheiros: <id do utilizador>/<id da fatura>/<nome>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('faturas', 'faturas', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "faturas_admin_all" on storage.objects;
create policy "faturas_admin_all" on storage.objects for all to authenticated
  using (bucket_id = 'faturas' and public.is_admin())
  with check (bucket_id = 'faturas' and public.is_admin());

drop policy if exists "faturas_staff_upload" on storage.objects;
create policy "faturas_staff_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'faturas' and public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "faturas_staff_read_own" on storage.objects;
create policy "faturas_staff_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'faturas' and public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text);
