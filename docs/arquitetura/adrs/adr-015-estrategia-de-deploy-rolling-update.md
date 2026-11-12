# ADR-015: Estratégia de deploy — rolling update do Kubernetes

- **Status:** Aceita
- **Data:** 2026-11-12

## Contexto

Cada serviço tem pipeline de CD próprio que publica a imagem no ECR e aplica os manifests no
EKS (`kubectl apply -k k8s/overlays/<env>`). É preciso escolher como a versão nova substitui a
antiga sem derrubar o serviço. As estratégias vistas na aula de deploy de microsserviços são
**rolling** (pods trocados aos poucos), **blue-green** (dois ambientes completos, com troca do
tráfego de uma vez) e **canary** (uma fração do tráfego vai para a versão nova antes do resto).

Os três serviços rodam no mesmo cluster do AWS Academy, com node group limitado, namespaces
`homolog` e `prod` ([ADR-004](adr-004-ambientes-por-namespace-e-banco-logico.md)) e HPA por CPU
([ADR-005](adr-005-hpa-por-cpu.md)).

## Decisão

**Rolling update do Kubernetes**, declarado explicitamente no Deployment de cada serviço
(`k8s/base/os-service-deployment.yaml`, `billing-service-deployment.yaml`,
`execution-service-deployment.yaml`):

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

- `maxUnavailable: 0`: nenhum pod antigo sai antes de um novo ficar pronto; `maxSurge: 1`: no
  máximo um pod a mais durante a troca.
- **Readiness probe em `/health/ready`**, que só responde 200 quando o banco do serviço está
  acessível (`SELECT 1` no Postgres do OS e do Execution; leitura na tabela DynamoDB do Billing).
  O Service só manda tráfego para o pod novo depois disso. A liveness e a startup probe usam
  `/health`.
- O CD espera o rollout terminar (`kubectl rollout status ... --timeout=300s`) e só então roda o
  smoke test e publica o hostname no SSM; rollout que não fica pronto falha o pipeline.
- Rollback manual com `kubectl rollout undo deployment/<serviço> -n <env>`, que volta para a
  revisão anterior do Deployment.
- **Homolog antes de prod**: push em `develop` faz deploy em `homolog` e push em `main` faz
  deploy em `prod`. A promoção é por PR `develop → main`, e homolog serve como etapa de
  validação da versão antes de produção.

## Alternativas consideradas

- **Blue-green**: descartada. Exige dois ambientes completos em paralelo (o dobro de pods) durante
  a troca, um custo que não cabe no node group nem no orçamento do Academy; o ganho — troca instantânea e volta instantânea — é coberto, para o volume do
  projeto, por rolling + probes + `kubectl rollout undo`.
- **Canary**: descartada. Pede divisão de tráfego por peso (service mesh ou controller de
  ingress) e métricas para decidir a promoção; é infraestrutura a mais para três serviços com
  pouco tráfego. A validação gradual fica a cargo de homolog.

## Consequências (positivas e negativas)

- **Positivo:** deploy sem indisponibilidade, sem recurso extra além de um pod durante a troca,
  e nativo do Kubernetes (nada a instalar no cluster).
- **Positivo:** um pod novo que não consegue falar com o banco nunca recebe tráfego, e o rollout
  para nele.
- **Negativo:** durante o rollout as duas versões atendem ao mesmo tempo. No `os-service` e no
  `execution-service` o job de migração roda antes do `kubectl apply -k`, então os pods antigos
  já rodam sobre o schema novo: as migrações precisam ser compatíveis com a versão anterior. O
  mesmo vale para mensagens — as duas versões consomem a mesma fila, e o contrato só evolui de
  forma compatível ([ADR-012](adr-012-outbox-e-idempotencia.md)).
- **Negativo:** o pod extra do surge precisa caber no node group; sem espaço, o rollout fica
  pendente até o `timeout` do CD.
- **Negativo:** não há volta automática; se o problema só aparecer depois do rollout (passou na
  readiness, falha no uso), o rollback é manual.
