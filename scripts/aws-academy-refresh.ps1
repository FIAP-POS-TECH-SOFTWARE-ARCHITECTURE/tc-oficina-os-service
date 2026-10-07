# Uso:
#   1. AWS Academy -> Learner Lab -> AWS Details -> AWS CLI: Show -> copiar o bloco [default]
#   2. .\scripts\aws-academy-refresh.ps1   (cola o bloco, Enter, Ctrl+Z + Enter para finalizar)
# Atualiza ~/.aws/credentials, a região default e os secrets AWS_* dos 6 repositórios de trabalho (via gh CLI).

$ErrorActionPreference = "Stop"

Write-Host "Cole o bloco [default] do AWS Details (finalize com Ctrl+Z + Enter):"
$block = [Console]::In.ReadToEnd()

if ($block -notmatch "aws_access_key_id\s*=\s*(\S+)") { throw "aws_access_key_id não encontrado no bloco colado" }
$accessKey = $Matches[1]
if ($block -notmatch "aws_secret_access_key\s*=\s*(\S+)") { throw "aws_secret_access_key não encontrado" }
$secretKey = $Matches[1]
if ($block -notmatch "aws_session_token\s*=\s*(\S+)") { throw "aws_session_token não encontrado" }
$sessionToken = $Matches[1]

# Repositórios de trabalho que recebem os secrets AWS_*
$org = "FIAP-POS-TECH-SOFTWARE-ARCHITECTURE"
$repos = @(
    "tc-oficina-os-service",
    "tc-oficina-billing-service",
    "tc-oficina-execution-service",
    "tc-oficina-lambda-auth",
    "tc-oficina-infra-k8s",
    "tc-oficina-infra-db"
) | ForEach-Object { "$org/$_" }

# Valida todos antes de gravar qualquer secret (evita rotação parcial)
foreach ($repo in $repos) {
    gh repo view $repo --json name *> $null
    if ($LASTEXITCODE -ne 0) { throw "Repositório não encontrado ou sem acesso: $repo" }
}

# 1) ~/.aws/credentials
$awsDir = Join-Path $HOME ".aws"
New-Item -ItemType Directory -Force $awsDir | Out-Null
@"
[default]
aws_access_key_id = $accessKey
aws_secret_access_key = $secretKey
aws_session_token = $sessionToken
"@ | Set-Content (Join-Path $awsDir "credentials")
Write-Host "~/.aws/credentials atualizado."

# Região default: sem isso, todo comando aws sem --region falha com NoRegion
aws configure set region us-east-1
Write-Host "Região default configurada (us-east-1)."

# 2) GitHub Secrets nos repositórios de trabalho
foreach ($repo in $repos) {
    gh secret set AWS_ACCESS_KEY_ID --repo $repo --body $accessKey
    gh secret set AWS_SECRET_ACCESS_KEY --repo $repo --body $secretKey
    gh secret set AWS_SESSION_TOKEN --repo $repo --body $sessionToken
    Write-Host "Secrets atualizados em $repo"
}

aws sts get-caller-identity
Write-Host "Credenciais válidas. Pronto."
