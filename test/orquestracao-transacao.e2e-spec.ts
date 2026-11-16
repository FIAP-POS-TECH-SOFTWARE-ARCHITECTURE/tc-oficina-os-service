import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { RESERVA_ESTOQUE_OS } from "../src/modules/insumos/application/ports/reserva-estoque-os.gateway";
import { criarEnvelope, EnvelopeMensagem } from "../src/modules/mensageria/envelope";
import { ValidadorContratos } from "../src/modules/mensageria/validador-contratos";
import {
	FluxoOrdemServicoPrismaGateway,
	TransacaoFluxoPrisma,
} from "../src/modules/orquestracao-os/adapters/gateways/fluxo-ordem-servico.prisma.gateway";
import { OrquestradorOrdemServico } from "../src/modules/orquestracao-os/application/orquestrador-ordem-servico";
import { PrismaService } from "../src/prisma/prisma.service";
import { setupApp } from "./helpers/app-factory";
import { loginAs } from "./helpers/auth";
import { truncateAll } from "./helpers/db";
import { createCliente, createInsumo, createOS, createServico, createVeiculo } from "./helpers/factories";

const PRAZOS = { aprovacaoMin: 4320, pagamentoMin: 2880, respostaServicoMin: 10 };

describe("Orquestração da OS em transação (e2e)", () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let orquestrador: OrquestradorOrdemServico;
	let token: string;
	const validador = new ValidadorContratos();

	beforeAll(async () => {
		app = await setupApp();
		prisma = app.get(PrismaService);
		const repositorio = new FluxoOrdemServicoPrismaGateway(prisma, app.get(RESERVA_ESTOQUE_OS));
		orquestrador = new OrquestradorOrdemServico(repositorio, { notificarMudancaStatus: jest.fn() }, PRAZOS);
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(async () => {
		await truncateAll(prisma);
		token = (await loginAs(app, prisma, Role.ADMINISTRADOR)).token;
	});

	afterEach(() => jest.restoreAllMocks());

	async function abrirOs(): Promise<{ osId: string; fluxoId: string; numero: string }> {
		const cliente = await createCliente(app, token);
		const veiculo = await createVeiculo(app, token, cliente.id);
		const numero = `OS-2026-${String(Date.now()).slice(-6)}`;
		const r = await orquestrador.abrirOs({ numero, clienteId: cliente.id, veiculoId: veiculo.id, correlationId: "req-e2e" });
		return { ...r, numero };
	}

	const evento = (os: { osId: string; fluxoId: string; numero: string }, tipo: string, payload: Record<string, unknown>) =>
		criarEnvelope({
			tipo,
			origem: "execution",
			fluxoId: os.fluxoId,
			osId: os.osId,
			numeroOs: os.numero,
			correlationId: "req-e2e",
			payload,
		});

	const corpoDoOutbox = async (fluxoId: string, tipo: string) =>
		(await prisma.outboxMensagem.findFirstOrThrow({ where: { fluxoId, tipo } })).corpo as unknown as EnvelopeMensagem;

	it("POST /os grava OS, fluxo e SolicitarDiagnostico válido no outbox", async () => {
		const cliente = await createCliente(app, token);
		const veiculo = await createVeiculo(app, token, cliente.id);
		const os = await createOS(app, token, cliente.id, veiculo.id);

		const fluxo = await prisma.fluxoOrdemServico.findUniqueOrThrow({ where: { osId: os.id } });
		expect(fluxo.etapa).toBe("AGUARDANDO_ACK_DIAGNOSTICO");
		const linha = await prisma.outboxMensagem.findFirstOrThrow({ where: { fluxoId: fluxo.id } });
		expect(linha).toEqual(expect.objectContaining({ tipo: "SolicitarDiagnostico", destino: "execucao-comandos" }));
		expect(validador.validar(linha.corpo).valido).toBe(true);
	});

	it("falha no meio desfaz o registro do messageId (regra 3)", async () => {
		const os = await abrirOs();
		const envelope = evento(os, "DiagnosticoIniciado", { mecanicoId: randomUUID() });
		expect(validador.validar(envelope).valido).toBe(true);

		jest.spyOn(TransacaoFluxoPrisma.prototype, "salvarFluxo").mockRejectedValueOnce(new Error("falha simulada"));
		await expect(orquestrador.processarEvento(envelope)).rejects.toThrow("falha simulada");
		expect(await prisma.mensagemProcessada.count({ where: { messageId: envelope.messageId } })).toBe(0);
		expect((await prisma.ordemServico.findUniqueOrThrow({ where: { id: os.osId } })).status).toBe("RECEBIDA");

		await orquestrador.processarEvento(envelope);
		expect((await prisma.ordemServico.findUniqueOrThrow({ where: { id: os.osId } })).status).toBe("EM_DIAGNOSTICO");

		await orquestrador.processarEvento(envelope);
		expect(await prisma.mensagemProcessada.count({ where: { messageId: envelope.messageId } })).toBe(1);
		expect(await prisma.osHistoricoStatus.count({ where: { ordemServicoId: os.osId, statusNovo: "EM_DIAGNOSTICO" } })).toBe(1);
	});

	it("diagnóstico com item inexistente não grava itens", async () => {
		const os = await abrirOs();
		await orquestrador.processarEvento(
			evento(os, "DiagnosticoConcluido", {
				mecanicoId: randomUUID(),
				diagnostico: "Troca de óleo",
				itens: [{ tipo: "SERVICO", referenciaId: randomUUID(), quantidade: 1 }],
			}),
		);

		expect((await prisma.ordemServico.findUniqueOrThrow({ where: { id: os.osId } })).status).toBe("CANCELADA");
		expect(await prisma.osItemServico.count({ where: { ordemServicoId: os.osId } })).toBe(0);
		expect((await prisma.fluxoOrdemServico.findUniqueOrThrow({ where: { id: os.fluxoId } })).status).toBe("COMPENSADO");
		expect(validador.validar(await corpoDoOutbox(os.fluxoId, "FluxoCompensado")).valido).toBe(true);
	});

	it("GerarOrcamento do outbox bate com o contrato e com o catálogo", async () => {
		const servico = await createServico(app, token, { preco: 19.99 });
		const insumo = await createInsumo(app, token, { precoUnitario: 45 });
		const os = await abrirOs();
		await orquestrador.processarEvento(
			evento(os, "DiagnosticoConcluido", {
				mecanicoId: randomUUID(),
				diagnostico: "Troca de óleo",
				itens: [
					{ tipo: "SERVICO", referenciaId: servico.id, quantidade: 1 },
					{ tipo: "INSUMO", referenciaId: insumo.id, quantidade: 4 },
				],
			}),
		);

		const corpo = await corpoDoOutbox(os.fluxoId, "GerarOrcamento");
		expect(validador.validar(corpo)).toEqual(expect.objectContaining({ valido: true }));
		expect((corpo.payload as { valorTotalCentavos: number }).valorTotalCentavos).toBe(1999 + 18000);
	});
});
