# ADR-009: Mensageria com SNS + SQS Standard e DLQ em toda fila

- **Status:** Aceita
- **Data:** 2026-11-12

## Contexto

A Saga orquestrada ([ADR-008](adr-008-saga-orquestrada.md)) troca comandos e eventos entre os
três serviços de forma assíncrona: o orquestrador não pode esperar o mecânico diagnosticar nem o
cliente pagar, e um serviço fora do ar não pode perder mensagens. O enunciado pede mensageria
assíncrona (RabbitMQ, Kafka, SQS etc.) para eventos e integração desacoplada.

O ambiente é o AWS Academy: a conta é reiniciada periodicamente, toda a infraestrutura precisa
ser recriada por script, e só o que a `LabRole` permite pode ser usado.

## Decisão

**Amazon SNS + SQS, tipo Standard, provisionados por Terraform em `tc-oficina-infra-k8s`
(`mensageria.tf`)**, um conjunto por ambiente (`<env>` = `homolog` | `prod`):

| Recurso | Tipo | Produtor | Consumidor |
| --- | --- | --- | --- |
| `oficina-<env>-execucao-comandos` | SQS | os-service (orquestrador) | execution-service |
| `oficina-<env>-billing-comandos` | SQS | os-service (orquestrador) | billing-service |
| `oficina-<env>-eventos` | SNS | os, billing, execution | assinaturas |
| `oficina-<env>-os-orquestrador-eventos` | SQS, assinatura do tópico | — | os-service |

- **Comandos em fila por serviço**: cada serviço que recebe comandos tem a sua fila, com um
  único consumidor. O orquestrador sabe para quem manda (`SolicitarDiagnostico`, `IniciarReparo`,
  `CancelarExecucao` → execution; `GerarOrcamento`, `CancelarOrcamento`, `EstornarPagamento` →
  billing).
- **Eventos em tópico com `FilterPolicy`**: billing e execution publicam no tópico `eventos`
  sem saber quem consome. A fila do orquestrador assina o tópico com
  `FilterPolicy={"origem":["billing","execution"]}` (escopo `MessageAttributes`) e
  `RawMessageDelivery=true`, para o corpo chegar igual ao publicado e os atributos de trace
  chegarem como atributos SQS. Os eventos informativos do próprio OS (`FluxoConcluido`,
  `FluxoCompensado`) ficam fora da fila do orquestrador.
- **DLQ em toda fila**: cada fila tem `-dlq`, com `maxReceiveCount = 5` no redrive. Retenção de
  4 dias nas filas e 14 dias nas DLQs; visibility timeout de 60 s e long polling de 20 s.
- **Consumo**: a mensagem só é apagada depois de processada e commitada; erro ou mensagem fora
  do contrato não apaga, e depois de 5 recebimentos ela vai para a DLQ, onde fica para inspeção
  e dispara alerta.
- **Endereços via SSM**: URLs e ARNs em `/oficina/<env>/mensageria/...`, lidos pelo CD de cada
  serviço. Para desenvolvimento há o ambiente `local` (`oficina-local-*`) no MiniStack
  ([ADR-014](adr-014-qualidade-sonarqube-bdd-ministack.md)).

## Alternativas consideradas

- **RabbitMQ no EKS**: considerado e trocado pelo serviço gerenciado. Exigiria operar o broker
  (volume persistente, usuário, alta disponibilidade) e perderia filas e mensagens a cada reset
  do Academy; com SNS/SQS o Terraform sobe e derruba tudo, e o script único de recriação do
  ambiente (`scripts/subir-tudo.sh`, no
  [tc-oficina-infra-db](https://github.com/FIAP-POS-TECH-SOFTWARE-ARCHITECTURE/tc-oficina-infra-db/blob/main/scripts/subir-tudo.sh))
  refaz a mensageria junto com o resto.
- **SQS FIFO**: descartada. Combinar FIFO com SNS exige tópico FIFO e grupos de mensagem sem
  ganho para o fluxo: ordem e duplicidade já são tratadas por idempotência no consumidor e pela
  máquina de estados do orquestrador, que aceita ou ignora cada evento conforme a etapa
  ([ADR-012](adr-012-outbox-e-idempotencia.md)).

## Consequências (positivas e negativas)

- **Positivo:** serviço gerenciado, sem operação de broker; permissões cobertas pela `LabRole`.
- **Positivo:** um serviço fora do ar não perde mensagens — elas esperam na fila e,
  esgotadas as tentativas, ficam na DLQ para reenvio.
- **Positivo:** o tópico de eventos permite novos assinantes sem mudar os produtores.
- **Negativo:** SQS Standard entrega pelo menos uma vez e sem ordem garantida; todo consumidor
  precisa ser idempotente e o orquestrador precisa tratar eventos fora de ordem.
- **Negativo:** uma mensagem inválida gera 5 logs de erro antes de chegar à DLQ, porque não é
  apagada no primeiro recebimento (para não perder a evidência).
