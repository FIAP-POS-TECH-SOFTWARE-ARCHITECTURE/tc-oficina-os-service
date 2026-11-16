import { OsStatus } from "../../domain/os-status";
import { CancelarOsUseCase } from "./cancelar-os.use-case";

const gateway = {
	buscarDetalhePorId: jest.fn(),
	executarCancelamento: jest.fn().mockResolvedValue(true),
};
const notificador = { notificarMudancaStatus: jest.fn() };
const orquestrador = { cancelarPorStaff: jest.fn().mockResolvedValue({ encontrado: false }) };

const osMock = (overrides: any = {}) => ({
	id: "os1",
	numero: "OS-2026-000001",
	status: OsStatus.EM_EXECUCAO,
	aprovadoEm: new Date(),
	cliente: { nome: "Fulano", email: null },
	itensInsumo: [],
	...overrides,
});

function makeSut() {
	return new CancelarOsUseCase(gateway as any, notificador, orquestrador as any);
}

describe("CancelarOsUseCase", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		orquestrador.cancelarPorStaff.mockResolvedValue({ encontrado: false });
	});

	it("404 quando OS não existe", async () => {
		gateway.buscarDetalhePorId.mockResolvedValue(null);
		expect((await makeSut().execute("x", "u1", {})).status).toBe(404);
	});

	it("422 quando status não permite cancelar (ENTREGUE)", async () => {
		gateway.buscarDetalhePorId.mockResolvedValue(osMock({ status: OsStatus.ENTREGUE }));
		expect((await makeSut().execute("os1", "u1", {})).status).toBe(422);
	});

	it.each([OsStatus.RECEBIDA, OsStatus.BLOQUEADA, OsStatus.AGUARDANDO_PAGAMENTO, OsStatus.EM_EXECUCAO])(
		"cancela em %s delegando o estorno ao gateway (saldo líquido decide)",
		async (status) => {
			const os = osMock({ status });
			gateway.buscarDetalhePorId.mockResolvedValue(os);
			expect((await makeSut().execute("os1", "u1", { motivo: "x" })).status).toBe(200);
			expect(gateway.executarCancelamento).toHaveBeenCalledWith(os, "u1", "x");
		},
	);

	it("422 em FINALIZADA", async () => {
		gateway.buscarDetalhePorId.mockResolvedValue(osMock({ status: OsStatus.FINALIZADA }));
		expect((await makeSut().execute("os1", "u1", {})).status).toBe(422);
		expect(gateway.executarCancelamento).not.toHaveBeenCalled();
	});

	it("422 quando o status mudou antes do lock (gateway recusa o cancelamento)", async () => {
		gateway.buscarDetalhePorId.mockResolvedValue(osMock({ status: OsStatus.EM_EXECUCAO }));
		gateway.executarCancelamento.mockResolvedValueOnce(false);
		expect((await makeSut().execute("os1", "u1", {})).status).toBe(422);
		expect(notificador.notificarMudancaStatus).not.toHaveBeenCalled();
	});

	it("falha no e-mail não impede o cancelamento", async () => {
		gateway.buscarDetalhePorId.mockResolvedValue(osMock());
		notificador.notificarMudancaStatus.mockRejectedValueOnce(new Error("smtp fora"));
		expect((await makeSut().execute("os1", "u1", {})).status).toBe(200);
	});

	it("notifica CANCELADA", async () => {
		gateway.buscarDetalhePorId.mockResolvedValue(osMock());
		await makeSut().execute("os1", "u1", { motivo: "cliente desistiu" });
		expect(notificador.notificarMudancaStatus).toHaveBeenCalledWith(
			expect.objectContaining({ statusNovo: OsStatus.CANCELADA, observacao: "cliente desistiu" }),
		);
	});

	it("OS com fluxo: cancela pelo orquestrador (compensações) e não pelo gateway", async () => {
		gateway.buscarDetalhePorId.mockResolvedValue(osMock({ status: OsStatus.AGUARDANDO_PAGAMENTO }));
		orquestrador.cancelarPorStaff.mockResolvedValue({ encontrado: true, aplicado: true, motivo: "ok" });
		expect((await makeSut().execute("os1", "u1", { motivo: "desistiu" })).status).toBe(200);
		expect(orquestrador.cancelarPorStaff).toHaveBeenCalledWith("os1", "u1", "desistiu");
		expect(gateway.executarCancelamento).not.toHaveBeenCalled();
		expect(notificador.notificarMudancaStatus).not.toHaveBeenCalled(); // o orquestrador notifica
	});

	it("fluxo em compensação recusa com 422 e o motivo", async () => {
		gateway.buscarDetalhePorId.mockResolvedValue(osMock({ status: OsStatus.EM_EXECUCAO }));
		orquestrador.cancelarPorStaff.mockResolvedValue({
			encontrado: true,
			aplicado: false,
			motivo: "CancelamentoSolicitado ignorado: fluxo em compensação",
		});
		const res = await makeSut().execute("os1", "u1", {});
		expect(res.status).toBe(422);
		expect(orquestrador.cancelarPorStaff).toHaveBeenCalledWith("os1", "u1", "Cancelada pela oficina");
	});
});
