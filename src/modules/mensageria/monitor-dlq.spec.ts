import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { Test } from "@nestjs/testing";
jest.mock("newrelic", () => ({ recordMetric: jest.fn() }));
import newrelic from "newrelic";
import { MonitorDlq } from "./monitor-dlq";
import { CLIENTE_SQS } from "./publicador-mensagens.port";

const url = (n: string) => `https://sqs.us-east-1.amazonaws.com/123/${n}`;

describe("MonitorDlq", () => {
	const sqs = { send: jest.fn() };
	const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
	const criar = (urls: string) => new MonitorDlq(sqs as never, urls, logger);

	beforeEach(() => jest.clearAllMocks());

	it("registra métrica e log por fila", async () => {
		sqs.send
			.mockResolvedValueOnce({ Attributes: { ApproximateNumberOfMessages: "3" } })
			.mockResolvedValueOnce({ Attributes: { ApproximateNumberOfMessages: "0" } });
		await criar(`${url("oficina-homolog-billing-comandos-dlq")},${url("oficina-homolog-execucao-comandos-dlq")}`).verificar();
		expect(sqs.send.mock.calls[0][0]).toBeInstanceOf(GetQueueAttributesCommand);
		expect(newrelic.recordMetric).toHaveBeenCalledWith("Custom/Mensageria/DLQ/oficina-homolog-billing-comandos-dlq", 3);
		expect(logger.log).toHaveBeenCalledWith({
			event: "mensageria.dlq_profundidade",
			fila: "oficina-homolog-billing-comandos-dlq",
			mensagens: 3,
		});
	});

	it("erro numa fila não impede as outras", async () => {
		sqs.send
			.mockRejectedValueOnce(new Error("AccessDenied"))
			.mockResolvedValueOnce({ Attributes: { ApproximateNumberOfMessages: "1" } });
		await criar(`${url("a-dlq")},${url("b-dlq")}`).verificar();
		expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ event: "mensageria.dlq_erro", fila: "a-dlq" }));
		expect(newrelic.recordMetric).toHaveBeenCalledWith("Custom/Mensageria/DLQ/b-dlq", 1);
	});

	it("sem URLs fica desligado", async () => {
		await criar("").verificar();
		expect(sqs.send).not.toHaveBeenCalled();
	});

	it("resolve pela injeção de dependências lendo SQS_DLQ_URLS do ambiente", async () => {
		const anterior = process.env.SQS_DLQ_URLS;
		process.env.SQS_DLQ_URLS = url("x-dlq");
		try {
			const modulo = await Test.createTestingModule({
				providers: [MonitorDlq, { provide: CLIENTE_SQS, useValue: sqs }],
			}).compile();
			sqs.send.mockResolvedValueOnce({ Attributes: { ApproximateNumberOfMessages: "2" } });
			await modulo.get(MonitorDlq).verificar();
			expect(newrelic.recordMetric).toHaveBeenCalledWith("Custom/Mensageria/DLQ/x-dlq", 2);
		} finally {
			if (anterior === undefined) delete process.env.SQS_DLQ_URLS;
			else process.env.SQS_DLQ_URLS = anterior;
		}
	});
});
