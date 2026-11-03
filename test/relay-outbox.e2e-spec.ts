import { INestApplication, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { EnvelopeMensagem, criarEnvelope } from "../src/modules/mensageria/envelope";
import { PublicadorMensagensPort } from "../src/modules/mensageria/publicador-mensagens.port";
import { RelayOutbox } from "../src/modules/mensageria/relay-outbox";
import { capturarCabecalhosTrace } from "../src/modules/mensageria/trace";
import { TransacaoFluxoPrisma } from "../src/modules/orquestracao-os/adapters/gateways/fluxo-ordem-servico.prisma.gateway";
import { PrismaService } from "../src/prisma/prisma.service";
import { setupApp } from "./helpers/app-factory";
import { truncateAll } from "./helpers/db";

jest.mock("../src/modules/mensageria/trace", () => ({ capturarCabecalhosTrace: jest.fn(() => ({})) }));

describe("RelayOutbox com duas réplicas (e2e)", () => {
	let app: INestApplication;
	let prisma: PrismaService;

	beforeAll(async () => {
		app = await setupApp();
		prisma = app.get(PrismaService);
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(async () => {
		await truncateAll(prisma);
	});

	it("publica cada messageId exatamente uma vez", async () => {
		const publicados: string[] = [];
		const registrar = async (envelope: EnvelopeMensagem<unknown>) => {
			await new Promise((r) => setTimeout(r, 5));
			publicados.push(envelope.messageId);
		};
		const publicadorContador: PublicadorMensagensPort = {
			enviarComando: (_fila, envelope) => registrar(envelope),
			publicarEvento: (envelope) => registrar(envelope),
		};

		await prisma.outboxMensagem.createMany({
			data: Array.from({ length: 60 }, (_, i) => {
				const messageId = randomUUID();
				return {
					messageId,
					tipo: "FluxoConcluido",
					destino: i % 2 === 0 ? "eventos" : "billing-comandos",
					corpo: { messageId, tipo: "FluxoConcluido" },
				};
			}),
		});

		const r1 = new RelayOutbox(prisma, publicadorContador);
		const r2 = new RelayOutbox(prisma, publicadorContador);
		const drenar = async (r: RelayOutbox) => {
			while ((await r.processarLote()) > 0);
		};
		await Promise.all([drenar(r1), drenar(r2)]);

		expect(publicados).toHaveLength(60);
		expect(new Set(publicados).size).toBe(60);
		expect(await prisma.outboxMensagem.count({ where: { status: "ENVIADA" } })).toBe(60);
	});

	it("publica o trace capturado no enfileiramento, não o do momento do envio", async () => {
		const mock = capturarCabecalhosTrace as jest.Mock;
		mock.mockReturnValue({ traceparent: "00-t-1-01" });
		const envelope = criarEnvelope({
			tipo: "GerarOrcamento",
			fluxoId: randomUUID(),
			osId: randomUUID(),
			numeroOs: "OS-1",
			correlationId: "c",
			payload: {},
		});
		await new TransacaoFluxoPrisma(prisma, undefined as never, new Logger()).enfileirar("billing-comandos", envelope);
		mock.mockReturnValue({ traceparent: "00-outro-2-01" });

		const recebidos: unknown[] = [];
		const publicador: PublicadorMensagensPort = {
			enviarComando: async (_fila, _envelope, trace) => {
				recebidos.push(trace);
			},
			publicarEvento: async () => undefined,
		};
		await new RelayOutbox(prisma, publicador).processarLote();

		expect(recebidos).toEqual([{ traceparent: "00-t-1-01" }]);
	});
});
