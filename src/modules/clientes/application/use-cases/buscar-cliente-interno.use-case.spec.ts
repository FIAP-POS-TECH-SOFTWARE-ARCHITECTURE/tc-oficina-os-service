import { BuscarClienteInternoUseCase } from "./buscar-cliente-interno.use-case";

const gateway = { buscarPorDocumento: jest.fn() };

function makeSut() {
	return new BuscarClienteInternoUseCase(gateway as any);
}

const registro = {
	id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
	nome: "Maria Souza",
	documento: "52998224725",
	tipoDocumento: "CPF",
	email: "maria@example.com",
	telefone: null,
	endereco: null,
	ativo: true,
};

describe("BuscarClienteInternoUseCase", () => {
	beforeEach(() => jest.clearAllMocks());

	it("200 devolve só id, nome e ativo", async () => {
		gateway.buscarPorDocumento.mockResolvedValue(registro);
		const res = await makeSut().execute("52998224725");
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ id: registro.id, nome: "Maria Souza", ativo: true });
		expect(gateway.buscarPorDocumento).toHaveBeenCalledWith("52998224725");
	});

	it("200 com cliente inativo (ativo=false é informação para o chamador)", async () => {
		gateway.buscarPorDocumento.mockResolvedValue({ ...registro, ativo: false });
		const res = await makeSut().execute("52998224725");
		expect(res.data).toEqual({ id: registro.id, nome: "Maria Souza", ativo: false });
	});

	it("aceita CNPJ com 14 dígitos", async () => {
		gateway.buscarPorDocumento.mockResolvedValue({ ...registro, documento: "11444777000161" });
		expect((await makeSut().execute("11444777000161")).status).toBe(200);
	});

	it("404 quando não existe", async () => {
		gateway.buscarPorDocumento.mockResolvedValue(null);
		expect((await makeSut().execute("52998224725")).status).toBe(404);
	});

	it.each(["529.982.247-25", "5299822472", "abc", "123456789012"])(
		"400 para documento fora do formato só dígitos: %s",
		async (doc) => {
			const res = await makeSut().execute(doc);
			expect(res.status).toBe(400);
			expect(gateway.buscarPorDocumento).not.toHaveBeenCalled();
		},
	);
});
