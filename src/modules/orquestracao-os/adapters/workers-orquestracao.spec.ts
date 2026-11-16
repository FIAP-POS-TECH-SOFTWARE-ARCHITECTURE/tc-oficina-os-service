import { WorkersOrquestracao } from "./workers-orquestracao";

describe("WorkersOrquestracao", () => {
	const env = { ...process.env };
	let consumidor: { iniciar: jest.Mock; parar: jest.Mock };
	let orquestrador: { processarEvento: jest.Mock };
	let workers: WorkersOrquestracao;

	beforeEach(() => {
		consumidor = { iniciar: jest.fn(), parar: jest.fn().mockResolvedValue(undefined) };
		orquestrador = { processarEvento: jest.fn().mockResolvedValue(undefined) };
		workers = new WorkersOrquestracao(consumidor as never, orquestrador as never);
		delete process.env.WORKERS_HABILITADOS;
		process.env.SQS_OS_ORQUESTRADOR_EVENTOS_URL = "http://q/os-orquestrador";
	});

	afterEach(() => (process.env = { ...env }));

	it("não inicia o consumidor com workers desligados", () => {
		process.env.WORKERS_HABILITADOS = "false";
		workers.onApplicationBootstrap();
		expect(consumidor.iniciar).not.toHaveBeenCalled();
	});

	it("inicia o consumidor da fila do orquestrador repassando ao orquestrador", async () => {
		workers.onApplicationBootstrap();
		expect(consumidor.iniciar).toHaveBeenCalledWith("http://q/os-orquestrador", expect.any(Function), ["billing", "execution"]);
		const processar = consumidor.iniciar.mock.calls[0][1] as (e: unknown) => Promise<void>;
		await processar({ tipo: "OrcamentoGerado" });
		expect(orquestrador.processarEvento).toHaveBeenCalledWith({ tipo: "OrcamentoGerado" });
	});

	it("falha alto sem a URL da fila", () => {
		delete process.env.SQS_OS_ORQUESTRADOR_EVENTOS_URL;
		expect(() => workers.onApplicationBootstrap()).toThrow("SQS_OS_ORQUESTRADOR_EVENTOS_URL não definido");
	});

	it("para o consumidor no shutdown", async () => {
		await workers.onApplicationShutdown();
		expect(consumidor.parar).toHaveBeenCalled();
	});
});
