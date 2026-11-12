# Documentação da arquitetura — Fase 3

Fonte única da documentação arquitetural do sistema da oficina (Tech Challenge FIAP SOAT,
grupo Integradores). Os outros repositórios (`tc-oficina-lambda-auth`,
`tc-oficina-infra-k8s`, `tc-oficina-infra-db`) linkam para cá.

Todos os diagramas são Mermaid e renderizam nativamente no GitHub.

## Visão geral

| Documento | Conteúdo |
| --- | --- |
| [visao-geral-microsservicos.md](visao-geral-microsservicos.md) | Arquitetura atual (Fase 4): diagrama geral com os três microsserviços, bancos, filas SNS/SQS e borda; tabelas de serviços e de comunicação síncrona/assíncrona; regra de dados e ambientes. |
| [componentes.md](componentes.md) | Diagrama de componentes com visão de nuvem completa (gateway, Lambdas, EKS, RDS, SSM, observabilidade, CI/CD) + legenda componente → repositório e contratos entre repositórios. |
| [sequencia-autenticacao.md](sequencia-autenticacao.md) | Diagrama de sequência: emissão do JWT a partir do CPF e uso do token numa rota sensível do cliente. |
| [sequencia-abertura-os.md](sequencia-abertura-os.md) | Diagrama de sequência: criação de OS e transição de status (onde vivem a notificação por e-mail e o alerta de falha de integração). |
| [sequencia-fluxo-os.md](sequencia-fluxo-os.md) | Diagrama de sequência: caminho feliz da OS entre `os-service` (orquestrador da Saga), `execution-service` e `billing-service`, com o status da OS e a etapa do fluxo em cada passo. |
| [sequencia-compensacao.md](sequencia-compensacao.md) | Diagramas de sequência das compensações (reparo inviável e pagamento atrasado), estados do fluxo e tabela de compensações como implementada. |
| [banco-de-dados.md](banco-de-dados.md) | Justificativa formal do PostgreSQL/RDS, ajustes do modelo na Fase 3, DER e explicação de cada relacionamento. |

## RFCs — decisões técnicas

| RFC | Decisão |
| --- | --- |
| [RFC-001](rfcs/rfc-001-escolha-da-nuvem.md) | Nuvem: **AWS** (AWS vs GCP vs Azure). |
| [RFC-002](rfcs/rfc-002-banco-de-dados-gerenciado.md) | Banco: **RDS PostgreSQL** (RDS Postgres vs Aurora vs MySQL vs SQL Server). |
| [RFC-003](rfcs/rfc-003-estrategia-de-autenticacao.md) | Autenticação: **Lambda própria + JWT HS256 + Lambda Authorizer** (Cognito vs Auth0 vs Lambda própria). |
| [RFC-004](rfcs/rfc-004-plataforma-de-observabilidade.md) | Observabilidade: **New Relic** (New Relic vs Datadog vs Prometheus+Grafana). |

## ADRs — decisões arquiteturais permanentes

| ADR | Decisão |
| --- | --- |
| [ADR-001](adrs/adr-001-quatro-repositorios-e-contratos-ssm.md) | 4 repositórios; contratos via SSM Parameter Store; remote state S3 só entre repositórios de infra. |
| [ADR-002](adrs/adr-002-api-gateway-http-com-lambda-authorizer.md) | API Gateway HTTP API com Lambda REQUEST authorizer e proxy HTTP para o EKS; TTL de cache 300s. |
| [ADR-003](adrs/adr-003-jwt-hs256-segredo-compartilhado.md) | JWT HS256 com segredo único por ambiente compartilhado via SSM (Lambda assina, app valida). |
| [ADR-004](adrs/adr-004-ambientes-por-namespace-e-banco-logico.md) | Homolog/prod como namespaces no mesmo cluster e bancos lógicos na mesma instância RDS. |
| [ADR-005](adrs/adr-005-hpa-por-cpu.md) | HPA por CPU (2–10 réplicas, alvo 70%) com metrics-server via Terraform. |
| [ADR-006](adrs/adr-006-logs-estruturados-pino.md) | Logs estruturados JSON com pino + `requestId` propagado do gateway. |
| [ADR-007](adrs/adr-007-microsservicos-os-billing-execution.md) | Três microsserviços (OS, Billing, Execution) seguindo a divisão do enunciado; diagnóstico no Execution, orçamento no Billing; `tc-oficina-app` renomeado para `tc-oficina-os-service`. |
| [ADR-008](adrs/adr-008-saga-orquestrada.md) | Saga Pattern orquestrada, com o orquestrador no `os-service` (`orquestracao-os`); falta de isolamento tratada com Visão Pessimista e Reler Valor. |
| [ADR-009](adrs/adr-009-mensageria-sns-sqs.md) | SNS + SQS Standard: comandos em fila por serviço, eventos em tópico com `FilterPolicy`, DLQ com `maxReceiveCount=5`. |
| [ADR-010](adrs/adr-010-banco-por-servico.md) | Banco por serviço: PostgreSQL no OS e RDS próprio no Execution, DynamoDB no Billing; nenhum serviço lê o banco de outro. |
| [ADR-011](adrs/adr-011-infra-de-dados-centralizada.md) | Terraform dos três bancos em `tc-oficina-infra-db`, arquivos por serviço e `prevent_destroy`. |
| [ADR-012](adrs/adr-012-outbox-e-idempotencia.md) | Outbox transacional (Postgres e equivalente DynamoDB), regras de idempotência do consumidor e contratos versionados em `contratos/`. |
| [ADR-013](adrs/adr-013-pagamento-antes-do-reparo-mercado-pago.md) | Pagamento antes do reparo com Mercado Pago Checkout Pro, webhook assinado e estorno como compensação. |
| [ADR-014](adrs/adr-014-qualidade-sonarqube-bdd-ministack.md) | SonarQube em container no CI (gate "Cobertura 80"), BDD com `jest-cucumber` em pt-BR e MiniStack como emulador AWS. |
| [ADR-015](adrs/adr-015-estrategia-de-deploy-rolling-update.md) | Rolling update do Kubernetes (`maxUnavailable: 0`, `maxSurge: 1`) com readiness `/health/ready`; homolog antes de prod. |

## Relacionados

- [Runbook de observabilidade](../observabilidade/README.md) — instrumentação, dashboards,
  alertas e como rastrear uma requisição ponta a ponta.
- README de cada repositório de infra para os detalhes de provisionamento.
