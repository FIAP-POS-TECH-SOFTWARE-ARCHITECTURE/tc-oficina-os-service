# Runbook de observabilidade

Como a stack da oficina é monitorada, como reproduzir a demonstração do vídeo e como investigar um incidente.

## 1. O que está instrumentado e onde

| Fonte | O que envia | Onde é configurado |
|---|---|---|
| **Agente APM Node** (`newrelic`, carregado via `NODE_OPTIONS=-r newrelic`) | `Transaction` (latência, throughput, taxa de erro), distributed tracing e encaminhamento dos logs da aplicação | [k8s/base/os-service-deployment.yaml](../../k8s/base/os-service-deployment.yaml) — `NEW_RELIC_APP_NAME` vem do overlay (`oficina-os-service-homolog` / `oficina-os-service-prod`) |
| **nri-bundle** (Helm, namespace `newrelic`) | `K8sContainerSample`, `K8sPodSample`, `K8sDeploymentSample`, `K8sNodeSample` (CPU/memória/réplicas) + logs de todos os pods via **Fluent Bit** | repo `tc-oficina-infra-k8s`, `addons.tf` |
| **Synthetics** (ping) | `SyntheticCheck` — uptime dos endpoints do API Gateway | UI do New Relic (monitores `oficina-health-homolog` / `oficina-health-prod`) |
| **CloudWatch** | logs da Lambda de autenticação | AWS (repo `tc-oficina-lambda-auth`) |

Ambientes são separados por `appName` (APM/logs do agente) e por `namespaceName` (métricas de K8s): `homolog` e `prod`, no mesmo cluster `oficina-eks`.

## 2. Acesso à conta

- Conta New Relic **free tier**, região US, e-mail do grupo. Todos os membros são convidados em **Administration → Users**.
- A *license key* (Administration → API keys → tipo `INGEST - LICENSE`) está nos GitHub Secrets como `NEW_RELIC_LICENSE_KEY` nos repositórios `tc-oficina-os-service` e `tc-oficina-infra-k8s`. **Nunca commitar a chave.**

## 3. Importar os dashboards versionados

Os três dashboards são versionados como JSON neste diretório:

| Arquivo | Dashboard | Cobre |
|---|---|---|
| [dashboard-operacao.json](dashboard-operacao.json) | `Oficina — Operação` | volume diário de OS, tempo médio por status, erros de integração |
| [dashboard-plataforma.json](dashboard-plataforma.json) | `Oficina — Plataforma` | latência p50/p95/p99, taxa de erro HTTP, CPU/memória dos pods, réplicas x HPA, uptime |
| [dashboard-fluxo-os.json](dashboard-fluxo-os.json) | `Oficina — Fluxo da OS` | fluxos iniciados e por status final, compensações por motivo, tempo por etapa, DLQs, mensagens fora do contrato, estornos esgotados, latência e throughput dos três serviços |

Cada um tem duas páginas (`Homolog` e `Prod`).

Os dashboards `Operação` e `Plataforma` olham só o `os-service` (`oficina-os-service-<env>` no APM; `container_name = 'os-service'` nos logs; `containerName`/`deploymentName = 'os-service'` nas métricas de K8s). Como os três serviços dividem o namespace, `namespace_name` sozinho não separa os serviços; por isso o filtro de log é `entity.name = 'oficina-os-service-<env>' OR (namespace_name = '<env>' AND container_name = 'os-service')`.

O dashboard `Fluxo da OS` consome os logs `fluxo.iniciado`, `fluxo.transicao`, `fluxo.falha_tecnica`, `mensageria.dlq_profundidade`, `mensageria.mensagem_invalida` e `billing.estorno.esgotado`, e as `Transaction` dos três serviços (`appName LIKE 'oficina-%-service-<env>'`). Notas de leitura:

- Os widgets de fluxo usam `uniqueCount(fluxoId)` (e não `count(*)`) porque cada linha de log pode chegar duas vezes (ver seção 6). Se "Fluxos por status final" aparecer em dobro, alguma query ficou com `count(*)`.
- "Tempo médio por etapa" faceta por `etapaAnterior` e usa `duracaoEtapaMs`, que mede o tempo desde a última gravação do fluxo (`updatedAt`). Isso costuma coincidir com a última mudança de etapa, mas não é garantido: qualquer gravação do fluxo (por exemplo, a de um reenvio) zera a contagem.
- "Throughput de mensagens consumidas" filtra `OtherTransaction/SQS/mensageria/%`: o consumidor abre uma transação em background com nome `mensageria/<tipo>` e grupo `SQS`, e o agente a registra como `OtherTransaction/SQS/mensageria/<tipo>`.
- "Estornos esgotados" (`billing.estorno.esgotado`) fica zerado até a integração de pagamento do billing existir.
- "Mensagens fora do contrato" soma os três serviços (filtra só por namespace); os demais widgets de log filtram o `os-service`.

**Antes de importar**, trocar o `accountIds` placeholder pelo ID da conta (o número que aparece na URL `one.newrelic.com/.../accounts/<ID>`):

```bash
sed -i 's/"accountIds": \[0\]/"accountIds": [SEU_ACCOUNT_ID]/g' docs/observabilidade/dashboard-*.json
```

Depois: **Dashboards → Import dashboard** (botão `+`) → colar o conteúdo do arquivo → *Import*.

Para exportar de volta após ajustes na UI: `⋯` → **Copy JSON** → sobrescrever o arquivo → commit. Manter o JSON versionado em dia é o que permite recriar tudo se a conta do lab for perdida.

## 4. Contrato de eventos de log

Os dashboards e o alerta principal dependem destes três eventos, emitidos como log estruturado JSON pelo app (`nestjs-pino`, chamada *object-first* — as chaves vão na raiz do registro). O contrato é garantido por teste em [src/common/logging/structured-log.spec.ts](../../src/common/logging/structured-log.spec.ts).

| `event` | Emitido em | Atributos |
|---|---|---|
| `os.created` | [criar-os.use-case.ts](../../src/modules/ordens-servico/application/use-cases/criar-os.use-case.ts) | `osId`, `numero` |
| `os.status.changed` | [ordens-servico.prisma.gateway.ts](../../src/modules/ordens-servico/adapters/gateways/ordens-servico.prisma.gateway.ts) | `osId`, `numero`, `fromStatus`, `toStatus`, `durationMs` |
| `integration.error` | [notificador.smtp.gateway.ts](../../src/modules/ordens-servico/adapters/gateways/notificador.smtp.gateway.ts) | `integration`, `osNumero`, `error` |

Notas de leitura dos dados:

- `durationMs` é o tempo que a OS passou **no status anterior** (`fromStatus`), medido a partir do `createdAt` da linha de histórico anterior. Na primeira transição não existe linha anterior e o valor é `0` — por isso o widget "tempo médio por status" faceta por `fromStatus`, não por `toStatus`.
- `fromStatus` é `null` na primeira transição após a criação; o facet mostra esse balde separado.
- Todo registro dentro de uma request carrega `requestId` (ver seção 5). Registros fora de request (bootstrap, jobs) não carregam.

**Ao mexer nesses eventos, atualizar os JSONs dos dashboards e o [alertas.md](alertas.md) no mesmo PR** — os nomes são contrato, não detalhe de implementação.

## 5. Rastrear uma requisição de ponta a ponta

O `requestId` nasce no header `x-request-id` (ou é gerado com `randomUUID()` se ausente) em [src/app.module.ts](../../src/app.module.ts) e é propagado para todo log da request via `AsyncLocalStorage` do `nestjs-pino`.

```sql
-- todos os logs de uma requisição, do app
SELECT timestamp, event, level, message, osId, numero
FROM Log WHERE requestId = '<uuid>' SINCE 1 day ago LIMIT MAX
```

Para o caminho gateway → app: o API Gateway registra o `requestId` do lado dele nos logs de acesso (CloudWatch) e o repassa no header; o mesmo valor aparece no `requestId` dos logs do app, o que fecha a correlação exigida pelo enunciado.

Pelo APM: **APM & Services → `oficina-os-service-<env>` → Distributed tracing** → abrir um trace → aba **Logs** ("logs in context", vinculados por `trace.id`).

## 6. ⚠️ Fonte dupla de logs — validar antes de confiar nos números

Hoje **duas rotas de ingestão de log estão ativas ao mesmo tempo** para os pods do app:

1. o agente APM encaminha os logs (`NEW_RELIC_APPLICATION_LOGGING_FORWARDING_ENABLED=true`, em [k8s/base/os-service-deployment.yaml](../../k8s/base/os-service-deployment.yaml));
2. o Fluent Bit do `nri-bundle` coleta o stdout dos mesmos pods (`newrelic-logging.enabled=true`, em `addons.tf` do repo `tc-oficina-infra-k8s`).

Consequências: cada linha pode ser ingerida **duas vezes** (dobrando `count(*)` no volume de OS e consumindo o dobro da cota de 100 GB), e o atributo `level` chega em formatos diferentes — texto (`"error"`) pela rota do agente, número (`50`, padrão do `pino`) pela rota do Fluent Bit.

**Primeira coisa a fazer com dados reais no ambiente**, antes de tirar print de qualquer dashboard:

```sql
-- quantas cópias de cada registro chegam, e por qual rota
SELECT count(*) FROM Log WHERE event = 'os.created'
FACET newrelic.source, container_name, entity.name SINCE 30 minutes ago
```

Criar uma OS e conferir se a contagem é 1 ou 2. Se for 2, escolher **uma** rota:

- **Recomendado — manter o agente, tirar o app do Fluent Bit.** Preserva "logs in context"/`trace.id`, que é a evidência de correlação exigida na entrega. Alternativa equivalente: desligar o encaminhamento do agente (`NEW_RELIC_APPLICATION_LOGGING_FORWARDING_ENABLED=false`) e ligar `NEW_RELIC_APPLICATION_LOGGING_LOCAL_DECORATING_ENABLED=true`, que injeta o `trace.id` na própria linha de stdout — a correlação continua funcionando pelo Fluent Bit.
- Depois de consolidar, simplificar os filtros: os JSONs dos dashboards usam `(entity.name = 'oficina-os-service-<env>' OR (namespace_name = '<env>' AND container_name = 'os-service'))` justamente para funcionar nas duas rotas, e o alerta 1 usa `(level = 'error' OR numeric(level) >= 50)` pelo mesmo motivo.

Enquanto as duas rotas estiverem ligadas, os widgets de **contagem** (volume diário de OS, erros de integração) devem ser lidos como tendência, não como número absoluto.

## 7. Rastreamento distribuído

Cada mensagem publicada pelo outbox carrega os atributos `traceparent`, `tracestate` e `newrelic` (`MessageAttributes` do SQS). O consumidor abre uma transação em background `OtherTransaction/SQS/mensageria/<tipo>` e a liga ao trace de quem publicou, então um fluxo aparece como um único trace atravessando os três serviços.

**Como abrir um trace:**

1. **APM & Services → `oficina-os-service-homolog` → Distributed tracing**.
2. Filtrar pela transação de abertura (a request HTTP que cria a OS) e abrir um trace.
3. Para os logs do mesmo fluxo: aba **Logs** do trace (logs vinculados por `trace.id`) ou, em **Logs**, `SELECT timestamp, event, etapa, status, appName FROM Log WHERE fluxoId = '<uuid>' SINCE 1 day ago LIMIT MAX`. O `fluxoId` aparece em todos os logs do orquestrador (`fluxo.*`).

**O que se espera ver** (fluxo feliz): request HTTP de abertura no os-service → `OtherTransaction/SQS/mensageria/SolicitarDiagnostico` no execution → transações de consumo `mensageria/<tipo>` no os-service e no billing conforme os eventos voltam (diagnóstico concluído, orçamento, pagamento, reparo) → os três serviços no mapa do trace.

**Limitação conhecida:** o relay do outbox publica a mensagem em outra transação, então os spans do relay não aparecem no trace; o elo entre os serviços é a própria mensagem, pelos atributos de trace gravados quando o evento entrou no outbox. Se um serviço aparecer sem transação de consumo, conferir se o agente estava ativo (`NEW_RELIC_LICENSE_KEY`) nos dois lados: com o agente desligado as funções de trace viram no-op.

## 8. Gerar tráfego para a demo

Os dashboards precisam de série histórica — rodar **dias antes** da gravação, não na hora:

```bash
# collection Bruno contra homolog (fluxos funcionais, gera os.created / os.status.changed)
# bruno/Oficina-API — selecionar o environment de homolog

# carga sintética (gera latência e volume para os widgets de plataforma)
BASE_URL=https://<api_endpoint homolog> k6 run k6/load-test.js
```

## 9. Alertas

Ver [alertas.md](alertas.md): as 8 condições da policy `Oficina — Alertas` (4 da API e 4 de mensageria/orquestração), thresholds, destino e os procedimentos de disparo real em homolog: falha de OS (quebra controlada do SMTP, com reversão) e mensagem em DLQ (publicação de uma mensagem inválida na fila do billing).

## 10. Screenshots para o PDF da entrega

Guardar neste diretório, com dados reais, após rodar o tráfego da seção 8:

- [ ] `Oficina — Operação`, página Homolog (volume, tempo por status, erros)
- [ ] `Oficina — Plataforma`, página Homolog (latência, CPU/memória, réplicas, uptime)
- [ ] `Oficina — Fluxo da OS`, página Homolog, depois de rodar um fluxo completo (todos os widgets com dado; "Fluxos por status final" batendo com o número de fluxos executados)
- [ ] Alerts → Issues & activity com a issue do alerta de falha de OS aberta
- [ ] E-mail de notificação recebido
- [ ] Um trace no APM com a aba de logs vinculados (evidência da correlação)
- [ ] Um trace distribuído de um fluxo completo, mostrando as transações `OtherTransaction/SQS/mensageria/*` dos três serviços
- [ ] Alerts → Issues & activity com a issue da condição 5 (mensagem em DLQ) aberta e o e-mail recebido
