import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { autoBindSteps, loadFeature, StepDefinitions } from "jest-cucumber";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { criarEnvelope, EnvelopeMensagem } from "../../../src/modules/mensageria/envelope";
import { FilaComando } from "../../../src/modules/mensageria/configuracao-mensageria";
import { PUBLICADOR_MENSAGENS, PublicadorMensagensPort } from "../../../src/modules/mensageria/publicador-mensagens.port";
import { RelayOutbox } from "../../../src/modules/mensageria/relay-outbox";
import { ValidadorContratos } from "../../../src/modules/mensageria/validador-contratos";
import { RegistrarEntradaInsumoUseCase } from "../../../src/modules/insumos/application/use-cases/registrar-entrada-insumo.use-case";
import { OrquestradorOrdemServico } from "../../../src/modules/orquestracao-os/application/orquestrador-ordem-servico";
import { CriarOsUseCase } from "../../../src/modules/ordens-servico/application/use-cases/criar-os.use-case";
import { PrismaService } from "../../../src/prisma/prisma.service";
import { truncateAll } from "../../helpers/db";

jest.setTimeout(180_000);

class PublicadorEmMemoria implements PublicadorMensagensPort {
	readonly comandos: { fila: FilaComando; envelope: EnvelopeMensagem<any> }[] = [];
	readonly eventos: EnvelopeMensagem<any>[] = [];
	async enviarComando(fila: FilaComando, envelope: EnvelopeMensagem<unknown>): Promise<void> {
		this.comandos.push({ fila, envelope: envelope as EnvelopeMensagem<any> });
	}
	async publicarEvento(envelope: EnvelopeMensagem<unknown>): Promise<void> {
		this.eventos.push(envelope as EnvelopeMensagem<any>);
	}
	limpar(): void {
		this.comandos.length = 0;
		this.eventos.length = 0;
	}
}

const feature = loadFeature(path.join(__dirname, "..", "features", "fluxo-ordem-servico.feature"));
const publicador = new PublicadorEmMemoria();
const validador = new ValidadorContratos();
const MINUTO = 60_000;

let container: StartedPostgreSqlContainer;
let app: INestApplication;
let prisma: PrismaService;
let orquestrador: OrquestradorOrdemServico;
let relay: RelayOutbox;

interface Contexto {
	clienteId: string;
	veiculoId: string;
	usuarioId: string;
	servicos: Map<string, string>;
	insumos: Map<string, string>;
	osId: string;
	fluxoId: string;
	numeroOs: string;
	orcamentoId: string;
	ultimos: Map<string, EnvelopeMensagem>;
}
let ctx: Contexto;

beforeAll(async () => {
	container = await new PostgreSqlContainer("postgres:18-alpine").start();
	const url = `${container.getConnectionUri()}?schema=public`;
	execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
	Object.assign(process.env, {
		DATABASE_URL: url,
		JWT_SECRET: "segredo-bdd",
		INTERNAL_API_KEY: "chave-bdd",
		WORKERS_HABILITADOS: "false",
	});
	// Import tardio: o AppModule lê JWT_SECRET/DATABASE_URL quando é carregado.
	const { AppModule } = jest.requireActual<typeof import("../../../src/app.module")>("../../../src/app.module");
	const modulo = await Test.createTestingModule({ imports: [AppModule] })
		.overrideProvider(PUBLICADOR_MENSAGENS)
		.useValue(publicador)
		.compile();
	app = modulo.createNestApplication();
	app.enableShutdownHooks();
	await app.init();
	prisma = app.get(PrismaService);
	orquestrador = app.get(OrquestradorOrdemServico);
	relay = app.get(RelayOutbox);
});

afterAll(async () => {
	await app?.close();
	await container?.stop();
});

async function drenarOutbox(): Promise<void> {
	while ((await relay.processarLote()) > 0);
}

async function entregar(tipo: string, origem: "billing" | "execution", payload: Record<string, unknown>): Promise<void> {
	const envelope = criarEnvelope({
		tipo,
		origem,
		fluxoId: ctx.fluxoId,
		osId: ctx.osId,
		numeroOs: ctx.numeroOs,
		correlationId: "req-bdd",
		payload,
	});
	expect(validador.validar(envelope)).toEqual(expect.objectContaining({ valido: true }));
	ctx.ultimos.set(tipo, envelope);
	await orquestrador.processarEvento(envelope);
	await drenarOutbox();
}

function comandos(tipo: string) {
	const lista = publicador.comandos.filter((c) => c.envelope.tipo === tipo);
	for (const c of lista) expect(validador.validar(c.envelope)).toEqual(expect.objectContaining({ valido: true }));
	return lista;
}

const ultimoGerarOrcamento = () => comandos("GerarOrcamento").at(-1)!.envelope.payload as { valorTotalCentavos: number };

async function abrirOs(): Promise<void> {
	const res = await app.get(CriarOsUseCase).execute({ clienteId: ctx.clienteId, veiculoId: ctx.veiculoId }, "req-bdd");
	expect(res.status).toBe(201);
	const os = res.data as { id: string; numero: string };
	const fluxo = await prisma.fluxoOrdemServico.findUniqueOrThrow({ where: { osId: os.id } });
	Object.assign(ctx, { osId: os.id, numeroOs: os.numero, fluxoId: fluxo.id });
	await drenarOutbox();
}

async function concluirDiagnostico(qtdServico: number, servico: string, qtdInsumo: number, insumo: string): Promise<void> {
	const mecanicoId = randomUUID();
	await entregar("ExecucaoEnfileirada", "execution", { etapa: "DIAGNOSTICO", ordemExecucaoId: randomUUID() });
	await entregar("DiagnosticoIniciado", "execution", { mecanicoId });
	await entregar("DiagnosticoConcluido", "execution", {
		mecanicoId,
		diagnostico: "Óleo vencido e filtro saturado",
		itens: [
			{ tipo: "SERVICO", referenciaId: ctx.servicos.get(servico), quantidade: qtdServico },
			{ tipo: "INSUMO", referenciaId: ctx.insumos.get(insumo), quantidade: qtdInsumo },
		],
	});
}

const gerarOrcamento = () =>
	entregar("OrcamentoGerado", "billing", {
		orcamentoId: ctx.orcamentoId,
		valorTotalCentavos: ultimoGerarOrcamento().valorTotalCentavos,
	});
const aprovar = () =>
	entregar("OrcamentoAprovado", "billing", {
		orcamentoId: ctx.orcamentoId,
		linkPagamento: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=teste",
		prazoPagamentoEm: new Date(Date.now() + 2880 * MINUTO).toISOString(),
	});
const pagar = () =>
	entregar("PagamentoConfirmado", "billing", {
		orcamentoId: ctx.orcamentoId,
		pagamentoId: "1234567890",
		valorCentavos: ultimoGerarOrcamento().valorTotalCentavos,
		pagoEm: new Date().toISOString(),
	});

async function aguardandoAprovacao(): Promise<void> {
	await abrirOs();
	await concluirDiagnostico(1, "Troca de óleo", 4, "Óleo 5W30");
	await gerarOrcamento();
}

const passos: StepDefinitions = ({ given, when, then }) => {
	given("um cliente com veículo cadastrado", async () => {
		await truncateAll(prisma);
		publicador.limpar();
		const cliente = await prisma.cliente.create({
			data: { nome: "Maria Souza", documento: "52998224725", tipoDocumento: "CPF", email: null },
		});
		const veiculo = await prisma.veiculo.create({
			data: { placa: "ABC1D23", marca: "Fiat", modelo: "Argo", ano: 2022, clienteId: cliente.id },
		});
		const usuario = await prisma.usuario.create({
			data: { nome: "Estoquista", email: "estoque@bdd.test", senhaHash: "x", role: "ESTOQUISTA" },
		});
		ctx = {
			clienteId: cliente.id,
			veiculoId: veiculo.id,
			usuarioId: usuario.id,
			servicos: new Map(),
			insumos: new Map(),
			osId: "",
			fluxoId: "",
			numeroOs: "",
			orcamentoId: randomUUID(),
			ultimos: new Map(),
		};
	});

	given(/^o serviço "(.*)" custando (\d+\.\d{2})$/, async (nome: string, preco: string) => {
		const s = await prisma.servico.create({ data: { nome, preco, tempoEstimadoMin: 60 } });
		ctx.servicos.set(nome, s.id);
	});

	given(/^o insumo "(.*)" custando (\d+\.\d{2}) com (\d+) unidades em estoque$/, async (nome: string, preco: string, qtd: string) => {
		const i = await prisma.insumo.create({
			data: {
				codigo: nome.toUpperCase().replace(/\W+/g, "-"),
				nome,
				precoUnitario: preco,
				quantidadeEstoque: Number(qtd),
				estoqueMinimo: 0,
			},
		});
		ctx.insumos.set(nome, i.id);
	});

	given("uma OS com orçamento aguardando aprovação", aguardandoAprovacao);
	given("uma OS aguardando pagamento", async () => {
		await aguardandoAprovacao();
		await aprovar();
	});
	given("uma OS paga com reparo em andamento", async () => {
		await aguardandoAprovacao();
		await aprovar();
		await pagar();
		await entregar("ExecucaoEnfileirada", "execution", { etapa: "REPARO", ordemExecucaoId: randomUUID() });
		await entregar("ReparoIniciado", "execution", { mecanicoId: randomUUID() });
	});

	when("o atendente abre a OS", abrirOs);
	when(/^o execution confirma o diagnóstico com (\d+) "(.*)" e (\d+) "(.*)"$/, (qs: string, s: string, qi: string, i: string) =>
		concluirDiagnostico(Number(qs), s, Number(qi), i),
	);
	when("o billing gera o orçamento", gerarOrcamento);
	when("o cliente aprova o orçamento", aprovar);
	when("o cliente rejeita o orçamento", () =>
		entregar("OrcamentoRejeitado", "billing", { orcamentoId: ctx.orcamentoId, motivo: null }),
	);
	when("o pagamento é confirmado", pagar);
	when("o execution conclui o reparo", async () => {
		const mecanicoId = randomUUID();
		await entregar("ExecucaoEnfileirada", "execution", { etapa: "REPARO", ordemExecucaoId: randomUUID() });
		await entregar("ReparoIniciado", "execution", { mecanicoId });
		await entregar("ReparoConcluido", "execution", { mecanicoId, concluidoEm: new Date().toISOString() });
	});
	when("o execution declara o reparo inviável", () =>
		entregar("ReparoInviavel", "execution", { mecanicoId: randomUUID(), motivo: "Bloco do motor trincado" }),
	);
	when("o billing confirma o cancelamento do orçamento", () =>
		entregar("OrcamentoCancelado", "billing", { orcamentoId: ctx.orcamentoId, motivo: "Cancelado a pedido da oficina" }),
	);
	when("o billing confirma o estorno do pagamento", () =>
		entregar("PagamentoEstornado", "billing", {
			orcamentoId: ctx.orcamentoId,
			pagamentoId: "1234567890",
			valorCentavos: ultimoGerarOrcamento().valorTotalCentavos,
		}),
	);
	when(/^chegam (\d+) unidades de "(.*)" ao estoque$/, async (qtd: string, nome: string) => {
		const r = await app
			.get(RegistrarEntradaInsumoUseCase)
			.execute(ctx.insumos.get(nome)!, { quantidade: Number(qtd), motivo: "Reposição" }, ctx.usuarioId);
		expect(r.status).toBe(200);
	});
	when("a verificação periódica do fluxo roda", async () => {
		await orquestrador.verificarPrazos(new Date());
		await drenarOutbox();
	});
	when("o prazo de aprovação passa sem resposta do cliente", async () => {
		await orquestrador.verificarPrazos(new Date(Date.now() + 4321 * MINUTO));
		await drenarOutbox();
	});
	when("o prazo de pagamento passa", async () => {
		await orquestrador.verificarPrazos(new Date(Date.now() + 2881 * MINUTO));
		await drenarOutbox();
	});
	when(/^a mesma mensagem "(.*)" é entregue de novo$/, async (tipo: string) => {
		await orquestrador.processarEvento(ctx.ultimos.get(tipo)!);
		await drenarOutbox();
	});

	then(/^o comando "(.*)" é enviado ao (execution|billing)$/, (tipo: string, servico: string) => {
		const lista = comandos(tipo);
		expect(lista.length).toBeGreaterThan(0);
		expect(lista.at(-1)!.fila).toBe(servico === "billing" ? "billing-comandos" : "execucao-comandos");
	});
	then(/^os comandos "(.*)" são enviados ao billing$/, (tipos: string) => {
		for (const tipo of tipos.split(",")) expect(comandos(tipo).map((c) => c.fila)).toContain("billing-comandos");
	});
	then(/^o comando "GerarOrcamento" é enviado ao billing com total de (\d+) centavos$/, (total: string) => {
		expect(ultimoGerarOrcamento().valorTotalCentavos).toBe(Number(total));
	});
	then(/^nenhum comando "(.*)" foi enviado$/, (tipo: string) => expect(comandos(tipo)).toHaveLength(0));
	then(/^o comando "(.*)" foi enviado (\d+) vez(?:es)?$/, (tipo: string, n: string) => expect(comandos(tipo)).toHaveLength(Number(n)));
	then(/^o estoque de "(.*)" fica em (\d+)$/, async (nome: string, qtd: string) => {
		const insumo = await prisma.insumo.findUniqueOrThrow({ where: { id: ctx.insumos.get(nome) } });
		expect(insumo.quantidadeEstoque).toBe(Number(qtd));
	});
	then(/^a OS fica "(.*)"$/, async (status: string) => {
		expect((await prisma.ordemServico.findUniqueOrThrow({ where: { id: ctx.osId } })).status).toBe(status);
	});
	then(/^o fluxo fica "(.*)"$/, async (status: string) => {
		expect((await prisma.fluxoOrdemServico.findUniqueOrThrow({ where: { id: ctx.fluxoId } })).status).toBe(status);
	});
	then(/^o evento "(.*)" é publicado$/, (tipo: string) => {
		expect(publicador.eventos.map((e) => e.tipo)).toContain(tipo);
	});
	then(/^o evento "FluxoCompensado" é publicado com as compensações "(.*)"$/, (lista: string) => {
		const evento = publicador.eventos.filter((e) => e.tipo === "FluxoCompensado").at(-1)!;
		expect(validador.validar(evento)).toEqual(expect.objectContaining({ valido: true }));
		expect([...evento.payload.compensacoes].sort()).toEqual(lista.split(",").sort());
	});
};

autoBindSteps([feature], [passos]);
