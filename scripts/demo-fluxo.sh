#!/usr/bin/env bash
# Demonstração do fluxo da OS pelos microsserviços (os-service, billing-service e execution-service).
# Uso: GATEWAY_URL=https://... ADMIN_EMAIL=... ADMIN_SENHA=... bash scripts/demo-fluxo.sh <feliz|rejeicao|inviavel> [--webhook-simulado]
#
# Variáveis:
#   GATEWAY_URL                 URL do API Gateway (padrão: aws apigatewayv2 get-apis, API oficina-api-$AMBIENTE)
#   OS_URL, BILLING_URL,        URL de cada serviço (padrão: GATEWAY_URL); localmente, sem gateway, aponte para
#   EXECUCAO_URL                cada serviço (ver scripts/ambiente-demo-local.sh)
#   ADMIN_EMAIL, ADMIN_SENHA    administrador do bootstrap (obrigatórios)
#   MECANICO_EMAIL/_SENHA       mecânico da demo; criado via POST /usuarios se o login falhar
#   CPF_CLIENTE                 cliente do seed (padrão: 52998224725, Maria Souza)
#   CLIENTE_TOKEN               token de cliente pronto; sem ele, pede à Lambda (POST /auth/token) quando há
#                               GATEWAY_URL ou assina localmente com JWT_SECRET (mesmas claims da Lambda)
#   MERCADO_PAGO_WEBHOOK_SECRET obrigatório com --webhook-simulado (assina a notificação)
#   MP_FALSO_URL                controle da API de Orders imitada do ambiente local (aprova a order antes do webhook)
#   TIMEOUT_PASSO               segundos de espera por evento (padrão: 60)
# Requer curl e node (leitura de JSON, assinatura do webhook e do token local).
# O JavaScript em aspas simples usa ${} de template string de propósito.
# shellcheck disable=SC2016
set -euo pipefail

CENARIO="${1:-}"
SIMULADO="${2:-}"
case "$CENARIO" in feliz | rejeicao | inviavel) ;; *) echo "uso: $0 <feliz|rejeicao|inviavel> [--webhook-simulado]" >&2; exit 2 ;; esac
case "$SIMULADO" in "" | --webhook-simulado) ;; *) echo "opção desconhecida: $SIMULADO" >&2; exit 2 ;; esac

AMBIENTE="${AMBIENTE:-homolog}"
if [ -z "${GATEWAY_URL:-}" ] && { [ -z "${OS_URL:-}" ] || [ -z "${BILLING_URL:-}" ] || [ -z "${EXECUCAO_URL:-}" ]; }; then
	GATEWAY_URL="$(aws apigatewayv2 get-apis --query "Items[?Name=='oficina-api-$AMBIENTE'].ApiEndpoint | [0]" --output text 2>/dev/null || true)"
	[ -n "$GATEWAY_URL" ] && [ "$GATEWAY_URL" != "None" ] || { echo "defina GATEWAY_URL (ou OS_URL, BILLING_URL e EXECUCAO_URL)" >&2; exit 2; }
fi
GATEWAY_URL="${GATEWAY_URL:-}"
OS_URL="${OS_URL:-$GATEWAY_URL}"
BILLING_URL="${BILLING_URL:-$GATEWAY_URL}"
EXECUCAO_URL="${EXECUCAO_URL:-$GATEWAY_URL}"
: "${ADMIN_EMAIL:?defina ADMIN_EMAIL}" "${ADMIN_SENHA:?defina ADMIN_SENHA}"
MECANICO_EMAIL="${MECANICO_EMAIL:-mecanico@oficina.local}"
MECANICO_SENHA="${MECANICO_SENHA:-Mecanico@2024}"
CPF_CLIENTE="${CPF_CLIENTE:-52998224725}"
TIMEOUT_PASSO="${TIMEOUT_PASSO:-60}"
if [ "$SIMULADO" = "--webhook-simulado" ]; then : "${MERCADO_PAGO_WEBHOOK_SECRET:?defina MERCADO_PAGO_WEBHOOK_SECRET para --webhook-simulado}"; fi

N=0
passo() {
	N=$((N + 1))
	printf '\n\033[1;36m[%s] %d. %s\033[0m\n' "$(date +%H:%M:%S)" "$N" "$*"
}
info() { printf '   %s\n' "$*"; }
falhar() {
	printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2
	exit 1
}

# json EXPR: lê JSON do stdin e imprime o resultado da expressão JS sobre `d` (objeto vira JSON, nulo vira vazio).
json() {
	node -e '
		let s = "";
		process.stdin.on("data", (c) => (s += c)).on("end", () => {
			let v;
			try { v = new Function("d", `return (${process.argv[1]})`)(JSON.parse(s)); } catch { v = undefined; }
			process.stdout.write(v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
		});' "$1"
}

# requisitar METODO URL TOKEN [JSON]: preenche HTTP_STATUS e HTTP_CORPO; QUIETO=1 não imprime o resumo.
requisitar() {
	local m="$1" u="$2" t="$3" b="${4:-}" saida
	local args=(-sS -X "$m" "$u" -H 'content-type: application/json' -w $'\n%{http_code}')
	[ -n "$t" ] && args+=(-H "authorization: Bearer $t")
	[ -n "$b" ] && args+=(-d "$b")
	saida="$(curl "${args[@]}")" || falhar "sem resposta de $u"
	HTTP_STATUS="${saida##*$'\n'}"
	HTTP_CORPO="${saida%$'\n'*}"
	if [ -z "${QUIETO:-}" ]; then
		info "-> $m /${u#*://*/}${b:+ $b}"
		info "<- HTTP $HTTP_STATUS"
	fi
}

# api METODO URL TOKEN [JSON]: como requisitar, mas aborta mostrando a resposta se o status for >= 400.
api() {
	requisitar "$@"
	[ "$HTTP_STATUS" -lt 400 ] || falhar "$1 $2 respondeu $HTTP_STATUS: $HTTP_CORPO"
}

status_os() {
	QUIETO=1 api GET "$OS_URL/os/$OS_ID" "$TOKEN_ADMIN"
	json 'd.data.status' <<<"$HTTP_CORPO"
}

# esperar_status STATUS: polling em GET /os/:id até a OS chegar ao status, mostrando as mudanças no caminho.
esperar_status() {
	local alvo="$1" atual="" anterior="" limite=$((SECONDS + TIMEOUT_PASSO))
	while [ "$SECONDS" -lt "$limite" ]; do
		atual="$(status_os)"
		[ "$atual" != "$anterior" ] && info "OS $NUMERO_OS: $atual"
		[ "$atual" = "$alvo" ] && { printf '   \033[1;32mOS em %s\033[0m\n' "$atual"; return 0; }
		anterior="$atual"
		sleep 2
	done
	falhar "timeout de ${TIMEOUT_PASSO}s esperando $alvo (atual: $atual)"
}

consultar_fluxo() {
	QUIETO=1 api GET "$OS_URL/orquestracao/fluxos/$OS_ID" "$TOKEN_ADMIN"
	FLUXO="$HTTP_CORPO"
}

mostrar_fluxo() {
	consultar_fluxo
	info "fluxo: $(json '`etapa=${d.data.fluxo.etapa} status=${d.data.fluxo.status} compensacoesFeitas=${JSON.stringify(d.data.fluxo.compensacoesFeitas)} pendentes=${JSON.stringify(d.data.fluxo.compensacoesPendentes)}`' <<<"$FLUXO")"
	info "mensagens: $(json 'd.data.mensagens.map((m) => m.tipo).join(", ")' <<<"$FLUXO")"
}

# esperar_fluxo STATUS: polling em GET /orquestracao/fluxos/:osId até o status do fluxo.
esperar_fluxo() {
	local alvo="$1" atual="" limite=$((SECONDS + TIMEOUT_PASSO))
	while [ "$SECONDS" -lt "$limite" ]; do
		consultar_fluxo
		atual="$(json 'd.data.fluxo.status' <<<"$FLUXO")"
		[ "$atual" = "$alvo" ] && { mostrar_fluxo; return 0; }
		sleep 2
	done
	mostrar_fluxo
	falhar "timeout de ${TIMEOUT_PASSO}s esperando o fluxo em $alvo (atual: $atual)"
}

# pegar_proxima ETAPA: reserva a próxima ordem da fila do mecânico, esperando a ordem desta OS chegar.
pegar_proxima() {
	local etapa="$1" limite=$((SECONDS + TIMEOUT_PASSO)) os_da_ordem
	while [ "$SECONDS" -lt "$limite" ]; do
		QUIETO=1 requisitar POST "$EXECUCAO_URL/execucao/fila/$etapa/proxima" "$TOKEN_MEC"
		if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
			info "-> POST /execucao/fila/$etapa/proxima"
			info "<- HTTP $HTTP_STATUS"
			os_da_ordem="$(json 'd.data.osId' <<<"$HTTP_CORPO")"
			[ "$os_da_ordem" = "$OS_ID" ] || falhar "a fila de $etapa entregou a ordem da OS $os_da_ordem (esvazie a fila antes da demo)"
			ORDEM_ID="$(json 'd.data.id' <<<"$HTTP_CORPO")"
			info "ordem de execução $ORDEM_ID reservada ($(json 'd.data.status' <<<"$HTTP_CORPO"))"
			return 0
		fi
		[ "$HTTP_STATUS" = "404" ] || falhar "fila de $etapa respondeu $HTTP_STATUS: $HTTP_CORPO"
		sleep 2
	done
	falhar "timeout de ${TIMEOUT_PASSO}s esperando a ordem na fila de $etapa"
}

login() { # login EMAIL SENHA -> imprime o token (vazio se recusado)
	QUIETO=1 requisitar POST "$OS_URL/auth/login" "" "{\"email\":\"$1\",\"senha\":\"$2\"}"
	[ "$HTTP_STATUS" -lt 400 ] && json 'd.data.accessToken' <<<"$HTTP_CORPO"
	return 0
}

gerar_token_cliente_local() { # mesmas claims e algoritmo da Lambda de autenticação (HS256, 1 h)
	node -e '
		const { createHmac } = require("node:crypto");
		const [sub, nome, cpf, segredo] = process.argv.slice(1);
		const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
		const iat = Math.floor(Date.now() / 1000);
		const corpo = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, nome, cpf, type: "cliente", iat, exp: iat + 3600 })}`;
		process.stdout.write(`${corpo}.${createHmac("sha256", segredo).update(corpo).digest("base64url")}`);' "$1" "$2" "$3" "$JWT_SECRET"
}

# enviar_webhook ORDER_ID: notificação de order no formato do Mercado Pago, com x-signature válida.
enviar_webhook() {
	local order="$1" request_id ts assinatura
	request_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
	ts="$(node -e 'process.stdout.write(String(Date.now()))')"
	assinatura="$(node -e '
		const [id, rid, ts, segredo] = process.argv.slice(1);
		const v1 = require("node:crypto").createHmac("sha256", segredo).update(`id:${id.toLowerCase()};request-id:${rid};ts:${ts};`).digest("hex");
		process.stdout.write(`ts=${ts},v1=${v1}`);' "$order" "$request_id" "$ts" "$MERCADO_PAGO_WEBHOOK_SECRET")"
	local corpo="{\"type\":\"order\",\"action\":\"order.processed\",\"data\":{\"id\":\"$order\"}}"
	info "-> POST /billing/webhooks/mercado-pago?data.id=$order&type=order (x-signature ts=$ts)"
	local saida
	saida="$(curl -sS -X POST "$BILLING_URL/billing/webhooks/mercado-pago?data.id=$order&type=order" \
		-H 'content-type: application/json' -H "x-request-id: $request_id" -H "x-signature: $assinatura" \
		-d "$corpo" -w $'\n%{http_code}')" || falhar "sem resposta do webhook"
	HTTP_STATUS="${saida##*$'\n'}"
	HTTP_CORPO="${saida%$'\n'*}"
	info "<- HTTP $HTTP_STATUS $HTTP_CORPO"
	[ "$HTTP_STATUS" = "200" ] || falhar "webhook recusado"
}

echo "Cenário: $CENARIO${SIMULADO:+ ($SIMULADO)}"
echo "os: $OS_URL | billing: $BILLING_URL | execução: $EXECUCAO_URL"

passo "Autenticação: administrador, mecânico e cliente"
TOKEN_ADMIN="$(login "$ADMIN_EMAIL" "$ADMIN_SENHA")"
[ -n "$TOKEN_ADMIN" ] || falhar "login do administrador recusado ($ADMIN_EMAIL)"
info "administrador autenticado (POST /auth/login)"
TOKEN_MEC="$(login "$MECANICO_EMAIL" "$MECANICO_SENHA")"
if [ -z "$TOKEN_MEC" ]; then
	info "mecânico $MECANICO_EMAIL não existe: criando"
	api POST "$OS_URL/usuarios" "$TOKEN_ADMIN" "{\"nome\":\"Mecânico da Demo\",\"email\":\"$MECANICO_EMAIL\",\"senha\":\"$MECANICO_SENHA\",\"role\":\"MECANICO\"}"
	TOKEN_MEC="$(login "$MECANICO_EMAIL" "$MECANICO_SENHA")"
	[ -n "$TOKEN_MEC" ] || falhar "login do mecânico recusado depois de criado"
fi
info "mecânico autenticado ($MECANICO_EMAIL)"

api GET "$OS_URL/clientes/buscar?documento=$CPF_CLIENTE" "$TOKEN_ADMIN"
CLIENTE_ID="$(json 'd.data.id' <<<"$HTTP_CORPO")"
CLIENTE_NOME="$(json 'd.data.nome' <<<"$HTTP_CORPO")"
[ -n "$CLIENTE_ID" ] || falhar "cliente com CPF $CPF_CLIENTE não encontrado"
if [ -n "${CLIENTE_TOKEN:-}" ]; then
	info "token de cliente recebido em CLIENTE_TOKEN"
elif [ -n "$GATEWAY_URL" ] && [ -z "${JWT_SECRET:-}" ]; then
	api POST "$GATEWAY_URL/auth/token" "" "{\"cpf\":\"$CPF_CLIENTE\"}"
	CLIENTE_TOKEN="$(json 'd.token' <<<"$HTTP_CORPO")"
else
	: "${JWT_SECRET:?defina CLIENTE_TOKEN, GATEWAY_URL (Lambda) ou JWT_SECRET para o token de cliente}"
	CLIENTE_TOKEN="$(gerar_token_cliente_local "$CLIENTE_ID" "$CLIENTE_NOME" "$CPF_CLIENTE")"
	info "sem gateway: token de cliente assinado localmente (claims da Lambda, type=cliente)"
fi
info "cliente $CLIENTE_NOME ($CLIENTE_ID)"

passo "Atendente abre a OS para o veículo do cliente"
api GET "$OS_URL/clientes/$CLIENTE_ID/veiculos" "$TOKEN_ADMIN"
VEICULO_ID="$(json 'd.data[0].id' <<<"$HTTP_CORPO")"
[ -n "$VEICULO_ID" ] || falhar "cliente sem veículo cadastrado"
info "veículo $(json 'd.data[0].placa + " " + d.data[0].modelo' <<<"$HTTP_CORPO")"
api POST "$OS_URL/os" "$TOKEN_ADMIN" "{\"clienteId\":\"$CLIENTE_ID\",\"veiculoId\":\"$VEICULO_ID\"}"
OS_ID="$(json 'd.data.id' <<<"$HTTP_CORPO")"
NUMERO_OS="$(json 'd.data.numero' <<<"$HTTP_CORPO")"
info "OS $NUMERO_OS ($OS_ID)"
esperar_status RECEBIDA
sleep 3
mostrar_fluxo

passo "Mecânico pega a OS na fila de diagnóstico"
pegar_proxima DIAGNOSTICO
esperar_status EM_DIAGNOSTICO

passo "Mecânico registra o diagnóstico com 1 serviço e 1 insumo do catálogo"
api GET "$EXECUCAO_URL/execucao/catalogo/servicos" "$TOKEN_MEC"
# Itens coerentes com o texto do diagnóstico; sem eles no catálogo, usa o primeiro de cada lista
SERVICO="(d.data.find(s => /troca de óleo/i.test(s.nome)) || d.data[0])"
SERVICO_ID="$(json "$SERVICO.id" <<<"$HTTP_CORPO")"
info "serviço: $(json "$SERVICO.nome" <<<"$HTTP_CORPO")"
api GET "$EXECUCAO_URL/execucao/catalogo/insumos" "$TOKEN_MEC"
INSUMO="(d.data.find(i => /óleo de motor/i.test(i.nome)) || d.data[0])"
INSUMO_ID="$(json "$INSUMO.id" <<<"$HTTP_CORPO")"
info "insumo: $(json "$INSUMO.nome" <<<"$HTTP_CORPO")"
api POST "$EXECUCAO_URL/execucao/ordens/$ORDEM_ID/diagnostico" "$TOKEN_MEC" \
	"{\"diagnostico\":\"Óleo vencido e filtro saturado.\",\"itens\":[{\"tipo\":\"SERVICO\",\"referenciaId\":\"$SERVICO_ID\",\"quantidade\":1},{\"tipo\":\"INSUMO\",\"referenciaId\":\"$INSUMO_ID\",\"quantidade\":1}]}"
esperar_status AGUARDANDO_APROVACAO

passo "Cliente consulta o orçamento"
api GET "$BILLING_URL/billing/cliente/orcamentos/$NUMERO_OS" "$CLIENTE_TOKEN"
ORCAMENTO_ID="$(json 'd.data.id' <<<"$HTTP_CORPO")"
info "orçamento $ORCAMENTO_ID: $(json '`${d.data.status}, total ${d.data.valorTotalCentavos} centavos, ${d.data.itens.length} itens`' <<<"$HTTP_CORPO")"

if [ "$CENARIO" = "rejeicao" ]; then
	passo "Cliente rejeita o orçamento"
	api POST "$BILLING_URL/billing/cliente/orcamentos/$NUMERO_OS/rejeitar" "$CLIENTE_TOKEN" '{"motivo":"Valor acima do esperado"}'
	esperar_status CANCELADA
	esperar_fluxo COMPENSADO
	printf '\n\033[1;32mFim: OS %s CANCELADA, fluxo COMPENSADO\033[0m\n' "$NUMERO_OS"
	exit 0
fi

passo "Cliente aprova o orçamento"
api POST "$BILLING_URL/billing/cliente/orcamentos/$NUMERO_OS/aprovar" "$CLIENTE_TOKEN"
info "linkPagamento: $(json 'd.data.linkPagamento' <<<"$HTTP_CORPO")"
esperar_status AGUARDANDO_PAGAMENTO

passo "Pagamento"
if [ "$SIMULADO" = "--webhook-simulado" ]; then
	if [ -n "${MP_FALSO_URL:-}" ]; then
		api POST "$MP_FALSO_URL/pagar?external_reference=$ORCAMENTO_ID" ""
		ORDER_ID="$(json 'd.id' <<<"$HTTP_CORPO")"
		info "order $ORDER_ID aprovada na API de Orders imitada"
	elif [ -z "${ORDER_ID:-}" ]; then
		read -rp "   Pague no link com o cartão de teste e informe o id da order (ORD...): " ORDER_ID
	fi
	enviar_webhook "$ORDER_ID"
	RESULTADO="$(json 'd.data && d.data.resultado' <<<"$HTTP_CORPO")"
	case "$RESULTADO" in
	CONFIRMADO | JA_REGISTRADO) ;;
	*) falhar "o billing não confirmou o pagamento (resultado: ${RESULTADO:-?}); com o gateway simulado não há order para consultar" ;;
	esac
else
	read -rp "   Pague no link com o cartão de teste e pressione ENTER " _
fi
esperar_status EM_EXECUCAO

passo "Mecânico pega a OS na fila de reparo"
pegar_proxima REPARO

if [ "$CENARIO" = "inviavel" ]; then
	passo "Mecânico declara o reparo inviável"
	api POST "$EXECUCAO_URL/execucao/ordens/$ORDEM_ID/reparo/inviavel" "$TOKEN_MEC" '{"motivo":"Peça fora de linha no fabricante"}'
	esperar_status CANCELADA
	esperar_fluxo COMPENSADO
	passo "Atendimento confere o orçamento estornado"
	limite=$((SECONDS + TIMEOUT_PASSO))
	while :; do
		QUIETO=1 api GET "$BILLING_URL/billing/orcamentos/$NUMERO_OS" "$TOKEN_ADMIN"
		STATUS_ORC="$(json 'd.data.status' <<<"$HTTP_CORPO")"
		case "$STATUS_ORC" in ESTORNADO | ESTORNO_PENDENTE) break ;; esac
		[ "$SECONDS" -lt "$limite" ] || falhar "orçamento não foi estornado (status: $STATUS_ORC)"
		sleep 2
	done
	info "-> GET /billing/orcamentos/$NUMERO_OS"
	info "orçamento: $(json '`${d.data.status}, pagamento ${d.data.pagamentoId}`' <<<"$HTTP_CORPO")"
	printf '\n\033[1;32mFim: OS %s CANCELADA, fluxo COMPENSADO, orçamento %s\033[0m\n' "$NUMERO_OS" "$STATUS_ORC"
	exit 0
fi

passo "Mecânico conclui o reparo"
api POST "$EXECUCAO_URL/execucao/ordens/$ORDEM_ID/reparo/concluir" "$TOKEN_MEC"
esperar_status FINALIZADA
esperar_fluxo CONCLUIDO
printf '\n\033[1;32mFim: OS %s FINALIZADA, fluxo CONCLUIDO\033[0m\n' "$NUMERO_OS"
