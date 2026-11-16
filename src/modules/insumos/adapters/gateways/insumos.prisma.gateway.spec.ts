import { TipoMovimentoEstoque } from "@prisma/client";
import { InsumosPrismaGateway } from "./insumos.prisma.gateway";

describe("InsumosPrismaGateway", () => {
	let prisma: any;
	let gateway: InsumosPrismaGateway;

	beforeEach(() => {
		prisma = {
			insumo: {
				create: jest.fn(),
				findUnique: jest.fn(),
				findMany: jest.fn(),
				update: jest.fn(),
				fields: { estoqueMinimo: Symbol("estoqueMinimo") },
			},
			movimentoEstoque: { findMany: jest.fn() },
			$transaction: jest.fn(),
		};
		gateway = new InsumosPrismaGateway(prisma);
	});

	it("criar delega", async () => {
		await gateway.criar({ codigo: "P-001", nome: "Filtro", precoUnitario: 10, estoqueMinimo: 0, quantidadeEstoque: 0 });
		expect(prisma.insumo.create).toHaveBeenCalled();
	});

	it("buscarPorId/buscarPorCodigo", async () => {
		await gateway.buscarPorId("i1");
		await gateway.buscarPorCodigo("P-001");
		expect(prisma.insumo.findUnique).toHaveBeenNthCalledWith(1, { where: { id: "i1" } });
		expect(prisma.insumo.findUnique).toHaveBeenNthCalledWith(2, { where: { codigo: "P-001" } });
	});

	it("listarTodos/listarEstoqueBaixo ordenam por nome asc", async () => {
		await gateway.listarTodos();
		await gateway.listarEstoqueBaixo();
		expect(prisma.insumo.findMany).toHaveBeenNthCalledWith(1, { orderBy: { nome: "asc" } });
		expect(prisma.insumo.findMany).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ where: expect.objectContaining({ ativo: true }), orderBy: { nome: "asc" } }),
		);
	});

	it("atualizar/inativar", async () => {
		await gateway.atualizar("i1", { nome: "Z" });
		await gateway.inativar("i1");
		expect(prisma.insumo.update).toHaveBeenNthCalledWith(1, { where: { id: "i1" }, data: { nome: "Z" } });
		expect(prisma.insumo.update).toHaveBeenNthCalledWith(2, { where: { id: "i1" }, data: { ativo: false } });
	});

	it("listarMovimentos filtra e ordena desc", async () => {
		await gateway.listarMovimentos("i1");
		expect(prisma.movimentoEstoque.findMany).toHaveBeenCalledWith({
			where: { insumoId: "i1" },
			orderBy: { createdAt: "desc" },
		});
	});

	it("registrarEntrada soma de forma atômica e grava o saldo real no movimento (entrada concorrente com reserva)", async () => {
		const tx = {
			insumo: { update: jest.fn().mockResolvedValue({ id: "i1", quantidadeEstoque: 12 }) },
			movimentoEstoque: { create: jest.fn() },
		};
		prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));
		const r = await gateway.registrarEntrada({
			insumoId: "i1",
			quantidade: 3,
			quantidadeAnterior: 5,
			quantidadePosterior: 8,
			usuarioId: "u1",
		});
		expect(r).toEqual({ id: "i1", quantidadeEstoque: 12 });
		expect(tx.insumo.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { quantidadeEstoque: { increment: 3 } } });
		expect(tx.movimentoEstoque.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					tipo: TipoMovimentoEstoque.ENTRADA,
					quantidade: 3,
					quantidadeAnterior: 9,
					quantidadePosterior: 12,
				}),
			}),
		);
	});

	it("registrarAjuste grava movimento AJUSTE", async () => {
		const tx = {
			insumo: { update: jest.fn().mockResolvedValue({ id: "i1", quantidadeEstoque: 2 }) },
			movimentoEstoque: { create: jest.fn() },
		};
		prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));
		await gateway.registrarAjuste({
			insumoId: "i1",
			quantidade: 3,
			quantidadeAnterior: 5,
			quantidadePosterior: 2,
			motivo: "perda",
			usuarioId: "u1",
		});
		expect(tx.movimentoEstoque.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ tipo: TipoMovimentoEstoque.AJUSTE, motivo: "perda" }),
			}),
		);
	});
});
