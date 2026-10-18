-- =====================================================================
-- FaturaClaro — Verificação (opcional, só leitura)
-- Mostra contagens e totais para comparar com o HTML legado.
-- =====================================================================
select 'Movimentos CGD (legado)' as conjunto, count(*) as registos, sum(valor) as total
  from public.bank_transactions where origem = 'legado'
union all
select 'Despesas CGD (sem transferências entre empresas)', count(*), sum(t.valor)
  from public.bank_transactions t join public.categories c on c.id = t.categoria_id where c.conta_como_despesa
union all
select 'Faturas em numerário', count(*), sum(valor)
  from public.invoices where pagamento = 'Numerário' and estado <> 'Rejeitada'
union all
select 'Linhas de produtos', count(*), sum(valor) from public.invoice_lines
union all
select 'Fechos de caixa', count(*), sum(dinheiro + cv + mb + city_mb) from public.cash_closes
union all
select 'Conferências registadas', count(*), sum(diferenca) from public.cash_checks;

-- Utilizadoras e papéis
select email, nome, role from public.profiles order by role, email;
