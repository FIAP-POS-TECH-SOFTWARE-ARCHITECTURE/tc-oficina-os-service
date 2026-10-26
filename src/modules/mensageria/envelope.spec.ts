import { criarEnvelope } from "./envelope";

describe("criarEnvelope", () => {
	const base = {
		tipo: "SolicitarDiagnostico",
		fluxoId: "f1",
		osId: "o1",
		numeroOs: "OS-2026-000001",
		correlationId: "req-1",
		payload: { a: 1 },
	};

	it("preenche versao 1, origem os, messageId uuid e ocorridoEm ISO", () => {
		const e = criarEnvelope(base);
		expect(e).toEqual(expect.objectContaining({ ...base, versao: 1, origem: "os" }));
		expect(e.messageId).toMatch(/^[0-9a-f-]{36}$/);
		expect(new Date(e.ocorridoEm).toISOString()).toBe(e.ocorridoEm);
	});

	it("respeita messageId, origem e ocorridoEm informados", () => {
		const em = new Date("2026-10-20T13:05:00.000Z");
		const e = criarEnvelope({ ...base, origem: "billing", messageId: "7b0e6a52-5d1c-4c1e-9a53-2f7d9b3c4e01", ocorridoEm: em });
		expect(e).toEqual(
			expect.objectContaining({
				origem: "billing",
				messageId: "7b0e6a52-5d1c-4c1e-9a53-2f7d9b3c4e01",
				ocorridoEm: "2026-10-20T13:05:00.000Z",
			}),
		);
	});
});
