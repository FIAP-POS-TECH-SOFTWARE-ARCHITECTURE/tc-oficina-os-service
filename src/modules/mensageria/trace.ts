import newrelic from "newrelic";

export type CabecalhosTrace = Partial<Record<"traceparent" | "tracestate" | "newrelic", string>>;
const CHAVES = ["traceparent", "tracestate", "newrelic"] as const;

export function capturarCabecalhosTrace(): CabecalhosTrace {
	try {
		const cabecalhos: Record<string, string> = {};
		newrelic.getTransaction().insertDistributedTraceHeaders(cabecalhos);
		const r: CabecalhosTrace = {};
		for (const c of CHAVES) if (typeof cabecalhos[c] === "string" && cabecalhos[c]) r[c] = cabecalhos[c];
		return r;
	} catch {
		return {};
	}
}

export function executarComTrace<T>(nome: string, cabecalhos: CabecalhosTrace, fn: () => Promise<T>): Promise<T> {
	return newrelic.startBackgroundTransaction<Promise<T>>(`mensageria/${nome}`, "SQS", () => {
		if (Object.keys(cabecalhos).length > 0) {
			try {
				newrelic.getTransaction().acceptDistributedTraceHeaders("Queue", cabecalhos);
			} catch {
				// agente desligado: segue sem vínculo de trace
			}
		}
		return fn();
	});
}
