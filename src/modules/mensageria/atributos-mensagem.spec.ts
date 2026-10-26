import { montarAtributos } from "./atributos-mensagem";
import { criarEnvelope } from "./envelope";

it("atributos tipo e origem como String (FilterPolicy do SNS usa origem)", () => {
	const e = criarEnvelope({
		tipo: "OrcamentoGerado",
		origem: "billing",
		fluxoId: "f",
		osId: "o",
		numeroOs: "n",
		correlationId: "c",
		payload: {},
	});
	expect(montarAtributos(e)).toEqual({
		tipo: { DataType: "String", StringValue: "OrcamentoGerado" },
		origem: { DataType: "String", StringValue: "billing" },
	});
});
