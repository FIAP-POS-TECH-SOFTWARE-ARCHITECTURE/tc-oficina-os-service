import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "contratos");
const ler = (...p: string[]) => JSON.parse(readFileSync(join(RAIZ, ...p), "utf8"));

const tipos: { comandos: Record<string, string[]>; eventos: Record<string, string[]> } = ler("tipos.json");
const todosTipos = [...Object.values(tipos.comandos).flat(), ...Object.values(tipos.eventos).flat()];
const origemPorTipo = new Map<string, string>([
	...Object.values(tipos.comandos)
		.flat()
		.map((t) => [t, "os"] as [string, string]),
	...Object.entries(tipos.eventos).flatMap(([origem, ts]) => ts.map((t) => [t, origem] as [string, string])),
]);

function criarAjv() {
	const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
	addFormats(ajv);
	ajv.addSchema(ler("schemas", "envelope.schema.json"));
	for (const arq of readdirSync(join(RAIZ, "schemas", "payloads"))) ajv.addSchema(ler("schemas", "payloads", arq));
	return ajv;
}

function validar(ajv: Ajv2020, msg: { tipo: string; payload: unknown }) {
	const env = ajv.getSchema("https://oficina.local/contratos/schemas/envelope.schema.json")!;
	const pay = ajv.getSchema(`https://oficina.local/contratos/schemas/payloads/${msg.tipo}.schema.json`);
	if (!pay) return { ok: false, erros: [`schema inexistente para ${msg.tipo}`] };
	const okEnv = env(msg);
	const okPay = pay(msg.payload);
	return { ok: okEnv && okPay, erros: [...(env.errors ?? []), ...(pay.errors ?? [])] };
}

describe("contratos de mensageria", () => {
	const ajv = criarAjv();

	it("tipos.json não tem tipo repetido", () => {
		expect(new Set(todosTipos).size).toBe(todosTipos.length);
	});

	it.each(todosTipos)("%s tem schema de payload e exemplo", (tipo) => {
		expect(readdirSync(join(RAIZ, "schemas", "payloads"))).toContain(`${tipo}.schema.json`);
		expect(readdirSync(join(RAIZ, "exemplos"))).toContain(`${tipo}.json`);
	});

	it("não há schema nem exemplo órfão (fora de tipos.json)", () => {
		const schemas = readdirSync(join(RAIZ, "schemas", "payloads")).map((f) => f.replace(".schema.json", ""));
		const exemplos = readdirSync(join(RAIZ, "exemplos")).map((f) => f.split(".")[0]);
		expect(schemas.filter((t) => !todosTipos.includes(t))).toEqual([]);
		expect(exemplos.filter((t) => !todosTipos.includes(t))).toEqual([]);
	});

	it.each(readdirSync(join(RAIZ, "exemplos")))("exemplo %s é válido e coerente", (arq) => {
		const msg = ler("exemplos", arq);
		const r = validar(ajv, msg);
		expect(r.erros).toEqual([]);
		expect(r.ok).toBe(true);
		expect(arq.split(".")[0]).toBe(msg.tipo);
		expect(msg.origem).toBe(origemPorTipo.get(msg.tipo));
	});

	it("aceita campo extra no payload (evolução compatível)", () => {
		const msg = ler("exemplos", "GerarOrcamento.json");
		msg.payload.campoNovo = "x";
		expect(validar(ajv, msg).ok).toBe(true);
	});

	it.each([
		"envelope-campo-extra.json",
		"GerarOrcamento.valor-string.json",
		"GerarOrcamento.valor-float.json",
		"DiagnosticoConcluido.sem-itens.json",
	])("rejeita %s", (arq) => {
		expect(validar(ajv, ler("invalidos", arq)).ok).toBe(false);
	});
});
