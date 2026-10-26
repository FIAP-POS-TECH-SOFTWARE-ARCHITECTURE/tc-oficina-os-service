import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { PublishCommand } from "@aws-sdk/client-sns";
import { criarEnvelope } from "./envelope";
import { SnsSqsPublicador } from "./sns-sqs-publicador";

describe("SnsSqsPublicador", () => {
	const sqs = { send: jest.fn().mockResolvedValue({}) };
	const sns = { send: jest.fn().mockResolvedValue({}) };
	const publicador = new SnsSqsPublicador(sqs as never, sns as never);
	const env = (tipo: string) =>
		criarEnvelope({ tipo, fluxoId: "f", osId: "o", numeroOs: "n", correlationId: "c", payload: { motivo: "x" } });

	beforeEach(() => {
		jest.clearAllMocks();
		process.env.SQS_BILLING_COMANDOS_URL = "http://q/billing";
		process.env.SNS_EVENTOS_ARN = "arn:aws:sns:us-east-1:000000000000:oficina-local-eventos";
	});

	it("enviarComando manda o envelope JSON para a fila com atributos", async () => {
		const e = env("CancelarOrcamento");
		await publicador.enviarComando("billing-comandos", e);
		const cmd = sqs.send.mock.calls[0][0] as SendMessageCommand;
		expect(cmd.input).toEqual({
			QueueUrl: "http://q/billing",
			MessageBody: JSON.stringify(e),
			MessageAttributes: {
				tipo: { DataType: "String", StringValue: "CancelarOrcamento" },
				origem: { DataType: "String", StringValue: "os" },
			},
		});
	});

	it("publicarEvento publica no tópico", async () => {
		const e = env("FluxoConcluido");
		await publicador.publicarEvento(e);
		expect((sns.send.mock.calls[0][0] as PublishCommand).input).toEqual(
			expect.objectContaining({ TopicArn: process.env.SNS_EVENTOS_ARN, Message: JSON.stringify(e) }),
		);
	});

	it("falha alto sem SNS_EVENTOS_ARN", async () => {
		delete process.env.SNS_EVENTOS_ARN;
		await expect(publicador.publicarEvento(env("FluxoConcluido"))).rejects.toThrow("SNS_EVENTOS_ARN não definido");
	});
});
