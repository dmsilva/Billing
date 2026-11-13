-- =====================================================================
-- Fatura Chalet — 18 Notas de crédito (anulações)
-- Executar depois do 01 (pode ser executado mais do que uma vez).
--
-- Uma nota de crédito anula (total ou parcialmente) uma fatura: grava-se com valor e IVA
-- negativos, para abater e nunca contar como entrada nem como despesa nova.
-- =====================================================================

alter table public.invoices drop constraint if exists invoices_valor_check;
alter table public.invoices drop constraint if exists invoices_iva_check;
