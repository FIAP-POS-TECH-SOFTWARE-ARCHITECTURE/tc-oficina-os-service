import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EnvelopeMensagem } from "../../mensageria/envelope";
import { paraEventoFluxo } from "./eventos-recebidos";

const PASTA = join(process.cwd(), "contratos", "exemplos");
const ler = (arq: string) => JSON.parse(readFileSync(join(PASTA, arq), "utf8")) as EnvelopeMensagem;
const exemplos = readdirSync(PASTA).map((arq) => [arq, ler(arq)] as const);

describe("paraEventoFluxo", () => {
	it.each(exemplos.filter(([, e]) => e.origem !== "os"))("converte %s", (_arq, exemplo) => {
		expect(paraEventoFluxo(exemplo)?.tipo).toBe(exemplo.tipo);
	});

	it.each(exemplos.filter(([, e]) => e.origem === "os"))("ignora %s (origem os)", (_arq, exemplo) => {
		expect(paraEventoFluxo(exemplo)).toBeNull();
	});

	it("OrcamentoAprovado converte prazoPagamentoEm para Date", () => {
		const e = ler("OrcamentoAprovado.json");
		const p = e.payload as { prazoPagamentoEm: string };
		expect(paraEventoFluxo(e)).toEqual({ tipo: "OrcamentoAprovado", prazoPagamentoEm: new Date(p.prazoPagamentoEm) });
	});

	it("ReparoConcluido usa payload.concluidoEm", () => {
		const e = ler("ReparoConcluido.json");
		const p = e.payload as { concluidoEm: string };
		expect(paraEventoFluxo(e)).toEqual({ tipo: "ReparoConcluido", em: new Date(p.concluidoEm) });
	});

	it("OrcamentoRejeitado preserva motivo null", () => {
		const e = ler("OrcamentoRejeitado.json");
		expect(paraEventoFluxo({ ...e, payload: { ...e.payload, motivo: null } })).toEqual({ tipo: "OrcamentoRejeitado", motivo: null });
	});
});
