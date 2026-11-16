import { DesbloquearOsUseCase } from "./desbloquear-os.use-case";

const gateway = { buscarPorId: jest.fn(), buscarDetalhePorId: jest.fn() };
const orquestrador = { retomarBloqueada: jest.fn() };

function makeSut() {
	return new DesbloquearOsUseCase(gateway as any, orquestrador as any);
}

describe("DesbloquearOsUseCase", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		gateway.buscarPorId.mockResolvedValue({ id: "os1" });
		gateway.buscarDetalhePorId.mockResolvedValue({ id: "os1", status: "EM_DIAGNOSTICO" });
	});

	it("404 quando OS não existe", async () => {
		gateway.buscarPorId.mockResolvedValue(null);
		expect((await makeSut().execute("x", "u1")).status).toBe(404);
		expect(orquestrador.retomarBloqueada).not.toHaveBeenCalled();
	});

	it("422 quando a OS não tem fluxo", async () => {
		orquestrador.retomarBloqueada.mockResolvedValue({ encontrado: false });
		const res = await makeSut().execute("os1", "u1");
		expect(res.status).toBe(422);
		expect(res.message).toBe("Só é possível desbloquear OS bloqueada por falta de estoque");
	});

	it("422 com os faltantes quando o estoque ainda não basta", async () => {
		orquestrador.retomarBloqueada.mockResolvedValue({
			encontrado: true,
			aplicado: false,
			motivo: "EstoqueRetomado inesperado",
			faltantes: ["Óleo (1 disponíveis, 4 requisitados)"],
		});
		const res = await makeSut().execute("os1", "u1");
		expect(res.status).toBe(422);
		expect(res.message).toContain("Óleo (1 disponíveis");
	});

	it("422 quando a OS não está bloqueada", async () => {
		orquestrador.retomarBloqueada.mockResolvedValue({ encontrado: true, aplicado: false, motivo: "x", faltantes: [] });
		const res = await makeSut().execute("os1", "u1");
		expect(res.status).toBe(422);
		expect(res.message).toBe("Só é possível desbloquear OS bloqueada por falta de estoque");
	});

	it("200 com o detalhe quando retoma", async () => {
		orquestrador.retomarBloqueada.mockResolvedValue({ encontrado: true, aplicado: true, motivo: "ok", faltantes: [] });
		const res = await makeSut().execute("os1", "u1");
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ id: "os1", status: "EM_DIAGNOSTICO" });
		expect(orquestrador.retomarBloqueada).toHaveBeenCalledWith("os1", "u1");
	});
});
