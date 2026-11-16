#!/usr/bin/env bash
# Sobe (ou derruba) o ambiente local da demonstração: os-service, billing-service e execution-service em Docker,
# com Postgres próprios, um único MiniStack (filas, tópico e DynamoDB) e a imitação da API de Orders do Mercado Pago.
# Uso: bash scripts/ambiente-demo-local.sh <up|down|logs|status>
# Variáveis opcionais:
#   BILLING_DIR, EXECUCAO_DIR  checkouts dos outros serviços (padrão: pastas irmãs deste repositório)
#   MERCADO_PAGO_DEMO          falso (padrão: gateway real do billing contra a API imitada) | simulado (GatewayPagamentoSimulado)
#   CERTS_DIR                  onde gerar o certificado da API imitada (padrão: diretório temporário do sistema)
set -euo pipefail

ACAO="${1:-up}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAI="$(dirname "$RAIZ")"
BILLING_DIR="${BILLING_DIR:-$PAI/tc-oficina-billing-service}"
EXECUCAO_DIR="${EXECUCAO_DIR:-$PAI/tc-oficina-execution-service}"
CERTS_DIR="${CERTS_DIR:-${TMPDIR:-/tmp}/oficina-demo-certs}"
MERCADO_PAGO_DEMO="${MERCADO_PAGO_DEMO:-falso}"
COMPOSE_ARQ="$RAIZ/dev/demo/docker-compose.yml"

# Docker Desktop no Windows (Git Bash) espera caminhos C:/...; em Linux/macOS o caminho fica como está.
caminho_docker() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

gerar_certificados() {
	[ -f "$CERTS_DIR/servidor.crt" ] && return 0
	command -v openssl >/dev/null 2>&1 || { echo "openssl não encontrado (necessário para o certificado da API imitada)" >&2; exit 1; }
	mkdir -p "$CERTS_DIR"
	# MSYS2_ARG_CONV_EXCL evita que o Git Bash converta "/CN=..." em caminho do Windows.
	MSYS2_ARG_CONV_EXCL='*' openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=Oficina Demo CA" \
		-keyout "$CERTS_DIR/ca.key" -out "$CERTS_DIR/ca.crt" 2>/dev/null
	MSYS2_ARG_CONV_EXCL='*' openssl req -newkey rsa:2048 -nodes -subj "/CN=api.mercadopago.com" \
		-keyout "$CERTS_DIR/servidor.key" -out "$CERTS_DIR/servidor.csr" 2>/dev/null
	printf 'subjectAltName=DNS:api.mercadopago.com\nextendedKeyUsage=serverAuth\n' >"$CERTS_DIR/ext.cnf"
	openssl x509 -req -in "$CERTS_DIR/servidor.csr" -CA "$CERTS_DIR/ca.crt" -CAkey "$CERTS_DIR/ca.key" -CAcreateserial \
		-days 30 -extfile "$CERTS_DIR/ext.cnf" -out "$CERTS_DIR/servidor.crt" 2>/dev/null
	# O container roda com outro usuário: a chave precisa ser legível pelo volume somente leitura.
	chmod 644 "$CERTS_DIR"/*
}

for d in "$BILLING_DIR" "$EXECUCAO_DIR"; do
	[ -f "$d/Dockerfile" ] || { echo "checkout não encontrado: $d (defina BILLING_DIR/EXECUCAO_DIR)" >&2; exit 1; }
done

case "$MERCADO_PAGO_DEMO" in
falso) MERCADO_PAGO_ACCESS_TOKEN_DEMO="TEST-demo-local-sem-conta" ;;
simulado) MERCADO_PAGO_ACCESS_TOKEN_DEMO="" ;;
*) echo "MERCADO_PAGO_DEMO deve ser falso ou simulado" >&2; exit 1 ;;
esac

gerar_certificados
OS_DIR="$(caminho_docker "$RAIZ")"
BILLING_DIR="$(caminho_docker "$BILLING_DIR")"
EXECUCAO_DIR="$(caminho_docker "$EXECUCAO_DIR")"
CERTS_DIR="$(caminho_docker "$CERTS_DIR")"
export OS_DIR BILLING_DIR EXECUCAO_DIR CERTS_DIR MERCADO_PAGO_ACCESS_TOKEN_DEMO

compose() { docker compose -f "$(caminho_docker "$COMPOSE_ARQ")" "$@"; }

esperar_saude() { # esperar_saude NOME URL
	for _ in $(seq 1 90); do
		if curl -fsS "$2" >/dev/null 2>&1; then echo "  $1 ok ($2)"; return 0; fi
		sleep 2
	done
	echo "  $1 não respondeu em $2" >&2
	return 1
}

case "$ACAO" in
up)
	compose up -d --build
	echo "Aguardando os serviços..."
	esperar_saude os-service http://localhost:3000/health
	esperar_saude billing-service http://localhost:3002/health
	esperar_saude execution-service http://localhost:3001/health
	cat <<-EOF

		Ambiente no ar (Mercado Pago: $MERCADO_PAGO_DEMO). Para a demonstração:
		  OS_URL=http://localhost:3000 BILLING_URL=http://localhost:3002 EXECUCAO_URL=http://localhost:3001 \\
		  ADMIN_EMAIL=admin@oficina.local ADMIN_SENHA='ChangeMe!123' \\
		  JWT_SECRET=a3f9c1d8e7b2f4a6c9d1e0b3a5f7c8d9e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6 \\
		  MERCADO_PAGO_WEBHOOK_SECRET=segredo-local MP_FALSO_URL=http://localhost:8090 \\
		  bash scripts/demo-fluxo.sh feliz --webhook-simulado
	EOF
	;;
down) compose down -v --remove-orphans ;;
logs) compose logs -f --tail 100 "${@:2}" ;;
status) compose ps ;;
*) echo "uso: $0 <up|down|logs|status>" >&2; exit 1 ;;
esac
