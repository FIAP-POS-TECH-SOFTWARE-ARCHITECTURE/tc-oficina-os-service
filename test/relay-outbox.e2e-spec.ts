import { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { EnvelopeMensagem } from "../src/modules/mensageria/envelope";
import { PublicadorMensagensPort } from "../src/modules/mensageria/publicador-mensagens.port";
import { RelayOutbox } from "../src/modules/mensageria/relay-outbox";
import { PrismaService } from "../src/prisma/prisma.service";
import { setupApp } from "./helpers/app-factory";
import { truncateAll } from "./helpers/db";

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
});
