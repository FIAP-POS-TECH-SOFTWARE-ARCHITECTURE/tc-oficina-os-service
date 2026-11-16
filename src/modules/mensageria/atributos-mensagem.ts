import { EnvelopeMensagem } from "./envelope";
import { CabecalhosTrace } from "./trace";

export type AtributosMensagem = Record<string, { DataType: "String"; StringValue: string }>;

// Ponto único de montagem dos MessageAttributes: o cabeçalho de trace distribuído entra aqui.
export function montarAtributos(envelope: EnvelopeMensagem<unknown>, trace: CabecalhosTrace = {}): AtributosMensagem {
	const atributos: AtributosMensagem = {
		tipo: { DataType: "String", StringValue: envelope.tipo },
		origem: { DataType: "String", StringValue: envelope.origem },
	};
	for (const [chave, valor] of Object.entries(trace)) if (valor) atributos[chave] = { DataType: "String", StringValue: valor };
	return atributos;
}
