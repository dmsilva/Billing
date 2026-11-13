-- =====================================================================
-- Fatura Chalet — 17 Pagamento "Airbnb" nas faturas
-- Executar depois do 05 e do 14 (pode ser executado mais do que uma vez).
--
-- A receção envia documentos da Airbnb e escolhia "Numerário" por não haver outra opção, o que
-- os somava às despesas em dinheiro. Passa a haver o pagamento "Airbnb": fica registado e visível
-- em Faturas, mas não soma ao numerário nem à CGD (a Airbnb transfere o valor já sem comissões).
-- =====================================================================

alter table public.invoices drop constraint if exists invoices_pagamento_check;
alter table public.invoices add constraint invoices_pagamento_check
  check (pagamento in ('CGD', 'Numerário', 'Por pagar', 'Airbnb'));

alter table public.regras_fornecedor drop constraint if exists regras_fornecedor_pagamento_check;
alter table public.regras_fornecedor add constraint regras_fornecedor_pagamento_check
  check (pagamento in ('Por pagar', 'CGD', 'Numerário', 'Airbnb'));

-- Regra: qualquer fatura nova da Airbnb enviada pela receção fica logo com pagamento "Airbnb",
-- mesmo que escolham outra opção.
insert into public.regras_fornecedor (fornecedor, pagamento, nota)
values ('Airbnb', 'Airbnb', 'Documentos da Airbnb: pagos/descontados pela Airbnb, não saem da caixa.')
on conflict (chave) do update set pagamento = 'Airbnb';

-- As que a receção já enviou como "Numerário" (fornecedor com "Airbnb") passam a "Airbnb".
update public.invoices
set pagamento = 'Airbnb'
where pagamento = 'Numerário'
  and public.chave_fornecedor(fornecedor) like '%airbnb%'
  and payment_id is null;

-- Resultado: faturas da Airbnb registadas.
select data, fornecedor, documento, valor, pagamento, estado, origem
from public.invoices
where public.chave_fornecedor(fornecedor) like '%airbnb%'
order by data desc;
