import { DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { Logger } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConsumidorSqs } from "./consumidor-sqs";
import { ValidadorContratos } from "./validador-contratos";

const exemplo = (tipo: string) => readFileSync(join(process.cwd(), "contratos", "exemplos", `${tipo}.json`), "utf8");
const msg = (id: string, body: string, origem = "billing") => ({
	MessageId: id,
	ReceiptHandle: `rh-${id}`,
	Body: body,
	MessageAttributes: { origem: { DataType: "String", StringValue: origem } },
});

describe("ConsumidorSqs", () => {
	let sqs: { send: jest.Mock };
	let consumidor: ConsumidorSqs;
	let erro: jest.SpyInstance;
	const processar = jest.fn();
	const apagados = () => sqs.send.mock.calls.filter(([c]) => c instanceof DeleteMessageCommand).map(([c]) => c.input.ReceiptHandle);

	beforeEach(() => {
		jest.clearAllMocks();
		erro = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		sqs = { send: jest.fn() };
		consumidor = new ConsumidorSqs(new ValidadorContratos(), sqs as never);
	});

	afterEach(() => jest.restoreAllMocks());

	it("processa e apaga mensagem válida; mantém a que falhou no processamento", async () => {
		sqs.send
			.mockResolvedValueOnce({ Messages: [msg("1", exemplo("OrcamentoGerado")), msg("2", exemplo("OrcamentoAprovado"))] })
			.mockResolvedValue({});
		processar.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("banco fora"));
		expect(await consumidor.processarLote("url", processar, ["billing", "execution"])).toBe(2);
		expect(processar).toHaveBeenCalledWith(expect.objectContaining({ tipo: "OrcamentoGerado" }));
		expect(apagados()).toEqual(["rh-1"]);
		expect(erro).toHaveBeenCalledWith(expect.objectContaining({ event: "mensageria.falha_processamento" }));
	});

	it("mensagem inválida não é processada nem apagada (vai para a DLQ)", async () => {
		sqs.send.mockResolvedValueOnce({
			Messages: [
				msg("1", "{não é json"),
				msg("2", readFileSync(join(process.cwd(), "contratos", "invalidos", "GerarOrcamento.valor-float.json"), "utf8")),
			],
		});
		await consumidor.processarLote("url", processar, ["billing"]);
		expect(processar).not.toHaveBeenCalled();
		expect(apagados()).toEqual([]);
		expect(erro).toHaveBeenCalledTimes(2);
	});

	it("origem não aceita é apagada sem processar", async () => {
		sqs.send.mockResolvedValueOnce({ Messages: [msg("1", exemplo("FluxoConcluido"), "os")] }).mockResolvedValue({});
		await consumidor.processarLote("url", processar, ["billing", "execution"]);
		expect(processar).not.toHaveBeenCalled();
		expect(apagados()).toEqual(["rh-1"]);
	});

	it("iniciar/parar: laço sobrevive a erro de rede e para sob demanda", async () => {
		consumidor.esperaAposErroMs = 0;
		sqs.send
			.mockRejectedValueOnce(new Error("rede"))
			.mockImplementation(
				(_comando: unknown, opcoes: { abortSignal: AbortSignal }) =>
					new Promise((_ok, falhar) => opcoes.abortSignal.addEventListener("abort", () => falhar(new Error("abortado")))),
			);
		consumidor.iniciar("url", processar, ["billing"]);
		for (let i = 0; i < 20 && sqs.send.mock.calls.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
		expect(sqs.send.mock.calls.length).toBe(2);
		expect(erro).toHaveBeenCalledWith(expect.objectContaining({ event: "mensageria.falha_recebimento" }));
		await expect(consumidor.parar()).resolves.toBeUndefined();
	});
});
