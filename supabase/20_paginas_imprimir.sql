-- =====================================================================
-- Fatura Chalet — 20 Páginas a imprimir por fornecedor
-- Executar depois do 14 (pode ser executado mais do que uma vez).
--
-- Ao juntar várias faturas num só PDF para imprimir, há fornecedores de que só interessam
-- algumas páginas: a CUR manda 3 e chegam as 2 primeiras (frente e verso), da Vodafone
-- basta a primeira. Fica guardado na regra do fornecedor (página "Categorias e regras"),
-- como "1-2", "1" ou "1,3". Vazio = todas as páginas.
-- =====================================================================

alter table public.regras_fornecedor add column if not exists paginas_imprimir text;
alter table public.regras_fornecedor drop constraint if exists regras_fornecedor_paginas_check;
alter table public.regras_fornecedor add constraint regras_fornecedor_paginas_check
  check (paginas_imprimir is null or paginas_imprimir ~ '^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$');

-- Valores de partida pedidos pelo Daniel: CUR → páginas 1-2; Vodafone → página 1.
-- Se já houver uma regra que apanhe o fornecedor, só se preenche a página (sem mexer no resto).
do $$
declare
  f record;
  n int;
begin
  for f in select * from (values ('CUR Gás Natural', '1-2'), ('Vodafone', '1')) v(nome, paginas) loop
    update public.regras_fornecedor r set paginas_imprimir = f.paginas
     where public.chave_fornecedor(f.nome) like '%' || r.chave || '%' and r.paginas_imprimir is null and length(r.chave) >= 3;
    get diagnostics n = row_count;
    if n = 0 and not exists (select 1 from public.regras_fornecedor r where public.chave_fornecedor(f.nome) like '%' || r.chave || '%') then
      insert into public.regras_fornecedor (fornecedor, paginas_imprimir, nota) values (f.nome, f.paginas, 'Páginas a imprimir');
    end if;
  end loop;
end $$;
