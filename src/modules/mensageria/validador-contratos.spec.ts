import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ValidadorContratos } from "./validador-contratos";

const ler = (...p: string[]) => JSON.parse(readFileSync(join(process.cwd(), "contratos", ...p), "utf8"));

describe("ValidadorContratos", () => {
	const validador = new ValidadorContratos();

	it.each(readdirSync(join(process.cwd(), "contratos", "exemplos")))("aceita o exemplo %s", (arq) => {
		const r = validador.validar(ler("exemplos", arq));
		expect(r).toEqual(expect.objectContaining({ valido: true }));
	});

	it.each(readdirSync(join(process.cwd(), "contratos", "invalidos")))("rejeita %s com erros legíveis", (arq) => {
		const r = validador.validar(ler("invalidos", arq));
		expect(r.valido).toBe(false);
		if (!r.valido) expect(r.erros.length).toBeGreaterThan(0);
	});

	it("rejeita tipo desconhecido, não-objeto e undefined", () => {
		const msg = ler("exemplos", "OrcamentoGerado.json");
		expect(validador.validar({ ...msg, tipo: "TipoQueNaoExiste" })).toEqual({
			valido: false,
			erros: ["tipo desconhecido: TipoQueNaoExiste"],
		});
		expect(validador.validar("texto").valido).toBe(false);
		expect(validador.validar(undefined).valido).toBe(false);
	});
});
