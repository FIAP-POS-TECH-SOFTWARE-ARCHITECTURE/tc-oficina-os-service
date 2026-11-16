# ADR-002: API Gateway HTTP API com Lambda Authorizer e proxy HTTP

- **Status:** Aceita
- **Data:** 2026-09-10

> **Atualização na Fase 4:** o gateway passou a rotear `/billing/*` e `/execucao/*` para os
> novos serviços; o alvo de cada proxy vem de `/oficina/<env>/<servico>-lb-hostname`
> (`os-service`, `billing-service`, `execution-service`), não mais de `app-lb-hostname`.

## Contexto

O API Gateway precisa: (1) expor `POST /auth/token` para a Lambda de emissão de token;
(2) proteger as rotas sensíveis do cliente com validação do JWT emitido por essa Lambda;
(3) encaminhar as demais rotas para a API da oficina rodando no EKS. O JWT authorizer
nativo do API Gateway HTTP API só aceita tokens **RS256 com JWKS** — o token do grupo é
HS256 com segredo compartilhado ([ADR-003](adr-003-jwt-hs256-segredo-compartilhado.md)).

## Decisão

**API Gateway HTTP API** (um por ambiente), com:

- **Rota `POST /auth/token`** → integração Lambda proxy para `oficina-auth-token`.
- **Rotas sensíveis do cliente** → **Lambda REQUEST authorizer** (`oficina-auth-authorizer`)
  + integração **HTTP proxy** para o LoadBalancer do EKS.
- **Rota `ANY /{proxy+}`** → integração HTTP proxy para o EKS, sem authorizer (usuários
  internos autenticam na própria API).
- **`authorizer_result_ttl_in_seconds = 300`** — cache do resultado do authorizer por
  token.
- O alvo do proxy HTTP vem do parâmetro SSM `/oficina/<env>/app-lb-hostname`, lido pelo
  Terraform da Lambda no `apply`.

## Consequências (positivas e negativas)

- **Positivo:** o authorizer valida HS256 com o mesmo segredo do app — nenhuma
  infraestrutura de chave pública; o gateway barra tráfego não autenticado antes do
  cluster.
- **Positivo:** TTL de cache de 300s reduz invocações do authorizer e a latência extra por
  request para perto de zero na janela de cache.
- **Negativo:** o TTL de 300s significa que uma revogação de token (troca de segredo) só
  tem efeito pleno após 5 minutos no gateway; o `JwtAuthGuard` do app, sem cache, corta
  antes.
- **Negativo:** o proxy HTTP depende de `app-lb-hostname` já publicado — a Lambda só pode
  ser aplicada **após** o primeiro deploy do app (ordem em
  [ADR-001](adr-001-quatro-repositorios-e-contratos-ssm.md)).
- **Negativo:** JWT authorizer nativo descartado — reavaliar quando/se migrar para RS256.
