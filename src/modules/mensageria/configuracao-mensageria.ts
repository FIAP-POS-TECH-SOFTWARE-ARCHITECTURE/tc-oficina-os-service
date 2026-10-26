import { readFileSync } from "node:fs";
import { join } from "node:path";

export type FilaComando = "execucao-comandos" | "billing-comandos";
export type DestinoMensagem = FilaComando | "eventos";

const tipos = JSON.parse(readFileSync(join(process.cwd(), "contratos", "tipos.json"), "utf8")) as {
	comandos: { execution: string[]; billing: string[] };
};

export const COMANDOS_POR_FILA: Record<FilaComando, readonly string[]> = {
	"execucao-comandos": tipos.comandos.execution,
	"billing-comandos": tipos.comandos.billing,
};

const ENV_DA_FILA: Record<FilaComando, string> = {
	"execucao-comandos": "SQS_EXECUCAO_COMANDOS_URL",
	"billing-comandos": "SQS_BILLING_COMANDOS_URL",
};

export function destinoDoTipo(tipo: string): DestinoMensagem {
	for (const fila of Object.keys(COMANDOS_POR_FILA) as FilaComando[]) if (COMANDOS_POR_FILA[fila].includes(tipo)) return fila;
	return "eventos";
}

export function urlDaFila(fila: FilaComando): string {
	const url = process.env[ENV_DA_FILA[fila]];
	if (!url) throw new Error(`${ENV_DA_FILA[fila]} não definido`);
	return url;
}

export function workersHabilitados(): boolean {
	return process.env.WORKERS_HABILITADOS !== "false";
}
