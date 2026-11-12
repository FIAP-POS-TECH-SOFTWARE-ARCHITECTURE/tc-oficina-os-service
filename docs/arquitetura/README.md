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

## Relacionados

- [Runbook de observabilidade](../observabilidade/README.md) — instrumentação, dashboards,
  alertas e como rastrear uma requisição ponta a ponta.
- README de cada repositório de infra para os detalhes de provisionamento.
