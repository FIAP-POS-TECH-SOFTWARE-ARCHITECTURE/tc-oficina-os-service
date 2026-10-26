import { ROLES_KEY } from "../../../common/decorators/roles.decorator";
import { Role } from "../../../common/enums/role.enum";
import { OrquestracaoController } from "./orquestracao.controller";

describe("OrquestracaoController", () => {
	const fluxo = { id: "f1", osId: "o1", status: "FALHA_TECNICA" };
	const orq = { consultarPorOs: jest.fn(), reprocessar: jest.fn(), compensar: jest.fn() };
	const controller = new OrquestracaoController(orq as never);

	it("consulta: 200 com fluxo e mensagens; 404 sem fluxo", async () => {
		orq.consultarPorOs.mockResolvedValueOnce({ fluxo, mensagens: [] }).mockResolvedValueOnce(null);
		expect((await controller.consultar("o1")).status).toBe(200);
		expect((await controller.consultar("o2")).status).toBe(404);
	});

	it.each([
		[{ encontrado: false }, 404],
		[{ encontrado: true, aplicado: false, motivo: "fluxo EM_ANDAMENTO não aceita", fluxo }, 422],
		[{ encontrado: true, aplicado: true, motivo: "ok", fluxo }, 200],
	])("reprocessar %p → %i", async (resultado, status) => {
		orq.reprocessar.mockResolvedValueOnce(resultado);
		expect((await controller.reprocessar("f1")).status).toBe(status);
	});

	it("compensar usa motivo padrão", async () => {
		orq.compensar.mockResolvedValueOnce({ encontrado: true, aplicado: true, motivo: "ok", fluxo });
		await controller.compensar("f1", {});
		expect(orq.compensar).toHaveBeenCalledWith("f1", "Compensação solicitada pelo administrador");
	});

	it("todas as rotas exigem ADMINISTRADOR", () => {
		for (const m of ["consultar", "reprocessar", "compensar"] as const)
			expect(Reflect.getMetadata(ROLES_KEY, OrquestracaoController.prototype[m])).toEqual([Role.ADMINISTRADOR]);
	});
});
