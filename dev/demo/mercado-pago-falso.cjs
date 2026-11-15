// Imitação mínima da API de Orders do Mercado Pago para o ambiente de demonstração local (sem conta, sem rede externa).
// No compose ela responde como api.mercadopago.com (alias de rede + certificado próprio) e o billing usa o gateway real.
// Rotas imitadas: POST /v1/orders, GET /v1/orders/:id, GET /v1/orders?external_reference=, POST /v1/orders/:id/refund.
// Porta de controle (HTTP, só para a demo): POST /pagar?external_reference=<orcamentoId> aprova a order do orçamento.
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const { randomBytes } = require("node:crypto");

const CERTS = process.env.CERTS_DIR ?? "/certs";
const PORTA_CONTROLE = Number(process.env.PORTA_CONTROLE ?? 8090);
const orders = new Map();
const porChave = new Map();

const agora = () => new Date().toISOString();
const novoId = (prefixo) => `${prefixo}${randomBytes(8).toString("hex").toUpperCase()}`;

function responder(res, status, corpo) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(corpo));
}

function lerCorpo(req) {
	return new Promise((resolve) => {
		let dados = "";
		req.on("data", (parte) => (dados += parte));
		req.on("end", () => {
			try {
				resolve(dados ? JSON.parse(dados) : {});
			} catch {
				resolve({});
			}
		});
	});
}

function criarOrder(corpo) {
	const id = novoId("ORD");
	const order = {
		id,
		type: "online",
		status: "action_required",
		status_detail: "waiting_payment",
		external_reference: corpo.external_reference,
		description: corpo.description,
		total_amount: corpo.total_amount,
		total_paid_amount: "0.00",
		checkout_url: `https://mercado-pago-falso.local/checkout/${id}`,
		created_date: agora(),
		last_updated_date: agora(),
		items: corpo.items ?? [],
		transactions: { payments: [], refunds: [] },
	};
	orders.set(id, order);
	return order;
}

function pagar(order) {
	order.status = "processed";
	order.status_detail = "accredited";
	order.total_paid_amount = order.total_amount;
	order.last_updated_date = agora();
	order.transactions.payments = [
		{ id: novoId("PAY"), status: "processed", status_detail: "accredited", paid_amount: order.total_amount, payment_method: { id: "master" } },
	];
	return order;
}

function estornar(order) {
	if (order.status !== "refunded") {
		order.status = "refunded";
		order.status_detail = "refunded";
		order.last_updated_date = agora();
		order.transactions.refunds = [{ id: novoId("REF"), status: "processed", amount: order.total_paid_amount }];
		for (const p of order.transactions.payments) p.refunded_amount = p.paid_amount;
	}
	return order;
}

async function api(req, res) {
	const url = new URL(req.url, "https://api.mercadopago.com");
	const partes = url.pathname.split("/").filter(Boolean);
	console.log(JSON.stringify({ em: agora(), metodo: req.method, caminho: url.pathname, busca: url.search }));
	if (partes[0] !== "v1" || partes[1] !== "orders") return responder(res, 404, { message: "rota não imitada" });

	if (req.method === "POST" && partes.length === 2) {
		const corpo = await lerCorpo(req);
		const chave = req.headers["x-idempotency-key"];
		const existente = chave ? orders.get(porChave.get(chave)) : undefined;
		if (existente) return responder(res, 201, existente);
		const order = criarOrder(corpo);
		if (chave) porChave.set(chave, order.id);
		return responder(res, 201, order);
	}
	if (req.method === "GET" && partes.length === 2) {
		const referencia = url.searchParams.get("external_reference");
		const lista = [...orders.values()].filter((o) => !referencia || o.external_reference === referencia).reverse();
		return responder(res, 200, { data: lista });
	}
	const order = orders.get(partes[2]);
	if (!order) return responder(res, 404, { message: "order not found", status: 404 });
	if (req.method === "GET" && partes.length === 3) return responder(res, 200, order);
	if (req.method === "POST" && partes[3] === "refund") return responder(res, 201, estornar(order));
	return responder(res, 404, { message: "rota não imitada" });
}

async function controle(req, res) {
	const url = new URL(req.url, "http://localhost");
	if (req.method === "POST" && url.pathname === "/pagar") {
		const referencia = url.searchParams.get("external_reference");
		const order = [...orders.values()].reverse().find((o) => o.external_reference === referencia);
		if (!order) return responder(res, 404, { message: `nenhuma order para o orçamento ${referencia}` });
		console.log(JSON.stringify({ em: agora(), evento: "order-paga", id: order.id, referencia }));
		return responder(res, 200, pagar(order));
	}
	if (req.method === "GET" && url.pathname === "/orders") return responder(res, 200, [...orders.values()]);
	return responder(res, 404, { message: "rota de controle inexistente" });
}

https
	.createServer({ key: fs.readFileSync(`${CERTS}/servidor.key`), cert: fs.readFileSync(`${CERTS}/servidor.crt`) }, (req, res) => {
		api(req, res).catch((erro) => responder(res, 500, { message: erro.message }));
	})
	.listen(443, () => console.log("API de Orders imitada em https://api.mercadopago.com (porta 443)"));

http
	.createServer((req, res) => {
		controle(req, res).catch((erro) => responder(res, 500, { message: erro.message }));
	})
	.listen(PORTA_CONTROLE, () => console.log(`Controle da demo em http://localhost:${PORTA_CONTROLE}`));
