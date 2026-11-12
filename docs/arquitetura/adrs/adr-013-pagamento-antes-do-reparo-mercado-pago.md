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
- **Mercado Pago Checkout Pro**: na aprovação, o Billing cria uma preferência de pagamento e
  devolve ao cliente o `linkPagamento`. A preferência expira junto com o prazo de pagamento da
  Saga, para que um pagamento não seja aceito depois de o fluxo desistir.
- **Webhook assinado + consulta à API**: o Mercado Pago notifica
  `POST /billing/webhooks/mercado-pago` (rota pública no API Gateway, sem authorizer). O Billing
  valida o header `x-signature` e **não confia no payload**: consulta o pagamento na API do
  Mercado Pago antes de registrar o resultado. A notificação é deduplicada (item
  `WEBHOOK#<pagamentoId>#<status>`) e só então sai `PagamentoConfirmado`.
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
- **Estado atual:** o adapter em uso hoje é **simulado** (`gateway-pagamento.simulado.ts`, atrás
  da `GatewayPagamentoPort`) e não movimenta dinheiro. O Mercado Pago é o adapter-alvo da mesma
  porta; o controller do webhook ainda não existe no Billing, embora a rota pública já esteja
  declarada no API Gateway (`tc-oficina-lambda-auth`). Com o adapter simulado, nenhum
  componente produz `PagamentoConfirmado`: o fluxo depois da aprovação é exercitado pelos testes
  do orquestrador (unitários e o BDD `fluxo-ordem-servico.feature`), que injetam o evento. O estado `ESTORNO_PENDENTE` e a
  transição de falha de estorno existem no domínio do orçamento, mas a retentativa agendada e a
  publicação de `EstornoFalhou` acompanham o adapter Mercado Pago; hoje, uma falha do gateway
  durante `EstornarPagamento` faz a mensagem voltar à fila e, após 5 recebimentos, ir para a
  DLQ. O orquestrador já trata `EstornoFalhou`.
- **Negativo:** cobrar antes do reparo pede confiança do cliente e exige estorno quando o reparo
  não acontece; o estorno depende da disponibilidade do Mercado Pago, por isso é retentável.
- **Negativo:** a corrida entre o pagamento e o prazo não some: é reduzida pela expiração da
  preferência e coberta pela regra do pagamento atrasado (estorno).
