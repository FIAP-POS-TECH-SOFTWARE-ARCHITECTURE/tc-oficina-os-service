import { Logger } from "@nestjs/common";
import { OsStatus as PrismaOsStatus } from "@prisma/client";
import { OsStatus } from "../../domain/os-status";
import { OsDetalhe } from "../../application/ports/os-types";
import { OrdensServicoPrismaGateway } from "./ordens-servico.prisma.gateway";

function baseTx() {
	return {
		ordemServico: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ numero: "OS-2026-000001" }) },
		osHistoricoStatus: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
	};
}

describe("OrdensServicoPrismaGateway", () => {
	let prisma: any;
	let gateway: OrdensServicoPrismaGateway;
	let logSpy: jest.SpyInstance;
	const reserva = { reservar: jest.fn(), estornar: jest.fn().mockResolvedValue({ insumosEstornados: 0 }) };

	beforeEach(() => {
		logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		prisma = {
			ordemServico: {
				create: jest.fn(),
				findUnique: jest.fn(),
				findMany: jest.fn(),
				count: jest.fn(),
				update: jest.fn(),
			},
			osHistoricoStatus: { findMany: jest.fn(), create: jest.fn() },
			$transaction: jest.fn(),
			$queryRaw: jest.fn(),
		};
		gateway = new OrdensServicoPrismaGateway(prisma, reserva);
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	const osDetalhe = (overrides: Partial<OsDetalhe> = {}): OsDetalhe =>
		({
			id: "os1",
			numero: "OS-2026-000001",
			status: OsStatus.AGUARDANDO_APROVACAO,
			cliente: { nome: "Fulano", documento: "52998224725", email: null },
			veiculo: { placa: "ABC1234", marca: "X", modelo: "Y" },
			itensServico: [],
			itensInsumo: [{ id: "ii1", insumoId: "i1", quantidade: 2 }],
			historico: [],
			...overrides,
		}) as unknown as OsDetalhe;

	it("criarComHistorico cria OS e histórico na mesma transação", async () => {
		const tx = baseTx();
		tx.ordemServico.create.mockResolvedValueOnce({ id: "os1" });
		prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

		const result = await gateway.criarComHistorico({ numero: "OS-2026-000001", clienteId: "c1", veiculoId: "v1" });

		expect(result).toEqual({ id: "os1" });
		expect(tx.ordemServico.create).toHaveBeenCalledWith({
			data: { numero: "OS-2026-000001", clienteId: "c1", veiculoId: "v1" },
		});
		expect(tx.osHistoricoStatus.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				ordemServicoId: "os1",
				statusAnterior: null,
				statusNovo: PrismaOsStatus.RECEBIDA,
			}),
		});
	});

	it("buscarDetalhePorId busca com include completo", async () => {
		prisma.ordemServico.findUnique.mockResolvedValueOnce({ id: "os1" });
		await gateway.buscarDetalhePorId("os1");
		expect(prisma.ordemServico.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "os1" }, include: expect.any(Object) }),
		);
	});

	it("listarParaOrdenacao filtra por status e clienteId com projeção mínima", async () => {
		prisma.ordemServico.findMany.mockResolvedValueOnce([]);
		await gateway.listarParaOrdenacao({ status: OsStatus.EM_EXECUCAO, clienteId: "c1" });
		expect(prisma.ordemServico.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { status: PrismaOsStatus.EM_EXECUCAO, clienteId: "c1" },
				select: { id: true, status: true, createdAt: true },
			}),
		);
	});

	it("buscarDetalhesPorIds busca com include completo só os ids pedidos", async () => {
		prisma.ordemServico.findMany.mockResolvedValueOnce([]);
		await gateway.buscarDetalhesPorIds(["os1", "os2"]);
		expect(prisma.ordemServico.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: { in: ["os1", "os2"] } }, include: expect.any(Object) }),
		);
	});

	it("buscarDetalhesPorIds com lista vazia não consulta o banco", async () => {
		await expect(gateway.buscarDetalhesPorIds([])).resolves.toEqual([]);
		expect(prisma.ordemServico.findMany).not.toHaveBeenCalled();
	});

	it("listarParaOrdenacao aplica notIn quando recebe excluirStatus", async () => {
		prisma.ordemServico.findMany.mockResolvedValueOnce([]);
		await gateway.listarParaOrdenacao({ excluirStatus: [OsStatus.FINALIZADA, OsStatus.ENTREGUE] });
		expect(prisma.ordemServico.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { status: { notIn: [PrismaOsStatus.FINALIZADA, PrismaOsStatus.ENTREGUE] } } }),
		);
	});

	it("transicionarComHistorico atualiza status com dadosExtras e grava histórico", async () => {
		const tx = baseTx();
		prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));
		const entregueEm = new Date("2026-07-05T12:00:00Z");

		await gateway.transicionarComHistorico({
			id: "os1",
			statusAnterior: OsStatus.FINALIZADA,
			statusNovo: OsStatus.ENTREGUE,
			usuarioId: "u1",
			dadosExtras: { entregueEm },
		});

		expect(tx.ordemServico.update).toHaveBeenCalledWith({
			where: { id: "os1" },
			data: { entregueEm, status: PrismaOsStatus.ENTREGUE },
		});
		expect(tx.osHistoricoStatus.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				ordemServicoId: "os1",
				statusAnterior: PrismaOsStatus.FINALIZADA,
				statusNovo: PrismaOsStatus.ENTREGUE,
				usuarioId: "u1",
			}),
		});
	});

	it("transicionarComHistorico emite evento os.status.changed com payload do contrato", async () => {
		const tx = baseTx();
		prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

		await gateway.transicionarComHistorico({
			id: "os1",
			statusAnterior: OsStatus.FINALIZADA,
			statusNovo: OsStatus.ENTREGUE,
			usuarioId: "u1",
		});

		expect(logSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "os.status.changed",
				osId: "os1",
				numero: "OS-2026-000001",
				fromStatus: OsStatus.FINALIZADA,
				toStatus: OsStatus.ENTREGUE,
				durationMs: 0,
			}),
			"OrdensServicoPrismaGateway",
		);
	});

	it("os.status.changed calcula durationMs a partir da linha de histórico anterior", async () => {
		const tx = baseTx();
		tx.osHistoricoStatus.findFirst.mockResolvedValueOnce({ createdAt: new Date(Date.now() - 60_000) });
		prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

		await gateway.transicionarComHistorico({
			id: "os1",
			statusAnterior: OsStatus.RECEBIDA,
			statusNovo: OsStatus.EM_DIAGNOSTICO,
		});

		const payload = logSpy.mock.calls.find((c) => c[0]?.event === "os.status.changed")?.[0];
		expect(typeof payload.durationMs).toBe("number");
		expect(payload.durationMs).toBeGreaterThanOrEqual(60_000);
		expect(payload.durationMs).toBeLessThan(65_000);
	});

	it("executarCancelamento emite os.status.changed", async () => {
		const tx = baseTx();
		prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

		await gateway.executarCancelamento(osDetalhe({ status: OsStatus.BLOQUEADA }), "u1", null);

		expect(logSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "os.status.changed",
				osId: "os1",
				numero: "OS-2026-000001",
				toStatus: PrismaOsStatus.CANCELADA,
			}),
			"OrdensServicoPrismaGateway",
		);
	});

	it("executarCancelamento estorna pela porta de estoque na MESMA transação e cancela", async () => {
		const tx = baseTx();
		prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

		await gateway.executarCancelamento(osDetalhe({ status: OsStatus.AGUARDANDO_PAGAMENTO }), "u1", "cliente desistiu");

		expect(reserva.estornar).toHaveBeenCalledWith(
			{ ordemServicoId: "os1", motivo: "Estorno por cancelamento de OS", usuarioId: "u1" },
			tx,
		);
		expect(tx.ordemServico.update).toHaveBeenCalledWith({
			where: { id: "os1" },
			data: { status: PrismaOsStatus.CANCELADA, canceladoEm: expect.any(Date) },
		});
		expect(tx.osHistoricoStatus.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ statusNovo: PrismaOsStatus.CANCELADA, observacao: "cliente desistiu", usuarioId: "u1" }),
		});
	});

	it("executarCancelamento sem motivo usa observação padrão", async () => {
		const tx = baseTx();
		prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));
		await gateway.executarCancelamento(osDetalhe(), null, undefined);
		expect(tx.osHistoricoStatus.create).toHaveBeenCalledWith({ data: expect.objectContaining({ observacao: "OS cancelada" }) });
	});
});
