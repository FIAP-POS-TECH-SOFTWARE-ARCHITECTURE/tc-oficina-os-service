# Testando o CI/CD de ponta a ponta

Roteiro completo para validar o fluxo de CD (build da imagem → push no ECR → migração do banco → deploy no EKS → smoke test) a partir da sua máquina, antes e depois de disparar o pipeline de verdade.

> **Dependência:** a infraestrutura precisa estar de pé (cluster com nodes `Ready`, secret `os-service-secrets` criado e manifestos aplicados); o provisionamento fica nos repositórios `tc-oficina-infra-k8s` (VPC/EKS/ECR) e `tc-oficina-infra-db` (RDS). Sem isso, só os passos 2 e 3 funcionam.

## Pré-requisitos

- AWS CLI instalado (`aws --version`)
- kubectl instalado (`kubectl version --client`)
- Docker rodando (`docker info`)
- gh CLI autenticado (`gh auth status`)
- Sessão do AWS Academy ativa e credenciais renovadas (`.\scripts\aws-academy-refresh.ps1`)

## 1. Conferir credenciais e secrets do GitHub

O pipeline usa os secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e `AWS_SESSION_TOKEN`; o script de refresh atualiza os três junto com o `~/.aws/credentials`:

```powershell
aws sts get-caller-identity   # conta do lab, sem erro
gh secret list                # 3 secrets AWS_* com data de hoje
```

## 2. Validar o workflow localmente (sem AWS)

CI e CD são workflows separados: `ci.yml` roda em pull requests para `[main, develop]` (jobs `quality` e `e2e`); `cd.yml` é o de build + deploy, disparado por `push` em `[develop, main]` e por `workflow_dispatch`.

```powershell
npx --yes yaml-lint .github/workflows/ci.yml
npx --yes yaml-lint .github/workflows/cd.yml
```

**Esperado:** `YAML Lint successful.` nos dois.

Conferir os triggers e a escolha de ambiente por branch:

```powershell
Select-String -Path .github/workflows/cd.yml -Pattern "branches:|github.ref_name|environment="
```

**Esperado:** `branches: [develop, main]`; o step "Definir ambiente pela branch" mapeia `main` → `prod` e qualquer outra (`develop`) → `homolog`. Não há job com gate `if:` — o próprio trigger do `cd.yml` já restringe às duas branches.

## 3. Terraform

Este repositório não tem mais Terraform: a infra foi extraída para `tc-oficina-infra-k8s`
(VPC/EKS/ECR) e `tc-oficina-infra-db` (RDS), cada um com seu próprio CI de
`fmt -check` + `validate`. O `cd.yml` daqui só consome os contratos via SSM
(`/oficina/<env>/database-url`, `/oficina/<env>/jwt-secret`).

## 4. Simular o job docker (build + push manual no ECR)

Reproduz na mão o que o job `docker` faz, com uma tag de teste:

```powershell
$accountId = aws sts get-caller-identity --query Account --output text
$registry = "$accountId.dkr.ecr.us-east-1.amazonaws.com"
$image = "$registry/oficina-os-service:teste-local"

aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $registry
docker build -t $image .
docker push $image
```

**Esperado:** push concluído; conferir com:

```powershell
aws ecr describe-images --repository-name oficina-os-service --region us-east-1 --query "imageDetails[].imageTags" --output json
```

## 5. Simular o job deploy (migração + apply + rollout)

Mesma sequência do job `deploy`, usando a imagem do passo 4:

```powershell
$env = "homolog"   # ou "prod"
aws eks update-kubeconfig --region us-east-1 --name oficina-eks

# 5.1 Deploy do banco (migração como Job, bloqueante)
kubectl delete job os-service-db-migrate -n $env --ignore-not-found
(Get-Content k8s/base/os-service-db-migrate-job.yaml -Raw) -replace "PLACEHOLDER_IMAGE", $image | kubectl apply -n $env -f -
kubectl wait --for=condition=complete job/os-service-db-migrate -n $env --timeout=300s
kubectl logs job/os-service-db-migrate -n $env
```

**Esperado:** Job `Complete`; logs mostram `No pending migrations` ou a lista de migrações aplicadas.

```powershell
# 5.2 Manifestos + imagem nova (a pipeline injeta a imagem no overlay via sed
#     nos placeholders ci-placeholder-image / ci-placeholder-tag antes do apply)
$repo, $tag = $image -split ":", 2
(Get-Content k8s/overlays/$env/kustomization.yaml -Raw) `
  -replace "ci-placeholder-image", $repo -replace "ci-placeholder-tag", $tag `
  | Set-Content k8s/overlays/$env/kustomization.yaml
kubectl apply -k k8s/overlays/$env
kubectl rollout status deployment/os-service -n $env --timeout=300s
git checkout k8s/overlays/$env/kustomization.yaml   # desfaz a substituição local
```

**Esperado:** `deployment "os-service" successfully rolled out`.

```powershell
# 5.3 Smoke test via LoadBalancer
$url = kubectl get svc os-service -n $env -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
curl.exe -fsS "http://$url/health"
```

**Esperado:** resposta 200 do `/health`. O ELB pode levar ~2-3 min para ficar resolvível após o primeiro apply. Repetir o curl se der falha de DNS.

## 6. Testar o gate: branch de feature NÃO dispara CD

```powershell
git push origin HEAD    # push de uma branch feature/** ou fix/** qualquer
gh run list --workflow cd.yml --branch (git branch --show-current)
```

**Esperado:** nenhum run do `cd.yml` — o trigger é só `push` em `[develop, main]`. Abrir um PR dessa branch para `develop`/`main` dispara o `ci.yml` (`quality` + `e2e`), nunca o CD. Esse é o teste negativo: só `develop` e `main` fazem deploy (homolog e prod, respectivamente).

## 6.5. Testar o caminho de produção SEM merge (workflow_dispatch)

O trigger `workflow_dispatch` do `cd.yml` roda a pipeline completa (build → ECR → migração → deploy → smoke) a partir de qualquer branch. O ambiente vem da branch escolhida (`main` → prod, qualquer outra → homolog).

**Antes de disparar (checklist local):**

```powershell
.\scripts\aws-academy-refresh.ps1        # sessão do lab ativa + secrets AWS_* renovados
kubectl get nodes                        # cluster de pé, nodes Ready
kubectl describe secret os-service-secrets  # chaves com tamanhos reais (DATABASE_URL ~100 bytes, não 9)
git push origin HEAD                     # branch atualizada no remoto (o dispatch roda o que está LÁ, não o local)
```

**Disparar e acompanhar:**

```powershell
gh workflow run cd.yml --ref develop
gh run watch --exit-status
```

**Esperado:** o job `deploy` roda inteiro; deployment termina com a imagem `:<env>-<sha do HEAD da branch>`; `/health` responde 200. Também dá pra disparar pela interface: **Actions → CD → Run workflow**, escolhendo a branch.

## 7. Disparo real: push na main

Via PR (GitHub Flow):

```powershell
gh pr create --base main --title "..." --body "..."
# após aprovação/merge:
gh run watch --exit-status
```

**Esperado:** `ci.yml` (`quality` + `e2e`) verde no PR; após o merge na `main`, o `cd.yml` roda o job `deploy` (build → push ECR → migração → apply → rollout → smoke). Depois:

```powershell
kubectl get deployment os-service -o jsonpath='{.spec.template.spec.containers[0].image}'
```

**Esperado:** imagem com tag igual ao SHA do commit do merge (`git log -1 origin/main --format=%H`), não `teste-local`. E `curl http://<elb>/health` → 200.

## 8. Testar o runbook de credencial expirada (opcional)

Com a sessão do lab encerrada, re-rodar o workflow (`gh run rerun <id>`): os jobs `docker`/`deploy` falham com `ExpiredToken`/`UnrecognizedClientException` no log. Seguir o runbook do repositório `tc-oficina-infra-k8s`: reiniciar o lab, rodar o script de refresh e `gh run rerun --failed`, deve passar.

## 9. Limpeza

```powershell
kubectl delete job os-service-db-migrate --ignore-not-found
aws ecr batch-delete-image --repository-name oficina-os-service --region us-east-1 --image-ids imageTag=teste-local
```

Teardown completo da infra: ver os repositórios `tc-oficina-infra-k8s` e `tc-oficina-infra-db`.

## Checklist final

- [ ] `yaml-lint` de `ci.yml` e `cd.yml` passa
- [ ] Contratos SSM (`/oficina/<env>/database-url`, `/oficina/<env>/jwt-secret`) existem
- [ ] Build + push manual chegou no ECR
- [ ] Job de migração completa e loga migrações (ou `No pending migrations`)
- [ ] `rollout status` OK com a imagem nova; `/health` responde 200 via ELB
- [ ] Push em branch de feature: `cd.yml` não dispara (só `develop`/`main`)
- [ ] Push na `develop`/`main`: `cd.yml` verde, deployment rodando a imagem `:<env>-<sha>`
- [ ] Runbook de credencial expirada funciona (`gh run rerun --failed` após refresh)

## Problemas comuns

| Sintoma                                           | Causa provável                                    | Ação                                                                       |
| ------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `ExpiredToken` / `UnrecognizedClientException`    | Sessão do lab expirou                             | Runbook do repositório `tc-oficina-infra-k8s`: refresh + `gh run rerun` |
| `no basic auth credentials` no push               | Login do ECR expirou (12h)                        | Repetir o `docker login` do passo 4                                        |
| Job de migração em `Error`/`BackoffLimitExceeded` | `DATABASE_URL` errada no secret ou RDS fora do ar | `kubectl logs job/os-service-db-migrate`; conferir secret e RDS               |
| `kubectl wait` estoura timeout                    | Imagem grande (pull lento) ou migração travada    | `kubectl describe job os-service-db-migrate` e logs do pod                    |
| Smoke test falha com DNS                          | ELB recém-criado ainda propagando                 | Aguardar ~2-3 min e repetir o curl                                         |
| `docker`/`deploy` skipped num push na main        | Evento não é `push` (ex.: rerun de PR antigo)     | Conferir `github.event_name` no log do run                                 |
| Rollout trava com `ImagePullBackOff`              | Tag inexistente no ECR ou repo errado             | `aws ecr describe-images`; conferir output `image` do job docker           |
| Pod `0/1` com erro Prisma `URL must start with postgresql://` | Secret `os-service-secrets` com valores placeholder (sobrescrito ou criado errado) | `kubectl describe secret os-service-secrets` (todas as chaves com 9 bytes = `CHANGE_ME`); recriar o secret (ver repositório `tc-oficina-infra-k8s`) |
