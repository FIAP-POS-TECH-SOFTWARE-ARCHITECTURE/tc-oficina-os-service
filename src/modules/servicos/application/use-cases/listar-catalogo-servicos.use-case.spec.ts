import { Prisma } from "@prisma/client";
import { ListarCatalogoServicosUseCase } from "./listar-catalogo-servicos.use-case";

const gateway = { listarTodos: jest.fn() };

describe("ListarCatalogoServicosUseCase", () => {
	it("devolve só ativos, com preço em centavos inteiros", async () => {
		gateway.listarTodos.mockResolvedValue([
			{ id: "s1", nome: "Alinhamento", descricao: null, preco: new Prisma.Decimal("19.99"), tempoEstimadoMin: 30, ativo: true },
			{
				id: "s2",
				nome: "Balanceamento",
				descricao: "4 rodas",
				preco: new Prisma.Decimal("80.10"),
				tempoEstimadoMin: 40,
				ativo: false,
			},
			{ id: "s3", nome: "Troca de óleo", descricao: "Motor", preco: new Prisma.Decimal("120"), tempoEstimadoMin: 45, ativo: true },
		]);

		const res = await new ListarCatalogoServicosUseCase(gateway as any).execute();

		expect(res.status).toBe(200);
		expect(res.data).toEqual([
			{ id: "s1", nome: "Alinhamento", descricao: null, precoCentavos: 1999, tempoEstimadoMin: 30 },
			{ id: "s3", nome: "Troca de óleo", descricao: "Motor", precoCentavos: 12000, tempoEstimadoMin: 45 },
		]);
	});

	it("catálogo vazio → lista vazia", async () => {
		gateway.listarTodos.mockResolvedValue([]);
		expect((await new ListarCatalogoServicosUseCase(gateway as any).execute()).data).toEqual([]);
	});
});
