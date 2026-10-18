import { Prisma } from "@prisma/client";
import { ListarCatalogoInsumosUseCase } from "./listar-catalogo-insumos.use-case";

const gateway = { listarTodos: jest.fn() };

describe("ListarCatalogoInsumosUseCase", () => {
	it("devolve só ativos com precoCentavos e estoque atual", async () => {
		gateway.listarTodos.mockResolvedValue([
			{
				id: "i1",
				codigo: "OL-5W30",
				nome: "Óleo 5W30 1L",
				descricao: null,
				precoUnitario: new Prisma.Decimal("45.00"),
				quantidadeEstoque: 12,
				estoqueMinimo: 5,
				ativo: true,
			},
			{
				id: "i2",
				codigo: "FL-01",
				nome: "Filtro",
				descricao: null,
				precoUnitario: new Prisma.Decimal("0.1"),
				quantidadeEstoque: 0,
				estoqueMinimo: 1,
				ativo: true,
			},
			{
				id: "i3",
				codigo: "X",
				nome: "Inativo",
				descricao: null,
				precoUnitario: new Prisma.Decimal("1"),
				quantidadeEstoque: 9,
				estoqueMinimo: 0,
				ativo: false,
			},
		]);

		const res = await new ListarCatalogoInsumosUseCase(gateway as any).execute();

		expect(res.data).toEqual([
			{ id: "i1", codigo: "OL-5W30", nome: "Óleo 5W30 1L", precoCentavos: 4500, quantidadeEstoque: 12 },
			{ id: "i2", codigo: "FL-01", nome: "Filtro", precoCentavos: 10, quantidadeEstoque: 0 },
		]);
	});
});
