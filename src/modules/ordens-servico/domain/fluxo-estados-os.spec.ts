import { canTransition, nextStatus, OsTransition, transitionsFrom } from "./fluxo-estados-os";
import { OsStatus } from "./os-status";

describe("Fluxo de estados da OS (domínio)", () => {
	const todasTransicoes: OsTransition[] = [
		"iniciar_diagnostico",
		"bloquear_por_estoque",
		"desbloquear",
		"orcamento_gerado",
		"orcamento_aprovado",
		"pagamento_confirmado",
		"finalizar",
		"entregar",
		"cancelar",
	];

	const todosStatus = Object.values(OsStatus) as OsStatus[];

	const cancelaveis = [
		OsStatus.RECEBIDA,
		OsStatus.EM_DIAGNOSTICO,
		OsStatus.BLOQUEADA,
		OsStatus.AGUARDANDO_APROVACAO,
		OsStatus.AGUARDANDO_PAGAMENTO,
		OsStatus.EM_EXECUCAO,
	];

	const validas: { from: OsStatus; transition: OsTransition; to: OsStatus }[] = [
		{ from: OsStatus.RECEBIDA, transition: "iniciar_diagnostico", to: OsStatus.EM_DIAGNOSTICO },
		{ from: OsStatus.EM_DIAGNOSTICO, transition: "bloquear_por_estoque", to: OsStatus.BLOQUEADA },
		{ from: OsStatus.BLOQUEADA, transition: "desbloquear", to: OsStatus.EM_DIAGNOSTICO },
		{ from: OsStatus.EM_DIAGNOSTICO, transition: "orcamento_gerado", to: OsStatus.AGUARDANDO_APROVACAO },
		{ from: OsStatus.AGUARDANDO_APROVACAO, transition: "orcamento_aprovado", to: OsStatus.AGUARDANDO_PAGAMENTO },
		{ from: OsStatus.AGUARDANDO_PAGAMENTO, transition: "pagamento_confirmado", to: OsStatus.EM_EXECUCAO },
		{ from: OsStatus.EM_EXECUCAO, transition: "finalizar", to: OsStatus.FINALIZADA },
		{ from: OsStatus.FINALIZADA, transition: "entregar", to: OsStatus.ENTREGUE },
		...cancelaveis.map((from) => ({ from, transition: "cancelar", to: OsStatus.CANCELADA })),
	];

	it.each(validas)("aceita $transition a partir de $from -> $to", ({ from, transition, to }) => {
		expect(canTransition(from, transition)).toBe(true);
		expect(nextStatus(transition)).toBe(to);
	});

	it("rejeita transições inválidas para todos os pares restantes", () => {
		const validasSet = new Set(validas.map((v) => `${v.from}|${v.transition}`));
		for (const from of todosStatus) {
			for (const transition of todasTransicoes) {
				if (validasSet.has(`${from}|${transition}`)) continue;
				expect(canTransition(from, transition)).toBe(false);
			}
		}
	});

	it("não permite cancelar OS já entregue", () => {
		expect(canTransition(OsStatus.ENTREGUE, "cancelar")).toBe(false);
	});

	it("não permite entregar antes de finalizar", () => {
		expect(canTransition(OsStatus.EM_EXECUCAO, "entregar")).toBe(false);
	});

	it("OS finalizada (reparo concluído e pago) não é mais cancelável", () => {
		expect(canTransition(OsStatus.FINALIZADA, "cancelar")).toBe(false);
	});

	it("desbloqueio retoma o diagnóstico (bloqueio acontece antes do orçamento)", () => {
		expect(nextStatus("desbloquear")).toBe(OsStatus.EM_DIAGNOSTICO);
	});

	describe("transitionsFrom", () => {
		it("retorna lista de transições disponíveis a partir de RECEBIDA", () => {
			const transitions = transitionsFrom(OsStatus.RECEBIDA);
			expect(transitions).toContain("iniciar_diagnostico");
			expect(transitions).toContain("cancelar");
			expect(transitions).not.toContain("finalizar");
		});

		it("retorna lista de transições disponíveis a partir de EM_EXECUCAO", () => {
			expect(transitionsFrom(OsStatus.EM_EXECUCAO).sort()).toEqual(["cancelar", "finalizar"]);
		});

		it("retorna lista vazia para status sem transições disponíveis (ENTREGUE)", () => {
			const transitions = transitionsFrom(OsStatus.ENTREGUE);
			expect(transitions).toHaveLength(0);
		});
	});
});
