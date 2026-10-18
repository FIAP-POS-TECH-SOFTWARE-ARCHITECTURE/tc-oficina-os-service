import { IS_CLIENTE_AUTH_KEY } from "../../../common/decorators/cliente-auth.decorator";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { ROLES_KEY } from "../../../common/decorators/roles.decorator";
import { Role } from "../../../common/enums/role.enum";
import { OrdensServicoController } from "./ordens-servico.controller";

const useCaseNames = [
	"criarOs",
	"listarOs",
	"buscarOs",
	"historicoOs",
	"tempoMedioServicos",
	"consultaPublicaOs",
	"entregarOs",
	"cancelarOs",
] as const;

describe("OrdensServicoController", () => {
	let ucs: Record<(typeof useCaseNames)[number], { execute: jest.Mock }>;
	let controller: OrdensServicoController;
	const user = { id: "u1", email: "x@x", role: Role.MECANICO };
	const cliente = { id: "c1", cpf: "52998224725", nome: "Fulano" };

	beforeEach(() => {
		ucs = Object.fromEntries(useCaseNames.map((n) => [n, { execute: jest.fn().mockResolvedValue({ status: 200 }) }])) as typeof ucs;
		controller = new OrdensServicoController(
			...(useCaseNames.map((n) => ucs[n]) as unknown as ConstructorParameters<typeof OrdensServicoController>),
		);
	});

	describe("delegação para use cases", () => {
		it("create", async () => {
			await controller.create({ clienteId: "c1", veiculoId: "v1" });
			expect(ucs.criarOs.execute).toHaveBeenCalledWith({ clienteId: "c1", veiculoId: "v1" });
		});

		it("list", async () => {
			await controller.list({});
			expect(ucs.listarOs.execute).toHaveBeenCalledWith({});
		});

		it("obterHistorico", async () => {
			await controller.obterHistorico("os1");
			expect(ucs.historicoOs.execute).toHaveBeenCalledWith("os1");
		});

		it("metricas", async () => {
			await controller.metricas({ filtro: "ativos" });
			expect(ucs.tempoMedioServicos.execute).toHaveBeenCalledWith("ativos");
		});

		it("acompanhamento passa cliente.id", async () => {
			await controller.acompanhamento("OS-2026-000001", cliente);
			expect(ucs.consultaPublicaOs.execute).toHaveBeenCalledWith("OS-2026-000001", "c1");
		});

		it("findOne", async () => {
			await controller.findOne("os1");
			expect(ucs.buscarOs.execute).toHaveBeenCalledWith("os1");
		});

		it("entregar passa user.id", async () => {
			await controller.entregar("os1", user);
			expect(ucs.entregarOs.execute).toHaveBeenCalledWith("os1", "u1");
		});

		it("cancelar passa user.id+dto", async () => {
			await controller.cancelar("os1", { motivo: "x" }, user);
			expect(ucs.cancelarOs.execute).toHaveBeenCalledWith("os1", "u1", { motivo: "x" });
		});
	});

	describe("decorators críticos", () => {
		it("acompanhamento exige token de cliente (@ClienteAuth)", () => {
			for (const m of ["acompanhamento"] as const) {
				expect(Reflect.getMetadata(IS_CLIENTE_AUTH_KEY, OrdensServicoController.prototype[m])).toBe(true);
			}
		});

		it("acompanhamento não é @Public()", () => {
			for (const m of ["acompanhamento"] as const) {
				expect(Reflect.getMetadata(IS_PUBLIC_KEY, OrdensServicoController.prototype[m])).toBeFalsy();
			}
		});

		it("cancelar exige ADMINISTRADOR", () => {
			expect(Reflect.getMetadata(ROLES_KEY, OrdensServicoController.prototype.cancelar)).toEqual([Role.ADMINISTRADOR]);
		});

		it("metricas exige ADMINISTRADOR", () => {
			expect(Reflect.getMetadata(ROLES_KEY, OrdensServicoController.prototype.metricas)).toEqual([Role.ADMINISTRADOR]);
		});

		it("rotas migradas para billing/execution não existem mais", () => {
			for (const m of ["gerarOrcamento", "aprovar", "rejeitar", "iniciarDiagnostico", "addItemServico", "finalizar", "desbloquear"])
				expect((OrdensServicoController.prototype as unknown as Record<string, unknown>)[m]).toBeUndefined();
		});
	});
});
