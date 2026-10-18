import { RegistroCompraStatus, TipoMovimentoEstoque } from "@prisma/client";
import { RegistrosCompraPrismaGateway } from "./registros-compra.prisma.gateway";

describe("RegistrosCompraPrismaGateway", () => {
	let prisma: any;
	let gateway: RegistrosCompraPrismaGateway;

	beforeEach(() => {
		prisma = {
			registroCompra: {
				create: jest.fn(),
				findUnique: jest.fn(),
				findMany: jest.fn(),
				update: jest.fn(),
			},
			ordemServico: { findUnique: jest.fn() },
			$transaction: jest.fn(),
		};
		gateway = new RegistrosCompraPrismaGateway(prisma);
	});

	it("criar monta connects a partir dos dados planos", async () => {
		await gateway.criar({ insumoId: "i1", quantidadeSolicitada: 2, solicitadoPorId: "u1", ordemServicoId: "os1" });
		expect(prisma.registroCompra.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				quantidadeSolicitada: 2,
				insumo: { connect: { id: "i1" } },
				solicitadoPor: { connect: { id: "u1" } },
				ordemServico: { connect: { id: "os1" } },
			}),
		});
	});

	it("criar sem ordemServicoId não conecta OS", async () => {
		await gateway.criar({ insumoId: "i1", quantidadeSolicitada: 2, solicitadoPorId: "u1" });
		expect(prisma.registroCompra.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ ordemServico: undefined }),
		});
	});

	it("buscarPorId sem include e buscarDetalhePorId com include", async () => {
		await gateway.buscarPorId("rc1");
		await gateway.buscarDetalhePorId("rc1");
		expect(prisma.registroCompra.findUnique).toHaveBeenNthCalledWith(1, { where: { id: "rc1" } });
		expect(prisma.registroCompra.findUnique).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ where: { id: "rc1" }, include: expect.objectContaining({ insumo: true }) }),
		);
	});

	it("listarTodos ordena por createdAt desc com include", async () => {
		await gateway.listarTodos();
		expect(prisma.registroCompra.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: "desc" } }));
	});

	it("atualizar delega data + where", async () => {
		await gateway.atualizar("rc1", { status: "CANCELADO", motivoCancelamento: "y" });
		expect(prisma.registroCompra.update).toHaveBeenCalledWith({
			where: { id: "rc1" },
			data: expect.objectContaining({ status: "CANCELADO" }),
		});
	});

	it("ordemServicoExiste retorna booleano", async () => {
		prisma.ordemServico.findUnique.mockResolvedValueOnce({ id: "os1" });
		expect(await gateway.ordemServicoExiste("os1")).toBe(true);
		prisma.ordemServico.findUnique.mockResolvedValueOnce(null);
		expect(await gateway.ordemServicoExiste("os2")).toBe(false);
	});

	it("receberComEntradaEstoque grava saldo, movimento e status RECEBIDO na mesma transação", async () => {
		const tx = {
			insumo: {
				findUnique: jest.fn().mockResolvedValue({ id: "i1", quantidadeEstoque: 6 }),
				// saldo mudou depois da leitura (reserva concorrente): o update atômico devolve o valor real
				update: jest.fn().mockResolvedValue({ id: "i1", quantidadeEstoque: 7 }),
			},
			movimentoEstoque: { create: jest.fn() },
			registroCompra: { update: jest.fn() },
		};
		prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

		await gateway.receberComEntradaEstoque({
			registroId: "rc1",
			insumoId: "i1",
			quantidade: 4,
			usuarioId: "u1",
			motivo: "Entrada por recebimento da compra rc1 (NF NF-1)",
			notaFiscal: {
				numero: "NF-1",
				arquivoNome: "nf-1.pdf",
				arquivoTipo: "application/pdf",
				arquivoTamanho: 12345,
				arquivoUrl: "s3://bucket/nf-1.pdf",
			},
		});

		expect(tx.insumo.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { quantidadeEstoque: { increment: 4 } } });
		expect(tx.movimentoEstoque.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					tipo: TipoMovimentoEstoque.ENTRADA,
					quantidade: 4,
					quantidadeAnterior: 3,
					quantidadePosterior: 7,
				}),
			}),
		);
		expect(tx.registroCompra.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ status: RegistroCompraStatus.RECEBIDO, notaFiscalNumero: "NF-1" }),
			}),
		);
	});

	it("receberComEntradaEstoque lança erro se insumo não encontrado na transação", async () => {
		const tx = {
			insumo: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
			movimentoEstoque: { create: jest.fn() },
			registroCompra: { update: jest.fn() },
		};
		prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

		await expect(
			gateway.receberComEntradaEstoque({
				registroId: "rc1",
				insumoId: "iX",
				quantidade: 1,
				usuarioId: "u1",
				motivo: "x",
				notaFiscal: { numero: "NF-1", arquivoNome: "x", arquivoTipo: "y", arquivoTamanho: 1, arquivoUrl: "u" },
			}),
		).rejects.toThrow();
	});
});
