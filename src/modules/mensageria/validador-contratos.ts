import { Injectable } from "@nestjs/common";
import Ajv2020, { AnySchema, ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EnvelopeMensagem } from "./envelope";

const BASE_ID = "https://oficina.local/contratos/schemas";
export type ResultadoValidacao = { valido: true; envelope: EnvelopeMensagem } | { valido: false; erros: string[] };

const formatar = (erros: ErrorObject[] | null | undefined, prefixo: string) =>
	(erros ?? []).map((e) => `${prefixo}${e.instancePath || "/"} ${e.message ?? "inválido"}`);

@Injectable()
export class ValidadorContratos {
	private readonly ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });

	constructor() {
		addFormats(this.ajv);
		const raiz = join(process.cwd(), "contratos", "schemas");
		const ler = (...p: string[]) => JSON.parse(readFileSync(join(raiz, ...p), "utf8")) as AnySchema;
		this.ajv.addSchema(ler("envelope.schema.json"));
		for (const arq of readdirSync(join(raiz, "payloads"))) this.ajv.addSchema(ler("payloads", arq));
	}

	validar(mensagem: unknown): ResultadoValidacao {
		const envelope = this.ajv.getSchema(`${BASE_ID}/envelope.schema.json`)!;
		if (!envelope(mensagem)) return { valido: false, erros: formatar(envelope.errors, "envelope") };

		const msg = mensagem as EnvelopeMensagem;
		const payload = this.ajv.getSchema(`${BASE_ID}/payloads/${msg.tipo}.schema.json`);
		if (!payload) return { valido: false, erros: [`tipo desconhecido: ${msg.tipo}`] };
		if (!payload(msg.payload)) return { valido: false, erros: formatar(payload.errors, "payload") };
		return { valido: true, envelope: msg };
	}
}
