import { ClientesConsultaPrismaGateway, VeiculosConsultaPrismaGateway } from "./consultas-externas.prisma.gateway";

describe("consultas externas da OS", () => {
	it("cliente é buscado pelo gateway do módulo de clientes", async () => {
		const cliente = { id: "c1", ativo: true, documento: "52998224725", nome: "Fulano", email: null };
		const clientes = { buscarPorId: jest.fn().mockResolvedValue(cliente) };

		await expect(new ClientesConsultaPrismaGateway(clientes as never).buscarPorId("c1")).resolves.toBe(cliente);
		expect(clientes.buscarPorId).toHaveBeenCalledWith("c1");
	});

	it("veículo é buscado pelo gateway do módulo de veículos", async () => {
		const veiculos = { buscarPorId: jest.fn().mockResolvedValue(null) };

		await expect(new VeiculosConsultaPrismaGateway(veiculos as never).buscarPorId("v1")).resolves.toBeNull();
		expect(veiculos.buscarPorId).toHaveBeenCalledWith("v1");
	});
});
