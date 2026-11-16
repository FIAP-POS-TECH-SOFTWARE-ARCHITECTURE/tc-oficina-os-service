import { destinoDoTipo, urlDaFila, workersHabilitados } from "./configuracao-mensageria";

describe("configuracao-mensageria", () => {
	const env = { ...process.env };
	afterEach(() => (process.env = { ...env }));

	it.each([
		["SolicitarDiagnostico", "execucao-comandos"],
		["CancelarExecucao", "execucao-comandos"],
		["GerarOrcamento", "billing-comandos"],
		["EstornarPagamento", "billing-comandos"],
		["FluxoConcluido", "eventos"],
	])("%s → %s", (tipo, destino) => expect(destinoDoTipo(tipo)).toBe(destino));

	it("workers ligados por padrão e desligados só com 'false'", () => {
		delete process.env.WORKERS_HABILITADOS;
		expect(workersHabilitados()).toBe(true);
		process.env.WORKERS_HABILITADOS = "false";
		expect(workersHabilitados()).toBe(false);
	});

	it("urlDaFila lê a env da fila e falha alto se ausente", () => {
		process.env.SQS_BILLING_COMANDOS_URL = "http://q/billing";
		expect(urlDaFila("billing-comandos")).toBe("http://q/billing");
		delete process.env.SQS_EXECUCAO_COMANDOS_URL;
		expect(() => urlDaFila("execucao-comandos")).toThrow("SQS_EXECUCAO_COMANDOS_URL não definido");
	});
});
