import { Logger } from "@nestjs/common";
import { JobPrazosFluxo } from "./job-prazos-fluxo";

describe("JobPrazosFluxo", () => {
	const env = { ...process.env };
	let orquestrador: { verificarPrazos: jest.Mock };
	let job: JobPrazosFluxo;
	let erro: jest.SpyInstance;

	beforeEach(() => {
		erro = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		orquestrador = { verificarPrazos: jest.fn().mockResolvedValue(undefined) };
		job = new JobPrazosFluxo(orquestrador as never);
		delete process.env.WORKERS_HABILITADOS;
	});

	afterEach(() => {
		process.env = { ...env };
		jest.restoreAllMocks();
	});

	it("não faz nada com workers desligados", async () => {
		process.env.WORKERS_HABILITADOS = "false";
		await job.executar();
		expect(orquestrador.verificarPrazos).not.toHaveBeenCalled();
	});

	it("verifica os prazos uma vez com workers ligados", async () => {
		await job.executar();
		expect(orquestrador.verificarPrazos).toHaveBeenCalledTimes(1);
		expect(orquestrador.verificarPrazos).toHaveBeenCalledWith(expect.any(Date));
	});

	it("bloqueia reentrância enquanto a verificação anterior está em andamento", async () => {
		let liberar: () => void = () => undefined;
		orquestrador.verificarPrazos.mockReturnValueOnce(new Promise<void>((r) => (liberar = r)));
		const primeira = job.executar();
		await job.executar();
		liberar();
		await primeira;
		expect(orquestrador.verificarPrazos).toHaveBeenCalledTimes(1);
	});

	it("loga o erro e libera a flag para a próxima execução", async () => {
		orquestrador.verificarPrazos.mockRejectedValueOnce(new Error("banco fora"));
		await job.executar();
		expect(erro).toHaveBeenCalledWith(expect.objectContaining({ event: "fluxo.job_prazos_falhou", erro: "banco fora" }));
		await job.executar();
		expect(orquestrador.verificarPrazos).toHaveBeenCalledTimes(2);
	});
});
