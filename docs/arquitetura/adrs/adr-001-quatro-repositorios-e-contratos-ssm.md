# ADR-001: Quatro repositórios e contratos via SSM

- **Status:** Aceita
- **Data:** 2026-09-10

> **Atualização na Fase 4:** o contrato via SSM continua, mas o `tc-oficina-app` virou
> `tc-oficina-os-service` e surgiram o billing e o execution
> ([ADR-007](adr-007-microsservicos-os-billing-execution.md)). Cada serviço publica o próprio
> `/oficina/<env>/<servico>-lb-hostname` (`os-service`, `billing-service`, `execution-service`)
> e o `tc-oficina-lambda-auth` lê esses parâmetros; o `app-lb-hostname` citado abaixo deixou
> de ser publicado.

## Contexto

A Fase 3 exige repositórios separados com CI/CD independente para a aplicação, a Lambda de
autenticação e a infraestrutura. Repositórios separados precisam de um mecanismo de
integração que não crie acoplamento entre pipelines nem exija ordem de merge coordenada.

## Decisão

Quatro repositórios de trabalho:

| Repositório | Conteúdo |
| --- | --- |
| `tc-oficina-app` | API NestJS + manifests K8s + docs de arquitetura e observabilidade |
| `tc-oficina-lambda-auth` | Lambdas (token + authorizer) + Terraform do API Gateway |
| `tc-oficina-infra-k8s` | Terraform de VPC, EKS, ECR, namespaces, addons |
| `tc-oficina-infra-db` | Terraform do RDS + parâmetros SSM `database-url`/`jwt-secret` |

(mais o repositório `.github` com o perfil público da organização.)

**Contratos de integração:**

- **SSM Parameter Store** é o único acoplamento em runtime. `infra-db` produz
  `/oficina/<env>/database-url` e `/oficina/<env>/jwt-secret`; o CD de `app` produz
  `/oficina/<env>/app-lb-hostname` após o deploy; `app` e Lambdas leem o que precisam.
- **Terraform remote state em S3** liga **somente** os dois repositórios de infra:
  `infra-db` lê o state de `infra-k8s` para obter `vpc_id`, `public_subnet_ids` e
  `vpc_cidr_block`. Nenhum outro repositório lê state alheio.
- **Ordem de aplicação obrigatória:** `infra-k8s` → `infra-db` → primeiro deploy de `app`
  (publica `app-lb-hostname`) → `lambda-auth` (consome `app-lb-hostname` para apontar o
  proxy do gateway ao EKS).

## Consequências (positivas e negativas)

- **Positivo:** baixo acoplamento entre pipelines — cada repositório builda, testa e
  deploya sozinho; o cluster (muda raramente) fica desacoplado da aplicação (muda a cada
  PR); segredos nunca trafegam entre repositórios, só referências a nomes de parâmetro.
- **Negativo:** a ordem de deploy é uma dependência implícita que precisa ser documentada e
  respeitada manualmente — um `apply` fora de ordem falha com erro de parâmetro/state
  ausente. Mitigação: ordem registrada aqui, no
  [diagrama de componentes](../componentes.md) e nos READMEs dos repositórios de infra.
- **Negativo:** mudança de contrato (renomear um parâmetro SSM) exige coordenação entre
  dois repositórios num intervalo curto.
- **Negativo — reset do Academy:** os parâmetros SSM e o bucket de state podem sumir entre
  sessões; os pipelines de CD recriam ambos quando ausentes.
