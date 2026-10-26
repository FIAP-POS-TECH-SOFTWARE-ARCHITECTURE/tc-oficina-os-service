# Contratos entre microsserviços

Fonte da verdade mantida em `tc-oficina-os-service/contratos`. Os repositórios `tc-oficina-billing-service` e `tc-oficina-execution-service` mantêm uma cópia idêntica, verificada automaticamente no CI.

Qualquer mudança de contrato exige pull request nos três repositórios no mesmo dia: produtor e consumidor precisam concordar antes de qualquer deploy.

Os arquivos deste diretório são a referência normativa — nenhum serviço pode inventar nome de fila, tipo de mensagem, campo, rota, variável de ambiente ou parâmetro SSM fora daqui.

## 1. Topologia de mensageria

Recursos por ambiente, com `<env>` ∈ `homolog` | `prod` | `local`.

| Nome físico | Tipo | Produtor | Consumidor | DLQ |
| --- | --- | --- | --- | --- |
| `oficina-<env>-execucao-comandos` | SQS Standard | os-service | execution-service | `oficina-<env>-execucao-comandos-dlq` |
| `oficina-<env>-billing-comandos` | SQS Standard | os-service | billing-service | `oficina-<env>-billing-comandos-dlq` |
| `oficina-<env>-eventos` | SNS Standard | os, billing, execution | assinaturas | — |
| `oficina-<env>-os-orquestrador-eventos` | SQS Standard, assinatura do SNS | — | os-service | `oficina-<env>-os-orquestrador-eventos-dlq` |

Configuração (idêntica na infraestrutura e no emulador local):

| Atributo | Valor |
| --- | --- |
| `VisibilityTimeout` | 60 s |
| `MessageRetentionPeriod` (fila) | 345600 (4 dias) |
| `MessageRetentionPeriod` (DLQ) | 1209600 (14 dias) |
| `ReceiveMessageWaitTimeSeconds` | 20 (long polling) |
| `RedrivePolicy.maxReceiveCount` | 5 |
| Assinatura SNS → `os-orquestrador-eventos` | `RawMessageDelivery=true`, `FilterPolicy={"origem":["billing","execution"]}` (escopo `MessageAttributes`) |

Consumo: long polling, lote de até 10, **apagar a mensagem só depois** de processar e commitar. Erro durante o processamento não apaga a mensagem — ela volta após o visibility timeout e, na quinta falha, vai para a DLQ.

Ambiente `local` (desenvolvimento e testes manuais, só no emulador do `dev/docker-compose.yml`; não existe na AWS): os mesmos nomes com `<env>=local` — `oficina-local-execucao-comandos`, `oficina-local-billing-comandos`, `oficina-local-os-orquestrador-eventos` (cada uma com sua `-dlq`) e o tópico `oficina-local-eventos`, com os atributos e a assinatura da tabela acima. O script `scripts/mensageria-local.cjs` do os-service cria tudo (`npm run ministack:up && npm run mensageria:local`) e imprime as quatro variáveis de mensageria da seção 6. Billing e execution podem reutilizar o mesmo script e os mesmos nomes.

## 2. Envelope e atributos

Corpo da mensagem (JSON), validado por `schemas/envelope.schema.json`:

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `messageId` | uuid | sim | único por mensagem lógica; reenvio da mesma mensagem mantém o mesmo id (chave de idempotência) |
| `tipo` | string (ver catálogo) | sim | |
| `versao` | integer = 1 | sim | |
| `ocorridoEm` | date-time | sim | |
| `origem` | `os` \| `billing` \| `execution` | sim | |
| `fluxoId` | uuid | sim | identificador do fluxo da ordem de serviço |
| `osId` | uuid | sim | |
| `numeroOs` | string | sim | legível, usado em logs, e-mail e no provedor de pagamento |
| `correlationId` | string | sim | `requestId` HTTP que originou a cadeia, ou `messageId` da mensagem causadora |
| `payload` | object | sim | schema por tipo, em `schemas/payloads/` |

O envelope usa `additionalProperties: false`: campo desconhecido no envelope é erro. Os payloads usam `additionalProperties: true`, para que o produtor possa acrescentar um campo novo sem quebrar consumidores ainda não atualizados.

Dinheiro é sempre **centavos inteiros** (campos `...Centavos`). Nunca float nem string em mensagem.

`MessageAttributes` (SQS `SendMessage` e SNS `Publish`, todos com `DataType: String`):

| Atributo | Obrigatório | Valor |
| --- | --- | --- |
| `tipo` | sim | igual ao `tipo` do corpo |
| `origem` | sim | igual à `origem` do corpo; é o campo usado no `FilterPolicy` |
| `traceparent`, `tracestate` | não | W3C trace context |
| `newrelic` | não | header proprietário do agente de observabilidade |

### Idempotência no consumidor

1. `messageId` já processado → apagar a mensagem, sem nenhum efeito e sem nenhum evento.
2. `messageId` novo mas ação já aplicada no domínio (por exemplo `CancelarOrcamento` em orçamento já cancelado) → registrar o `messageId` e **re-emitir o evento de resultado** (`OrcamentoCancelado`), para o orquestrador conseguir avançar.
3. O registro do `messageId` e o efeito de domínio acontecem na **mesma transação** (Postgres) ou no mesmo `TransactWriteItems` (DynamoDB).
4. **A ordem não é garantida** (SQS Standard): `CancelarExecucao` pode chegar antes de `SolicitarDiagnostico` ou `IniciarReparo`, e `CancelarOrcamento` antes de `GerarOrcamento`. O participante registra o cancelamento por `fluxoId` (marca o fluxo como cancelado antecipadamente), reemite `ExecucaoCancelada` / `OrcamentoCancelado` e, quando o comando de criação chegar depois, não cria nada e reemite o evento de cancelado. Nesse caso `OrcamentoCancelado` sai com `orcamentoId: null`.
5. **Reenvios e compensações do orquestrador** que os participantes precisam suportar:
   - Compensação sem resposta (`CancelarExecucao`, `CancelarOrcamento`, `EstornarPagamento`) é reenviada a cada `PRAZO_RESPOSTA_SERVICO` com `messageId` **novo**, até três vezes; depois o fluxo vai para `FALHA_TECNICA`. Pela regra 2, o participante reemite o evento de resultado.
   - Se o execution não confirma `SolicitarDiagnostico` (`ExecucaoEnfileirada`) no prazo, recebe `CancelarExecucao` — o comando pode ter chegado depois do prazo.
   - Se o billing não responde `GerarOrcamento` no prazo, recebe `CancelarOrcamento`, para que um orçamento gerado tarde não fique aprovável.
   - `ExecucaoEnfileirada` que chega com o fluxo já encerrado (`COMPENSADO` ou `CONCLUIDO`) recebe `CancelarExecucao` com `messageId` novo.
   - `PagamentoConfirmado` antes da aprovação, ou depois de o fluxo ter compensado, recebe `EstornarPagamento`. Com o mesmo `pagamentoId` já registrado no fluxo, é ignorado; com outro `pagamentoId` depois do pagamento do fluxo, o orquestrador não estorna sozinho (gera alerta para decisão humana).

## 3. Catálogo de mensagens

A lista normativa está em `tipos.json`, usada pelo teste de completude. Cada tipo tem um schema em `schemas/payloads/<Tipo>.schema.json` e um exemplo válido em `exemplos/<Tipo>.json`.

Proposta para a versão 2 (ainda não implementada): `pagamentoId` opcional em `EstornarPagamento`, para o orquestrador poder estornar automaticamente um segundo pagamento do mesmo orçamento. Na versão 1, `EstornarPagamento` não identifica qual pagamento estornar, e esse caso fica como alerta.

### 3.1 Comandos para o execution-service

Fila `oficina-<env>-execucao-comandos`, `origem: os`.

| Tipo | Payload | Resposta esperada |
| --- | --- | --- |
| `SolicitarDiagnostico` | `cliente {id, nome}`, `veiculo {id, placa, marca, modelo, ano}`, `observacoesAtendimento: string\|null` | `ExecucaoEnfileirada{etapa:DIAGNOSTICO}` imediato; depois `DiagnosticoIniciado` → `DiagnosticoConcluido` \| `DiagnosticoRejeitado` |
| `IniciarReparo` | `itensServico[] {itemId, servicoId, nome, quantidade, tempoEstimadoMin}` (mínimo 1), `itensInsumo[] {insumoId, nome, quantidade}` (pode ser vazio) | `ExecucaoEnfileirada{etapa:REPARO}`; depois `ReparoIniciado` → `ReparoConcluido` \| `ReparoInviavel` |
| `CancelarExecucao` | `motivo: string` | `ExecucaoCancelada` (também quando não há ordem ativa, com `etapa: null`) |

### 3.2 Comandos para o billing-service

Fila `oficina-<env>-billing-comandos`, `origem: os`.

| Tipo | Payload | Resposta esperada |
| --- | --- | --- |
| `GerarOrcamento` | `cliente {id, nome, email: string\|null, documento}`, `veiculo {placa, marca, modelo}`, `itens[] {tipo: SERVICO\|INSUMO, referenciaId, descricao, quantidade ≥ 1, precoUnitarioCentavos}` (mínimo 1), `valorTotalCentavos` (> 0, igual à soma de quantidade × preço), `prazoAprovacaoEm: date-time`, `prazoPagamentoMinutos: integer ≥ 1` | `OrcamentoGerado` \| `FalhaGerarOrcamento` |
| `CancelarOrcamento` | `motivo: string` | `OrcamentoCancelado` |
| `EstornarPagamento` | `motivo: string` | `PagamentoEstornado` \| `EstornoFalhou` |

Regras do billing ligadas ao contrato:

- `valorTotalCentavos` diferente da soma dos itens → `FalhaGerarOrcamento{motivo:"VALOR_TOTAL_INCONSISTENTE"}`.
- Já existe orçamento ativo para o `osId` → reemitir `OrcamentoGerado` do orçamento existente (idempotência de negócio).
- `EstornarPagamento` para orçamento sem pagamento → `PagamentoEstornado` com `pagamentoId: null` e `valorCentavos: 0`, para o orquestrador não ficar preso compensando.

### 3.3 Eventos do execution-service

Tópico `oficina-<env>-eventos`, `origem: execution`.

| Tipo | Payload |
| --- | --- |
| `ExecucaoEnfileirada` | `etapa: DIAGNOSTICO\|REPARO`, `ordemExecucaoId: uuid` |
| `DiagnosticoIniciado` | `mecanicoId: uuid` |
| `DiagnosticoConcluido` | `mecanicoId`, `diagnostico: string (1..2000)`, `itens[] {tipo: SERVICO\|INSUMO, referenciaId: uuid, quantidade ≥ 1}` (mínimo 1) |
| `DiagnosticoRejeitado` | `mecanicoId`, `motivo: string` |
| `ReparoIniciado` | `mecanicoId` |
| `ReparoConcluido` | `mecanicoId`, `concluidoEm: date-time` |
| `ReparoInviavel` | `mecanicoId`, `motivo: string` |
| `ExecucaoCancelada` | `etapa: DIAGNOSTICO\|REPARO\|null`, `motivo: string` |

### 3.4 Eventos do billing-service

Tópico `oficina-<env>-eventos`, `origem: billing`.

| Tipo | Payload |
| --- | --- |
| `OrcamentoGerado` | `orcamentoId: uuid`, `valorTotalCentavos` |
| `FalhaGerarOrcamento` | `motivo: string` |
| `OrcamentoAprovado` | `orcamentoId`, `linkPagamento: uri`, `prazoPagamentoEm: date-time` |
| `OrcamentoRejeitado` | `orcamentoId`, `motivo: string\|null` |
| `OrcamentoCancelado` | `orcamentoId: uuid\|null`, `motivo: string` |
| `PagamentoConfirmado` | `orcamentoId`, `pagamentoId: string`, `valorCentavos`, `pagoEm: date-time` |
| `PagamentoEstornado` | `orcamentoId: uuid\|null`, `pagamentoId: string\|null`, `valorCentavos` (0 quando não havia pagamento) |
| `EstornoFalhou` | `orcamentoId`, `pagamentoId: string`, `motivo: string`, `proximaTentativaEm: date-time` |

### 3.5 Eventos do os-service

Tópico `oficina-<env>-eventos`, `origem: os`. São informativos: nenhum serviço é obrigado a consumi-los.

| Tipo | Payload |
| --- | --- |
| `FluxoConcluido` | `{}` |
| `FluxoCompensado` | `motivo: string`, `compensacoes: string[]` (nomes das ações de compensação executadas) |

## 4. REST

### 4.1 Rotas internas (serviço para serviço)

Não são expostas no API Gateway. Autenticação por header `x-internal-api-key`, cujo valor vem do parâmetro SSM `/oficina/<env>/internal-api-key` (variável de ambiente `INTERNAL_API_KEY`). Header ausente ou incorreto responde `401`.

O corpo segue o envelope padrão de resposta do os-service: `{ "status": number, "success": boolean, "data": <objeto da tabela abaixo> }`. Os consumidores leem `data`. O roteamento é case-sensitive: `/INTERNAL/...` não alcança o controller interno.

| Rota (os-service) | Resposta 200 | Outros |
| --- | --- | --- |
| `GET /internal/clientes/por-documento/:documento` (só dígitos) | `{ "id": uuid, "nome": string, "ativo": boolean }` | `404` quando inexistente |
| `GET /internal/catalogo/servicos` | `[{ "id", "nome", "descricao": string\|null, "precoCentavos", "tempoEstimadoMin" }]`, apenas `ativo=true` | — |
| `GET /internal/catalogo/insumos` | `[{ "id", "codigo", "nome", "precoCentavos", "quantidadeEstoque" }]`, apenas `ativo=true` | — |

Base URL dentro do cluster: `http://os-service.<env>.svc.cluster.local` (Service Kubernetes `os-service`, porta 80). A Lambda de token, que roda fora do cluster, usa o hostname publicado em `/oficina/<env>/os-service-lb-hostname`.

### 4.2 Rotas públicas via API Gateway

Cada serviço registra as rotas **com o prefixo** que o gateway repassa — o gateway não reescreve o path. O health check usado pelas probes do Kubernetes é `GET /health`, sem prefixo e público.

**billing-service** (`/billing/...`):

| Rota | Auth | Resposta |
| --- | --- | --- |
| `GET /billing/cliente/orcamentos/:numeroOs` | cliente (dono) | `200` com o orçamento (status, itens, total e `linkPagamento` se aprovado); `403` para outro cliente |
| `POST /billing/cliente/orcamentos/:numeroOs/aprovar` | cliente (dono) | `200` `{ linkPagamento, prazoPagamentoEm }`; `422` se o status não for `AGUARDANDO_APROVACAO` |
| `POST /billing/cliente/orcamentos/:numeroOs/rejeitar`, corpo `{ "motivo"?: string }` | cliente (dono) | `200`; `422` nas mesmas condições |
| `GET /billing/orcamentos/:numeroOs` | staff (`ATENDENTE`, `ADMINISTRADOR`) | `200` com o orçamento |
| `GET /billing/orcamentos?status=` | staff (`ATENDENTE`, `ADMINISTRADOR`) | `200` com a lista |
| `POST /billing/webhooks/mercado-pago` | pública, com `x-signature` | `200` para assinatura válida, inclusive em duplicata ou tipo ignorado; `401` para assinatura inválida; `503` em falha temporária (o provedor reenvia) |
| `POST /billing/orcamentos/:numeroOs/reconciliar` | staff (`ATENDENTE`, `ADMINISTRADOR`) | `200`; busca pagamentos por `external_reference` quando o webhook não chegou |

Pagamentos não aplicáveis (decisão do billing, sem evento): outro `pagamentoId` para orçamento já pago, valor divergente do total, ou pagamento para orçamento inexistente. Nesses casos o próprio billing estorna, com chaves de idempotência `estorno-duplicado-<pagamentoId>`, `estorno-divergente-<pagamentoId>` e `estorno-nao-aplicavel-<pagamentoId>`. `PagamentoConfirmado` só é emitido para pagamento aplicável, inclusive quando chega atrasado — se o orçamento já estiver `CANCELADO`, o orquestrador responde pedindo `EstornarPagamento`. A documentação Swagger do billing fica em `/billing/docs`.

Roteamento no gateway: as três rotas `/billing/cliente/...` são explícitas e usam o authorizer de cliente (que nega token sem `type: "cliente"`, por isso staff não pode dividir rota com cliente). `POST /billing/webhooks/mercado-pago` é explícita e pública. `ANY /billing/{proxy+}` e `ANY /execucao/{proxy+}` ficam sem authorizer, porque o próprio serviço valida o JWT de staff. O HTTP API escolhe sempre a rota mais específica. `ANY /internal/{proxy+}` usa `authorization_type = AWS_IAM`, negando chamadas sem assinatura com `403`. O webhook não recebe `x-request-id` do gateway: o billing correlaciona pelo `x-request-id` do provedor de pagamento. As rotas `/billing/*` e `/execucao/*` só existem depois que o hostname do serviço é publicado no SSM.

**execution-service** (`/execucao/...`, staff com role `MECANICO` ou `ADMINISTRADOR`):

| Rota | Resposta |
| --- | --- |
| `GET /execucao/fila?etapa=DIAGNOSTICO\|REPARO` | `200` com as ordens `PENDENTE` em ordem de chegada |
| `POST /execucao/fila/:etapa/proxima` | `200` com a ordem reservada para o mecânico do token; `404` com a fila vazia |
| `GET /execucao/ordens/:ordemExecucaoId` | `200` com detalhe e histórico |
| `POST /execucao/ordens/:ordemExecucaoId/diagnostico`, corpo `{ diagnostico, itens[] }` | `200`; `422` para item fora do catálogo ou estado inválido |
| `POST /execucao/ordens/:ordemExecucaoId/diagnostico/rejeitar`, corpo `{ motivo }` | `200` |
| `POST /execucao/ordens/:ordemExecucaoId/reparo/concluir` | `200` |
| `POST /execucao/ordens/:ordemExecucaoId/reparo/inviavel`, corpo `{ motivo }` | `200` |
| `GET /execucao/catalogo/servicos`, `GET /execucao/catalogo/insumos` | `200` repassando o catálogo interno do os-service |

**os-service** (staff com role `ADMINISTRADOR`) — orquestração:

| Rota | Resposta |
| --- | --- |
| `GET /orquestracao/fluxos/:osId` | `200` com `{ fluxo, mensagens }`: `fluxo` traz etapa, status, prazos e compensações pendentes e feitas; `mensagens` traz os comandos e eventos do outbox (`messageId`, `tipo`, `destino`, `status`, `tentativas`, `createdAt`, `enviadaEm`); `404` sem fluxo |
| `POST /orquestracao/fluxos/:fluxoId/reprocessar` | `200`; `422` se o status não for `FALHA_TECNICA`. Reenvia o comando pendente com `messageId` **novo**: o antigo pode ter sido processado com o evento perdido, e com id novo a regra 2 de idempotência faz o consumidor reemitir o resultado |
| `POST /orquestracao/fluxos/:fluxoId/compensar`, corpo opcional `{ "motivo"?: string }` (até 255) | `200`; `422` se o status não for `FALHA_TECNICA` |

**os-service** (staff com role `ATENDENTE` ou `ADMINISTRADOR`): `POST /os/:id/desbloquear`, corpo opcional `{ "observacao"?: string }`, tenta de novo a reserva de estoque de uma OS `BLOQUEADA` e, havendo estoque, retoma o fluxo pedindo `GerarOrcamento`. Responde `200` com a OS; `422` com os insumos faltantes ou se a OS não estiver bloqueada por estoque; `404` quando inexistente.

`correlationId` da cadeia: é o identificador da requisição no os-service, que vem do header `x-request-id` repassado pelo API Gateway (gerado quando ausente). Todas as mensagens de um mesmo fluxo carregam esse valor.

**Formato de resposta**, igual nos três serviços. Toda resposta usa o mesmo envelope, de sucesso ou de erro, e o código HTTP aparece tanto no status da resposta quanto no campo `status` do corpo:

```json
{ "success": true, "status": 200, "data": { "id": "...", "nome": "..." } }
```

```json
{ "success": false, "status": 404, "message": "Cliente não encontrado" }
```

Em erro, `message` traz sempre o texto legível. O campo opcional `error`, no formato `{ "message": string, "data": unknown }`, aparece quando há detalhe estruturado — por exemplo numa falha de validação de DTO, em que `error.data` carrega o corpo gerado pelo framework. Não existe campo `statusCode` no corpo.

Códigos usados: `400` validação de DTO, `401` credencial ausente ou inválida, `403` recurso de outro cliente ou role insuficiente, `404` inexistente, `422` transição de estado inválida.

## 5. JWT

Algoritmo HS256, segredo em `JWT_SECRET`, originado do parâmetro SSM `/oficina/<env>/jwt-secret`.

| Emissor | Claims |
| --- | --- |
| os-service (login de staff) | `sub` (usuarioId), `email`, `role` ∈ `ATENDENTE` \| `MECANICO` \| `ESTOQUISTA` \| `ADMINISTRADOR` |
| Lambda de token (cliente por CPF) | `sub` (clienteId), `nome`, `cpf`, `type: "cliente"` |

Billing e execution validam apenas assinatura, expiração e claims — não têm tabela de usuários nem de clientes. Trade-off assumido: um usuário inativado continua com acesso até o token expirar.

## 6. Configuração

Variáveis de ambiente dos pods, preenchidas a partir do SSM durante o deploy.

| Variável | os | billing | execution | Origem no SSM |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | ✔ | — | ✔ | `/oficina/<env>/database-url` (os), `/oficina/<env>/execution/database-url` (execution) |
| `JWT_SECRET` | ✔ | ✔ | ✔ | `/oficina/<env>/jwt-secret` |
| `INTERNAL_API_KEY` | ✔ | — | ✔ | `/oficina/<env>/internal-api-key` |
| `SNS_EVENTOS_ARN` | ✔ | ✔ | ✔ | `/oficina/<env>/mensageria/eventos-topic-arn` |
| `SQS_EXECUCAO_COMANDOS_URL` | ✔ (envia) | — | ✔ (consome) | `/oficina/<env>/mensageria/execucao-comandos-url` |
| `SQS_BILLING_COMANDOS_URL` | ✔ (envia) | ✔ (consome) | — | `/oficina/<env>/mensageria/billing-comandos-url` |
| `SQS_OS_ORQUESTRADOR_EVENTOS_URL` | ✔ (consome) | — | — | `/oficina/<env>/mensageria/os-orquestrador-eventos-url` |
| `DYNAMODB_TABLE` | — | ✔ | — | `/oficina/<env>/billing/dynamodb-table` |
| `OS_SERVICE_URL` | — | — | ✔ | fixo no overlay: `http://os-service.<env>.svc.cluster.local` |
| `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` | — | ✔ | — | `/oficina/<env>/mercado-pago/access-token`, `/oficina/<env>/mercado-pago/webhook-secret` |
| `AWS_REGION` | ✔ | ✔ | ✔ | fixo `us-east-1` |
| `SQS_DLQ_URLS` | ✔ | — | — | CSV das três URLs `/oficina/<env>/mensageria/*-dlq-url` |
| `AWS_ENDPOINT_URL` | local | local | local | apenas em desenvolvimento e teste: `http://localhost:4566`. O SDK v3 lê nativamente; **nunca** é definida em homolog ou prod |
| `PRAZO_APROVACAO`, `PRAZO_PAGAMENTO`, `PRAZO_RESPOSTA_SERVICO` | ✔ | — | — | ConfigMap do os-service, não SSM. Minutos inteiros maiores que zero; padrão 4320 / 2880 / 10, homolog 30 / 30 / 5. Valor inválido impede o processo de subir |
| `WORKERS_HABILITADOS` | ✔ | opcional | opcional | não definida em homolog e prod (padrão: ligado). `false` desliga consumidor de fila, relay de outbox e jobs; usada em testes. Billing e execution podem adotar o mesmo nome para o mesmo fim |

As DLQs também são publicadas no SSM, para observabilidade e reprocessamento: `/oficina/<env>/mensageria/execucao-comandos-dlq-url`, `/oficina/<env>/mensageria/billing-comandos-dlq-url` e `/oficina/<env>/mensageria/os-orquestrador-eventos-dlq-url`.

## 7. Organização dos arquivos

```
contratos/
  README.md                       este documento
  tipos.json                      catálogo normativo de comandos e eventos
  schemas/
    envelope.schema.json          envelope comum e definições reutilizáveis
    payloads/<Tipo>.schema.json   um por tipo do catálogo
  exemplos/
    <Tipo>.json                   mensagem completa e válida
    PagamentoEstornado.sem-pagamento.json
  invalidos/                      casos usados apenas pelo teste de contrato
```

Os exemplos contam a história de uma mesma ordem de serviço (`OS-2026-000123`), com o mesmo `fluxoId` e `osId`, cobrindo o caminho feliz e os caminhos de compensação.

Versionamento: `versao` do envelope é `1`. Uma mudança incompatível cria uma versão nova, e o consumidor aceita as duas até que todos os produtores tenham migrado.

## 8. Eventos de log do orquestrador

Valores do campo `event` nos logs JSON do os-service, usados pelos alertas e painéis de observabilidade. Todo log do orquestrador e da mensageria leva, quando existir, `fluxoId`, `osId` e `messageId`.

| Tipo | Eventos |
| --- | --- |
| Alerta (nível `error`) | `fluxo.falha_tecnica`, `fluxo.compensacao_atrasada`, `fluxo.compensacao_travada`, `fluxo.estorno_falhou`, `fluxo.pagamento_atrasado`, `fluxo.pagamento_inesperado`, `fluxo.cancelamento_tardio`, `mensageria.mensagem_invalida`, `mensageria.falha_processamento`, `mensageria.falha_recebimento`, `outbox.falha_envio`, `outbox.falha_definitiva` |
| Informativo | `fluxo.iniciado`, `fluxo.transicao`, `fluxo.evento_ignorado`, `fluxo.desconhecido`, `mensageria.duplicada`, `mensageria.origem_ignorada`, `mensageria.consumidor_iniciado` |
