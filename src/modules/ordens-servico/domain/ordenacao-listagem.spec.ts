import { OsStatus } from "./os-status";
import { compararParaListagem, STATUS_OCULTOS_LISTAGEM } from "./ordenacao-listagem";

const os = (status: OsStatus, createdAt: string) => ({ status, createdAt: new Date(createdAt) });

describe("ordenacao-listagem", () => {
	it("EM_EXECUCAO vem antes de AGUARDANDO_APROVACAO", () => {
		expect(compararParaListagem(os(OsStatus.EM_EXECUCAO, "2026-02-01"), os(OsStatus.AGUARDANDO_APROVACAO, "2026-01-01"))).toBeLessThan(
			0,
		);
	});

	it("ordem completa: EM_EXECUCAO > AGUARDANDO_PAGAMENTO > AGUARDANDO_APROVACAO > EM_DIAGNOSTICO > RECEBIDA > BLOQUEADA > CANCELADA", () => {
		const lista = [
			os(OsStatus.CANCELADA, "2026-01-01"),
			os(OsStatus.RECEBIDA, "2026-01-01"),
			os(OsStatus.EM_EXECUCAO, "2026-01-01"),
			os(OsStatus.BLOQUEADA, "2026-01-01"),
			os(OsStatus.EM_DIAGNOSTICO, "2026-01-01"),
			os(OsStatus.AGUARDANDO_APROVACAO, "2026-01-01"),
			os(OsStatus.AGUARDANDO_PAGAMENTO, "2026-01-01"),
		].sort(compararParaListagem);
		expect(lista.map((o) => o.status)).toEqual([
			OsStatus.EM_EXECUCAO,
			OsStatus.AGUARDANDO_PAGAMENTO,
			OsStatus.AGUARDANDO_APROVACAO,
			OsStatus.EM_DIAGNOSTICO,
			OsStatus.RECEBIDA,
			OsStatus.BLOQUEADA,
			OsStatus.CANCELADA,
		]);
	});

	it("dentro do mesmo status, mais antiga primeiro", () => {
		expect(compararParaListagem(os(OsStatus.RECEBIDA, "2026-01-01"), os(OsStatus.RECEBIDA, "2026-02-01"))).toBeLessThan(0);
	});

	it("status fora da lista de prioridade vai pro fim", () => {
		const desconhecido = os("STATUS_NOVO" as OsStatus, "2026-01-01");
		expect(compararParaListagem(desconhecido, os(OsStatus.CANCELADA, "2026-02-01"))).toBeGreaterThan(0);
		expect(compararParaListagem(os(OsStatus.EM_EXECUCAO, "2026-02-01"), desconhecido)).toBeLessThan(0);
	});

	it("FINALIZADA e ENTREGUE são status ocultos", () => {
		expect(STATUS_OCULTOS_LISTAGEM).toEqual([OsStatus.FINALIZADA, OsStatus.ENTREGUE]);
	});
});
