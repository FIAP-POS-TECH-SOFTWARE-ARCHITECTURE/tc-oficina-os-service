import { Logger } from "@nestjs/common";
import { OsStatus } from "../../domain/os-status";
import { registrarTransicaoOs } from "./historico-os.prisma";

describe("registrarTransicaoOs", () => {
	const logger = new Logger("teste");
	let log: jest.SpyInstance;

	beforeEach(() => {
		log = jest.spyOn(logger, "log").mockImplementation(() => undefined);
	});

	afterEach(() => jest.restoreAllMocks());

	it("grava histórico e emite os.status.changed buscando o número quando não informado", async () => {
		const tx: any = {
			osHistoricoStatus: { findFirst: jest.fn().mockResolvedValue({ createdAt: new Date(Date.now() - 1000) }), create: jest.fn() },
			ordemServico: { findUnique: jest.fn().mockResolvedValue({ numero: "OS-2026-000009" }) },
		};
		await registrarTransicaoOs(tx, logger, {
			ordemServicoId: "os9",
			statusAnterior: OsStatus.RECEBIDA,
			statusNovo: OsStatus.EM_DIAGNOSTICO,
		});

		expect(tx.osHistoricoStatus.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ ordemServicoId: "os9", statusNovo: OsStatus.EM_DIAGNOSTICO }),
		});
		expect(log.mock.calls[0][0]).toEqual(expect.objectContaining({ event: "os.status.changed", numero: "OS-2026-000009" }));
		expect(log.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(1000);
	});

	it("não consulta a OS quando o número vem; OS inexistente → numero undefined e durationMs 0", async () => {
		const tx: any = {
			osHistoricoStatus: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
			ordemServico: { findUnique: jest.fn().mockResolvedValue(null) },
		};
		await registrarTransicaoOs(tx, logger, {
			ordemServicoId: "os1",
			numero: "OS-2026-000001",
			statusAnterior: null,
			statusNovo: OsStatus.RECEBIDA,
		});
		expect(tx.ordemServico.findUnique).not.toHaveBeenCalled();

		await registrarTransicaoOs(tx, logger, { ordemServicoId: "os2", statusAnterior: null, statusNovo: OsStatus.RECEBIDA });
		expect(log.mock.calls[1][0]).toEqual(expect.objectContaining({ numero: undefined, durationMs: 0 }));
	});
});
