import { Logger } from "@nestjs/common";
import { CriarOsUseCase } from "./criar-os.use-case";

const gateway = {
	contarPorAno: jest.fn().mockResolvedValue(0),
	buscarDetalhePorId: jest.fn().mockResolvedValue({ id: "os-1", numero: "OS-2026-000001" }),
};
const clientes = { buscarPorId: jest.fn() };
const veiculos = { buscarPorId: jest.fn() };
const orquestrador = { abrirOs: jest.fn().mockResolvedValue({ osId: "os-1", fluxoId: "f-1" }) };

function makeSut() {
	return new CriarOsUseCase(gateway as any, clientes, veiculos, orquestrador as any);
}

describe("CriarOsUseCase", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		orquestrador.abrirOs.mockResolvedValue({ osId: "os-1", fluxoId: "f-1" });
		gateway.contarPorAno.mockResolvedValue(0);
		gateway.buscarDetalhePorId.mockResolvedValue({ id: "os-1", numero: "OS-2026-000001" });
	});

	it("cria OS e retorna 201 com detalhe", async () => {
		clientes.buscarPorId.mockResolvedValue({ id: "c1", ativo: true });
		veiculos.buscarPorId.mockResolvedValue({ id: "v1", ativo: true, clienteId: "c1" });
		const res = await makeSut().execute({ clienteId: "c1", veiculoId: "v1" }, "req-9");
		expect(res.status).toBe(201);
		expect(orquestrador.abrirOs).toHaveBeenCalledWith({
			clienteId: "c1",
			veiculoId: "v1",
			numero: expect.stringMatching(/^OS-\d{4}-\d{6}$/),
			correlationId: "req-9",
		});
	});

	it("emite evento os.created após persistir", async () => {
		const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		clientes.buscarPorId.mockResolvedValue({ id: "c1", ativo: true });
		veiculos.buscarPorId.mockResolvedValue({ id: "v1", ativo: true, clienteId: "c1" });

		await makeSut().execute({ clienteId: "c1", veiculoId: "v1" }, "req-9");

		expect(logSpy).toHaveBeenCalledWith(
			expect.objectContaining({ event: "os.created", osId: "os-1", numero: expect.stringMatching(/^OS-\d{4}-\d{6}$/) }),
			"CriarOsUseCase",
		);
		logSpy.mockRestore();
	});

	it("404 quando cliente não existe", async () => {
		clientes.buscarPorId.mockResolvedValue(null);
		const res = await makeSut().execute({ clienteId: "cX", veiculoId: "v1" }, "req-9");
		expect(res.status).toBe(404);
		expect(orquestrador.abrirOs).not.toHaveBeenCalled();
	});

	it("422 quando cliente inativo", async () => {
		clientes.buscarPorId.mockResolvedValue({ id: "c1", ativo: false });
		const res = await makeSut().execute({ clienteId: "c1", veiculoId: "v1" }, "req-9");
		expect(res.status).toBe(422);
	});

	it("404 quando veículo não existe", async () => {
		clientes.buscarPorId.mockResolvedValue({ id: "c1", ativo: true });
		veiculos.buscarPorId.mockResolvedValue(null);
		const res = await makeSut().execute({ clienteId: "c1", veiculoId: "vX" }, "req-9");
		expect(res.status).toBe(404);
	});

	it("422 quando veículo inativo", async () => {
		clientes.buscarPorId.mockResolvedValue({ id: "c1", ativo: true });
		veiculos.buscarPorId.mockResolvedValue({ id: "v1", ativo: false, clienteId: "c1" });
		const res = await makeSut().execute({ clienteId: "c1", veiculoId: "v1" }, "req-9");
		expect(res.status).toBe(422);
	});

	it("400 quando veículo não pertence ao cliente", async () => {
		clientes.buscarPorId.mockResolvedValue({ id: "c1", ativo: true });
		veiculos.buscarPorId.mockResolvedValue({ id: "v1", ativo: true, clienteId: "OUTRO" });
		const res = await makeSut().execute({ clienteId: "c1", veiculoId: "v1" }, "req-9");
		expect(res.status).toBe(400);
	});
});
