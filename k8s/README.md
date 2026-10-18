# Kubernetes - OS service

Manifestos de deploy da aplicação, organizados com **Kustomize**: `k8s/base/` tem os
recursos comuns e `k8s/overlays/<env>/` os ajustes por ambiente (`homolog`, `prod`).
`k8s/local/` contém dependências que **só existem para validação local no minikube**:
em produção o banco é o RDS provisionado via Terraform no repositório `tc-oficina-infra-db` e o SMTP é um
provedor real.

## Arquivos

| Arquivo | Recurso | Observação |
|---|---|---|
| `base/os-service-configmap.yaml` | ConfigMap `os-service-config` | Config **não sensível** (PORT, JWT_EXPIRES_IN, SMTP_HOST/PORT/FROM) |
| `base/os-service-deployment.yaml` | Deployment `os-service` | 2 réplicas, probes, `resources.requests/limits`, env do agente New Relic (`NODE_OPTIONS=-r newrelic`) |
| `base/os-service-service.yaml` | Service `os-service` | `LoadBalancer` (EKS) / `minikube service` (local) |
| `base/os-service-hpa.yaml` | HPA `os-service-hpa` | CPU 70%, 2→10 réplicas (`autoscaling/v2`) |
| `base/os-service-db-migrate-job.yaml` | Job `os-service-db-migrate` | Migração Prisma; **fora do kustomize**, aplicado pelo pipeline por ambiente |
| `base/kustomization.yaml` | — | Lista os recursos da base (sem o Job) |
| `overlays/homolog/kustomization.yaml` | — | `namespace: homolog`, `NEW_RELIC_APP_NAME=oficina-os-service-homolog` |
| `overlays/prod/kustomization.yaml` | — | `namespace: prod`, `NEW_RELIC_APP_NAME=oficina-os-service-prod` |
| `local/postgres.yaml` | Postgres + PVC + Service | **Só minikube** |
| `local/mailhog.yaml` | Mailhog + Service | **Só minikube** |

> O Secret `os-service-secrets` (DATABASE_URL, JWT_SECRET, INTERNAL_API_KEY, NEW_RELIC_LICENSE_KEY, credenciais
> SMTP/admin) **não** está versionado: é criado via `kubectl` (abaixo, para o minikube) ou
> pelo pipeline de CD (homolog/prod). NÃO commitar valores reais.

## Deploy (homolog / prod)

```bash
kubectl apply -k k8s/overlays/homolog   # ou .../prod
```

## Pré-requisitos (minikube)

```bash
minikube start
minikube addons enable metrics-server   # OBRIGATÓRIO: sem ele o HPA fica <unknown> e não escala
```

## Ordem de aplicação (minikube)

```bash
# 1. Construir a imagem DENTRO do minikube (o Deployment usa imagePullPolicy: IfNotPresent)
minikube image build -t os-service:local .

# 2. Dependências locais (banco + mailhog)
kubectl apply -f k8s/local/

# 3. Secret (NUNCA commitado; DATABASE_URL aponta para o Service `postgres` interno)
kubectl create secret generic os-service-secrets \
  --from-literal=DATABASE_URL='postgresql://postgres:password@postgres:5432/oficina' \
  --from-literal=JWT_SECRET='dev-secret' \
  --from-literal=INTERNAL_API_KEY='dev-internal-key' \
  --from-literal=ADMIN_BOOTSTRAP_EMAIL='admin@oficina.local' \
  --from-literal=ADMIN_BOOTSTRAP_PASSWORD='ChangeMe!123' \
  --from-literal=SMTP_USER='' \
  --from-literal=SMTP_PASS=''

# 4. Aplicação (ConfigMap + Deployment + Service + HPA) — a base, sem namespace/overlay
kubectl apply -k k8s/base

# 5. Acompanhar
kubectl get pods -w        # aguardar 2/2 Running, READY 1/1
kubectl get hpa            # TARGETS deve sair de <unknown> e mostrar % de CPU
```

> A primeira subida dos pods pode levar ~1–2 min: o `startupProbe` aguarda o entrypoint
> rodar `prisma migrate deploy` + seed antes de liberar liveness/readiness.

## Acesso à aplicação (minikube)

```bash
minikube service os-service --url     # imprime a URL (ex.: http://127.0.0.1:PORTA)
curl $(minikube service os-service --url)/health   # {"status":200,...,"data":{"status":"ok"}}
```

Alternativa: `minikube tunnel` (em outro terminal) para que o Service `LoadBalancer`
receba um EXTERNAL-IP acessível.

## Diferenças local × EKS

| Aspecto | Local (minikube) | Produção (EKS) |
|---|---|---|
| Banco | `k8s/local/postgres.yaml` (Service `postgres`) | RDS via Terraform; `DATABASE_URL` no Secret aponta para o endpoint do RDS |
| SMTP | Mailhog (`k8s/local/mailhog.yaml`) | Provedor real; `SMTP_HOST` sobrescrito no ConfigMap |
| Imagem | `os-service:local` construída no minikube | Imagem do ECR; a pipeline injeta repo+tag no overlay (placeholders `ci-placeholder-image`/`ci-placeholder-tag`) antes do `kubectl apply -k` |
| Service | `minikube service` / `tunnel` | `LoadBalancer` com ELB real |
| Métricas p/ HPA | addon `metrics-server` | metrics-server **não vem por padrão no EKS**: instalar manualmente (ver repositório `tc-oficina-infra-k8s`) |

## Troubleshooting

- **HPA `TARGETS: <unknown>`** → metrics-server ausente ou ainda coletando.
  - Minikube: habilitar o addon (`minikube addons enable metrics-server`) e aguardar ~30s.
  - EKS: metrics-server **não vem instalado por padrão**, ver a documentação do repositório `tc-oficina-infra-k8s`.
  - O HPA exige `resources.requests.cpu` no Deployment (já configurado).
- **Pod em `ImagePullBackOff`** → a imagem `os-service:local` não existe no minikube. Rode o
  `minikube image build` (passo 1). `imagePullPolicy: IfNotPresent` impede busca em registry.
- **Pod em `CrashLoopBackOff` no boot** → checar `kubectl logs <pod>`; geralmente `DATABASE_URL`
  incorreta no Secret (deve usar o host `postgres`, não `localhost`).

## Teste de carga (K6) - demonstração do HPA

Script em [`k6/load-test.js`](../k6/load-test.js). Gera carga em `GET /health` (público, isento
de rate limit) para elevar a CPU acima de 70% e disparar o autoscaling.

```bash
# terminal 1: acompanhar o HPA escalar:
kubectl get hpa os-service-hpa -w

# terminal 2: disparar a carga:
k6 run -e BASE_URL=$(minikube service os-service --url) k6/load-test.js
```

Esperado: a coluna `REPLICAS` do HPA sobe de 2 conforme a CPU passa de 70% (até no máx. 10),
e volta a 2 alguns minutos após o fim do teste (cooldown padrão do HPA).

> **Se não escalar:** a carga de `/health` pode ser leve demais para saturar a CPU. Reduza
> `resources.requests.cpu` do Deployment (ex.: `50m`), reaplique (`kubectl apply -k k8s/base`)
> e repita; assim uma utilização menor já ultrapassa os 70%.

