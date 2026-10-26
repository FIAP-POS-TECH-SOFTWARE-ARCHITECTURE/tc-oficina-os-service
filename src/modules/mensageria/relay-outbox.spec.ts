import { Logger } from "@nestjs/common";
import { RelayOutbox } from "./relay-outbox";

const linha = (id: string, destino: string, tentativas = 0) => ({
	id,
	message_id: `m-${id}`,
	destino,
	corpo: { tipo: "X", messageId: `m-${id}` },
	tentativas,
});

describe("RelayOutbox", () => {
	let prisma: { $queryRaw: jest.Mock; outboxMensagem: { update: jest.Mock } };
	let publicador: { enviarComando: jest.Mock; publicarEvento: jest.Mock };
	let relay: RelayOutbox;

	beforeEach(() => {
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		prisma = { $queryRaw: jest.fn(), outboxMensagem: { update: jest.fn() } };
		publicador = { enviarComando: jest.fn(), publicarEvento: jest.fn() };
		relay = new RelayOutbox(prisma as never, publicador);
	});

	afterEach(() => jest.restoreAllMocks());

	it("publica comando na fila e evento no tópico e marca ENVIADA", async () => {
		prisma.$queryRaw.mockResolvedValueOnce([linha("1", "billing-comandos"), linha("2", "eventos")]);
		expect(await relay.processarLote()).toBe(2);
		expect(publicador.enviarComando).toHaveBeenCalledWith("billing-comandos", { tipo: "X", messageId: "m-1" });
		expect(publicador.publicarEvento).toHaveBeenCalledWith({ tipo: "X", messageId: "m-2" });
		expect(prisma.outboxMensagem.update).toHaveBeenCalledWith({
			where: { id: "1" },
			data: { status: "ENVIADA", enviadaEm: expect.any(Date), ultimoErro: null },
		});
	});

	it("falha incrementa tentativas com backoff; na décima vira FALHA", async () => {
		publicador.enviarComando.mockRejectedValue(new Error("rede"));
		prisma.$queryRaw.mockResolvedValueOnce([linha("1", "execucao-comandos", 2), linha("2", "execucao-comandos", 9)]);
		await relay.processarLote();
		expect(prisma.outboxMensagem.update).toHaveBeenCalledWith({
			where: { id: "1" },
			data: { status: "PENDENTE", tentativas: 3, ultimoErro: "rede", proximaTentativaEm: expect.any(Date) },
		});
		expect(prisma.outboxMensagem.update).toHaveBeenCalledWith({
			where: { id: "2" },
			data: expect.objectContaining({ status: "FALHA", tentativas: 10 }),
		});
	});

	it("tick não faz nada com workers desligados", async () => {
		process.env.WORKERS_HABILITADOS = "false";
		await relay.tick();
		expect(prisma.$queryRaw).not.toHaveBeenCalled();
		delete process.env.WORKERS_HABILITADOS;
	});
});
