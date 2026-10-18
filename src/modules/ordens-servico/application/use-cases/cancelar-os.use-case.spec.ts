import { OsStatus } from "../../domain/os-status";
import { CancelarOsUseCase } from "./cancelar-os.use-case";

const gateway = {
	buscarDetalhePorId: jest.fn(),
	executarCancelamento: jest.fn().mockResolvedValue(true),
};
const notificador = { notificarMudancaStatus: jest.fn() };

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
	return new CancelarOsUseCase(gateway as any, notificador);
}

describe("CancelarOsUseCase", () => {
	beforeEach(() => jest.clearAllMocks());

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
});
