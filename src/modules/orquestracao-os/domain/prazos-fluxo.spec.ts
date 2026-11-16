import { lerPrazos, somarMinutos } from "./prazos-fluxo";

describe("lerPrazos", () => {
	it("usa os padrões em minutos", () => {
		expect(lerPrazos({})).toEqual({ aprovacaoMin: 4320, pagamentoMin: 2880, respostaServicoMin: 10 });
	});
	it("lê valores inteiros positivos", () => {
		expect(lerPrazos({ PRAZO_APROVACAO: "30", PRAZO_PAGAMENTO: "15", PRAZO_RESPOSTA_SERVICO: "2" })).toEqual({
			aprovacaoMin: 30,
			pagamentoMin: 15,
			respostaServicoMin: 2,
		});
	});
	it.each(["0", "-5", "1.5", "72h", ""])("recusa PRAZO_APROVACAO=%p", (v) => {
		expect(() => lerPrazos({ PRAZO_APROVACAO: v })).toThrow("PRAZO_APROVACAO deve ser um inteiro de minutos maior que zero");
	});
	it("somarMinutos", () => {
		expect(somarMinutos(new Date("2026-01-01T00:00:00Z"), 90).toISOString()).toBe("2026-01-01T01:30:00.000Z");
	});
});
