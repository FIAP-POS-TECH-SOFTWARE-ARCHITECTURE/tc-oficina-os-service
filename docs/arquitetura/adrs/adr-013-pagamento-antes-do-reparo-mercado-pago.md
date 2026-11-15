# ADR-013: Pagamento antes do reparo, com Mercado Pago Checkout Pro

- **Status:** Aceita
- **Data:** 2026-11-12

## Contexto

O enunciado põe "registro e verificação de pagamentos" no Billing e pede integração com o
Mercado Pago. A Saga ([ADR-008](adr-008-saga-orquestrada.md)) precisa de rollback e compensação
em caso de falha em qualquer etapa — e o momento do pagamento define o que dá para desfazer.

Se o pagamento ficasse para a entrega, uma falha no reparo não teria dinheiro a devolver, e o
pagamento seria o último passo, depois de todo o trabalho feito. Se vier antes do reparo, a
compensação de um reparo inviável inclui devolver o dinheiro.

## Decisão

- **Pagamento antecipado**: o cliente aprova o orçamento, paga, e só então o orquestrador envia
  `IniciarReparo`. É o último passo antes do reparo (Visão Pessimista, ver ADR-008). Se o reparo
  se mostrar inviável (`ReparoInviavel`), a compensação estorna o pagamento
  (`EstornarPagamento`), cancela o orçamento e estorna a reserva de estoque.
- **Mercado Pago Checkout Pro, pela API de Orders**: na aprovação, o Billing cria uma order
  (`external_reference` = id do orçamento, chave de idempotência `order-<orcamentoId>`) e
  devolve ao cliente o `checkout_url` como `linkPagamento`. A order expira junto com o prazo de
  pagamento da Saga (`expiration_time`), para que um pagamento não seja aceito depois de o fluxo
  desistir; meios de pagamento offline (boleto, lotérica) ficam de fora porque podem aprovar
  depois do prazo.
- **Webhook assinado + consulta à API**: o Mercado Pago notifica
  `POST /billing/webhooks/mercado-pago` (rota pública no API Gateway, sem authorizer). O Billing
  valida o header `x-signature` e **não confia no payload**: consulta o pagamento na API do
  Mercado Pago antes de registrar o resultado. A notificação é deduplicada (item
  `WEBHOOK#<pagamentoId>#<status>`) e só então sai `PagamentoConfirmado`. Se a notificação se
  perder, a equipe aciona a reconciliação (`POST /billing/orcamentos/:numeroOs/reconciliar`),
  que busca as orders do orçamento e aplica as mesmas regras.
- **Estorno automático de pagamento não aplicável**: pagamento que chega para um orçamento que
  não pode recebê-lo (por exemplo ainda aguardando aprovação ou rejeitado), duplicado ou com
  valor divergente é estornado pelo próprio Billing. Pagamento que chega depois de o orçamento
  ser cancelado é registrado e publicado como `PagamentoConfirmado`; o orquestrador, vendo o
  fluxo compensado, responde com `EstornarPagamento` — o cliente nunca fica cobrado com a OS
  cancelada.
- **`ESTORNO_PENDENTE` com retentativa**: se o refund falhar, o orçamento vai para
  `ESTORNO_PENDENTE` com a próxima tentativa agendada e o Billing publica `EstornoFalhou`. O
  orquestrador mantém o estorno pendente e adia o prazo; a OS já está `CANCELADA` e a Saga não
  trava.
- **Porta `GatewayPagamentoPort`**: o restante do Billing fala só com a porta
  (`criarCobranca`, `consultarPagamento`, `buscarPagamentosPorOrcamento`, `estornar`); o
  Mercado Pago é um adapter dela. Toda chamada que move dinheiro leva uma chave de idempotência
  (por exemplo `estorno-<orcamentoId>`), segura para retentativa.

## Alternativas consideradas

- **Pagamento na entrega**: descartada. Sem dinheiro recebido antes do reparo, a compensação de
  um reparo inviável não teria estorno, e a Saga perderia a compensação mais significativa.
- **Pix pela API de pagamentos**: descartada. O Checkout Pro é a integração mais visual em
  sandbox e com menos código (o Mercado Pago hospeda a tela de pagamento).
- **Confiar no payload do webhook**: descartada. Sem consultar a API, uma notificação forjada ou
  reenviada poderia confirmar um pagamento que não existe.

## Consequências (positivas e negativas)

- **Positivo:** a Saga tem uma compensação real com dinheiro, demonstrável pelo caminho
  "reparo inviável" do Execution.
- **Positivo:** a porta isola o domínio do provedor: trocar ou simular o provedor não muda
  orçamento, eventos nem testes do fluxo.
- **Positivo:** o provedor é escolhido na subida do Billing. Com `MERCADO_PAGO_ACCESS_TOKEN` ele
  usa o adapter do Mercado Pago; sem o token usa um adapter simulado
  (`gateway-pagamento.simulado.ts`), que não movimenta dinheiro e mantém o ambiente local e os
  testes BDD sem conta externa.
- **Implementação:** a retentativa do estorno usa intervalos de 1, 5, 15 e 60 minutos e, depois
  disso, continua de hora em hora com um log de erro para acompanhamento humano. Um estorno que
  falha mas já aparece como reembolsado no Mercado Pago (feito pelo painel, por exemplo) conta
  como concluído.
- **Negativo:** cobrar antes do reparo pede confiança do cliente e exige estorno quando o reparo
  não acontece; o estorno depende da disponibilidade do Mercado Pago, por isso é retentável.
- **Negativo:** a corrida entre o pagamento e o prazo não some: é reduzida pela expiração da
  order e coberta pela regra do pagamento atrasado (estorno).
