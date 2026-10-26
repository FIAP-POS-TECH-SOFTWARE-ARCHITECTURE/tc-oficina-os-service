import { EnvelopeMensagem } from "./envelope";

export type AtributosMensagem = Record<string, { DataType: "String"; StringValue: string }>;

// Ponto único de montagem dos MessageAttributes: o cabeçalho de trace distribuído entra aqui.
export function montarAtributos(envelope: EnvelopeMensagem<unknown>): AtributosMensagem {
	return {
		tipo: { DataType: "String", StringValue: envelope.tipo },
		origem: { DataType: "String", StringValue: envelope.origem },
	};
}
