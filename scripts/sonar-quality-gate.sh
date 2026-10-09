#!/usr/bin/env bash
# Analisa o projeto no SonarQube e falha se o quality gate reprovar.
# Uso: bash scripts/sonar-quality-gate.sh  (requer coverage/lcov.info gerado por `npm run test:cov`)
# SONAR_HOST_URL: padrão http://localhost:9000
# SONAR_ADMIN_PASSWORD: só necessária se a instância já não usa a senha padrão do admin (ex.: SonarQube local persistente)
set -euo pipefail

SONAR_HOST_URL="${SONAR_HOST_URL:-http://localhost:9000}"
PROJECT_KEY="$(sed -n 's/^sonar\.projectKey=//p' sonar-project.properties | tr -d '\r')"
GATE="Cobertura 80"
SCANNER="@sonar/scan@5.0.1"

log() { echo "[sonar] $*"; }
falhar() {
	echo "[sonar] ERRO: $*" >&2
	exit 1
}

# Lê um campo (caminho separado por pontos) do JSON da entrada padrão; vazio se ausente ou inválido.
campo() {
	node -e '
		let d = "";
		process.stdin.on("data", (c) => (d += c)).on("end", () => {
			try {
				const v = process.argv[1].split(".").reduce((a, k) => (a == null ? a : a[k]), JSON.parse(d));
				process.stdout.write(v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
			} catch {
				process.stdout.write("");
			}
		});
	' "$1"
}

[ -n "$PROJECT_KEY" ] || falhar "sonar.projectKey ausente em sonar-project.properties"
[ -s coverage/lcov.info ] || falhar "coverage/lcov.info não encontrado; rode npm run test:cov antes"

# 1) Servidor pronto
log "aguardando $SONAR_HOST_URL ficar UP"
limite=$((SECONDS + 300))
until [ "$(curl -s "$SONAR_HOST_URL/api/system/status" | campo status)" = "UP" ]; do
	[ "$SECONDS" -lt "$limite" ] || falhar "SonarQube não ficou UP em 300s"
	sleep 5
done

# 2) Senha do admin (a instância nova exige troca da senha padrão)
SENHA="${SONAR_ADMIN_PASSWORD:-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("base64url") + "Aa1!")')}"
[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$SENHA"
http=$(curl -s -o /dev/null -w '%{http_code}' -u admin:admin -X POST "$SONAR_HOST_URL/api/users/change_password" \
	--data-urlencode "login=admin" --data-urlencode "previousPassword=admin" --data-urlencode "password=$SENHA")
case "$http" in
	200 | 204) log "senha padrão do admin substituída" ;;
	401)
		[ -n "${SONAR_ADMIN_PASSWORD:-}" ] || falhar "admin não usa mais a senha padrão; defina SONAR_ADMIN_PASSWORD"
		log "admin já configurado; usando SONAR_ADMIN_PASSWORD"
		;;
	*) falhar "troca da senha do admin respondeu HTTP $http" ;;
esac

# 3) Token descartável
TOKEN="$(curl -fsS -u "admin:$SENHA" -X POST "$SONAR_HOST_URL/api/user_tokens/generate" \
	--data-urlencode "name=analise-$(date +%s)" | campo token)"
[ -n "$TOKEN" ] || falhar "não foi possível gerar token"
[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$TOKEN"
api() { curl -fsS -u "$TOKEN:" "$@"; }

# 4) Quality gate próprio como padrão da instância (idempotente)
condicoes_do_gate() { api -G "$SONAR_HOST_URL/api/qualitygates/show" --data-urlencode "name=$GATE" | campo conditions; }
tem_metrica() { printf '%s' "$1" | grep -q "\"metric\":\"$2\""; }

if ! api -G "$SONAR_HOST_URL/api/qualitygates/show" --data-urlencode "name=$GATE" >/dev/null 2>&1; then
	api -X POST "$SONAR_HOST_URL/api/qualitygates/create" --data-urlencode "name=$GATE" >/dev/null
fi
# O gate novo já nasce com as condições "Clean as You Code", que incluem new_coverage;
# recriar uma condição existente responde 400, então só acrescenta a métrica que falta.
condicoes="$(condicoes_do_gate)"
for metrica in coverage new_coverage; do
	tem_metrica "$condicoes" "$metrica" || api -X POST "$SONAR_HOST_URL/api/qualitygates/create_condition" \
		--data-urlencode "gateName=$GATE" --data-urlencode "metric=$metrica" --data-urlencode "op=LT" --data-urlencode "error=80" >/dev/null
done
api -X POST "$SONAR_HOST_URL/api/qualitygates/set_as_default" --data-urlencode "name=$GATE" >/dev/null
condicoes="$(condicoes_do_gate)"
log "condições do gate '$GATE': $condicoes"
for metrica in coverage new_coverage; do
	tem_metrica "$condicoes" "$metrica" || falhar "gate '$GATE' sem condição para $metrica"
done

# 5) Análise
log "rodando $SCANNER para $PROJECT_KEY"
rm -rf .scannerwork
npx --yes "$SCANNER" -Dsonar.host.url="$SONAR_HOST_URL" -Dsonar.token="$TOKEN"

# 6) Espera o processamento da análise
TASK_ID="$(sed -n 's/^ceTaskId=//p' .scannerwork/report-task.txt | tr -d '\r')"
[ -n "$TASK_ID" ] || falhar ".scannerwork/report-task.txt sem ceTaskId"
limite=$((SECONDS + 300))
while :; do
	status_ce="$(api -G "$SONAR_HOST_URL/api/ce/task" --data-urlencode "id=$TASK_ID" | campo task.status)"
	case "$status_ce" in
		SUCCESS) break ;;
		FAILED | CANCELED) falhar "processamento da análise terminou em $status_ce" ;;
	esac
	[ "$SECONDS" -lt "$limite" ] || falhar "análise não processada em 300s"
	sleep 3
done

# 7) Resultado do quality gate
resultado="$(api -G "$SONAR_HOST_URL/api/qualitygates/project_status" --data-urlencode "projectKey=$PROJECT_KEY")"
status_gate="$(printf '%s' "$resultado" | campo projectStatus.status)"
cobertura="$(api -G "$SONAR_HOST_URL/api/measures/component" --data-urlencode "component=$PROJECT_KEY" \
	--data-urlencode "metricKeys=coverage" | campo component.measures.0.value)"
log "quality gate: ${status_gate:-desconhecido} | cobertura geral: ${cobertura:-?}%"
log "condições avaliadas: $(printf '%s' "$resultado" | campo projectStatus.conditions)"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
	{
		echo "### SonarQube: $PROJECT_KEY"
		echo ""
		echo "| Quality gate | Cobertura geral |"
		echo "|---|---|"
		echo "| ${status_gate:-?} | ${cobertura:-?}% |"
	} >>"$GITHUB_STEP_SUMMARY"
fi
[ "$status_gate" = "OK" ] || falhar "quality gate reprovado ($status_gate)"
log "quality gate aprovado"
