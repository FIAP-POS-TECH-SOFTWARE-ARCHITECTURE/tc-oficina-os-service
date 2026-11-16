jest.mock("newrelic", () => {
	const transacao = {
		insertDistributedTraceHeaders: jest.fn((h: Record<string, string>) =>
			Object.assign(h, { traceparent: "00-abc-def-01", tracestate: "x=y", newrelic: "eyJ9" }),
		),
		acceptDistributedTraceHeaders: jest.fn(),
	};
	return {
		__transacao: transacao,
		getTransaction: jest.fn(() => transacao),
		startBackgroundTransaction: jest.fn((_nome: string, _grupo: string, fn: () => unknown) => fn()),
	};
});
import newrelic from "newrelic";
import { capturarCabecalhosTrace, executarComTrace } from "./trace";

const t = (newrelic as unknown as { __transacao: Record<string, jest.Mock> }).__transacao;

describe("trace", () => {
	beforeEach(() => jest.clearAllMocks());

	it("captura os 3 cabeçalhos da transação corrente", () => {
		expect(capturarCabecalhosTrace()).toEqual({ traceparent: "00-abc-def-01", tracestate: "x=y", newrelic: "eyJ9" });
	});

	it("devolve {} quando o agente lança", () => {
		(newrelic.getTransaction as jest.Mock).mockImplementationOnce(() => {
			throw new Error("agente desligado");
		});
		expect(capturarCabecalhosTrace()).toEqual({});
	});

	it("executa em transação de background aceitando só os cabeçalhos presentes", async () => {
		const r = await executarComTrace("GerarOrcamento", { traceparent: "00-a-b-01" }, async () => 42);
		expect(r).toBe(42);
		expect(newrelic.startBackgroundTransaction).toHaveBeenCalledWith("mensageria/GerarOrcamento", "SQS", expect.any(Function));
		expect(t.acceptDistributedTraceHeaders).toHaveBeenCalledWith("Queue", { traceparent: "00-a-b-01" });
	});

	it("sem cabeçalhos não chama accept e ainda executa", async () => {
		await expect(executarComTrace("X", {}, async () => "ok")).resolves.toBe("ok");
		expect(t.acceptDistributedTraceHeaders).not.toHaveBeenCalled();
	});

	it("erro de fn propaga (consumidor decide não apagar)", async () => {
		await expect(
			executarComTrace("X", {}, async () => {
				throw new Error("falhou");
			}),
		).rejects.toThrow("falhou");
	});
});
