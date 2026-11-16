import { Logger } from "@nestjs/common";
import { TipoMovimentoEstoque } from "@prisma/client";
import { ReservaEstoqueOsPrismaGateway } from "./reserva-estoque-os.prisma.gateway";

type Mov = { insumoId: string; tipo: TipoMovimentoEstoque; quantidade: number };

function criarTx(opts: { saldo?: Mov[]; insumos?: unknown[] } = {}) {
	return {
		$queryRaw: jest
			.fn()
			.mockImplementation(async (strings: TemplateStringsArray) =>
				strings.join("?").includes("FROM ordens_servico") ? [{ id: "os1" }] : (opts.insumos ?? []),
			),
		movimentoEstoque: {
			groupBy: jest
				.fn()
				.mockResolvedValue(
					(opts.saldo ?? []).map((s) => ({ insumoId: s.insumoId, tipo: s.tipo, _sum: { quantidade: s.quantidade } })),
				),
			create: jest.fn(),
		},
		insumo: { update: jest.fn() },
	};
}

const insumo = (id: string, estoque: number, ativo = true) => ({
	id,
	codigo: `C-${id}`,
	nome: `Insumo ${id}`,
	quantidade_estoque: estoque,
	estoque_minimo: 0,
	ativo,
});

describe("ReservaEstoqueOsPrismaGateway", () => {
	let prisma: { $transaction: jest.Mock };
	let gateway: ReservaEstoqueOsPrismaGateway;
	const base = { ordemServicoId: "os1", motivo: "m", usuarioId: null };

	beforeEach(() => {
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		prisma = { $transaction: jest.fn() };
		gateway = new ReservaEstoqueOsPrismaGateway(prisma as never);
	});

	afterEach(() => jest.restoreAllMocks());

	const comTx = (tx: ReturnType<typeof criarTx>) => prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));

	it("reserva tudo: baixa estoque e grava SAIDA ligada à OS (itens repetidos somados)", async () => {
		const tx = criarTx({ insumos: [insumo("a", 10), insumo("b", 3)] });
		comTx(tx);
		const itens = [
			{ insumoId: "b", quantidade: 1 },
			{ insumoId: "a", quantidade: 2 },
			{ insumoId: "b", quantidade: 2 },
		];

		expect(await gateway.reservar({ ...base, itens })).toEqual({ reservado: true, faltantes: [] });
		expect(tx.insumo.update).toHaveBeenCalledWith({ where: { id: "a" }, data: { quantidadeEstoque: 8 } });
		expect(tx.insumo.update).toHaveBeenCalledWith({ where: { id: "b" }, data: { quantidadeEstoque: 0 } });
		expect(tx.movimentoEstoque.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				insumoId: "b",
				tipo: TipoMovimentoEstoque.SAIDA,
				quantidade: 3,
				quantidadeAnterior: 3,
				quantidadePosterior: 0,
				ordemServicoId: "os1",
			}),
		});
	});

	it("tudo ou nada: um insumo sem saldo → nada é baixado", async () => {
		const tx = criarTx({ insumos: [insumo("a", 10), insumo("b", 1)] });
		comTx(tx);
		const r = await gateway.reservar({
			...base,
			itens: [
				{ insumoId: "a", quantidade: 2 },
				{ insumoId: "b", quantidade: 5 },
			],
		});
		expect(r).toEqual({ reservado: false, faltantes: ["Insumo b (1 disponíveis, 5 requisitados)"] });
		expect(tx.insumo.update).not.toHaveBeenCalled();
	});

	it("insumo inativo ou inexistente entra em faltantes", async () => {
		comTx(criarTx({ insumos: [insumo("a", 10, false)] }));
		const r = await gateway.reservar({
			...base,
			itens: [
				{ insumoId: "a", quantidade: 1 },
				{ insumoId: "z", quantidade: 1 },
			],
		});
		expect(r.faltantes).toEqual(["Insumo a inativo", "Insumo z não encontrado"]);
	});

	it("idempotente: OS com saldo reservado não reserva de novo", async () => {
		const tx = criarTx({ saldo: [{ insumoId: "a", tipo: TipoMovimentoEstoque.SAIDA, quantidade: 2 }], insumos: [insumo("a", 8)] });
		comTx(tx);
		expect(await gateway.reservar({ ...base, itens: [{ insumoId: "a", quantidade: 2 }] })).toEqual({ reservado: true, faltantes: [] });
		expect(tx.insumo.update).not.toHaveBeenCalled();
	});

	it("sem itens de insumo: reservado sem travar insumos", async () => {
		const tx = criarTx();
		comTx(tx);
		expect(await gateway.reservar({ ...base, itens: [] })).toEqual({ reservado: true, faltantes: [] });
		expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
	});

	it("estorna só o saldo líquido (SAIDA − ESTORNO) e grava ESTORNO", async () => {
		const tx = criarTx({
			saldo: [
				{ insumoId: "a", tipo: TipoMovimentoEstoque.SAIDA, quantidade: 5 },
				{ insumoId: "a", tipo: TipoMovimentoEstoque.ESTORNO, quantidade: 2 },
				{ insumoId: "b", tipo: TipoMovimentoEstoque.SAIDA, quantidade: 1 },
				{ insumoId: "b", tipo: TipoMovimentoEstoque.ESTORNO, quantidade: 1 },
			],
			insumos: [insumo("a", 4)],
		});
		comTx(tx);

		expect(await gateway.estornar({ ...base, usuarioId: "u1" })).toEqual({ insumosEstornados: 1 });
		expect(tx.insumo.update).toHaveBeenCalledWith({ where: { id: "a" }, data: { quantidadeEstoque: 7 } });
		expect(tx.movimentoEstoque.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				insumoId: "a",
				tipo: TipoMovimentoEstoque.ESTORNO,
				quantidade: 3,
				quantidadeAnterior: 4,
				quantidadePosterior: 7,
			}),
		});
	});

	it("estornar sem saldo é no-op (compensação repetida)", async () => {
		const tx = criarTx();
		comTx(tx);
		expect(await gateway.estornar(base)).toEqual({ insumosEstornados: 0 });
		expect(tx.movimentoEstoque.create).not.toHaveBeenCalled();
	});

	it("com contexto usa a transação do chamador", async () => {
		const tx = criarTx();
		await gateway.estornar(base, tx);
		expect(prisma.$transaction).not.toHaveBeenCalled();
		expect(tx.$queryRaw).toHaveBeenCalled();
	});
});
