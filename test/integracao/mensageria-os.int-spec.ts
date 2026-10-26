import { CreateTopicCommand, SNSClient, SubscribeCommand } from "@aws-sdk/client-sns";
import { CreateQueueCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConsumidorSqs } from "../../src/modules/mensageria/consumidor-sqs";
import { EnvelopeMensagem } from "../../src/modules/mensageria/envelope";
import { SnsSqsPublicador } from "../../src/modules/mensageria/sns-sqs-publicador";
import { ValidadorContratos } from "../../src/modules/mensageria/validador-contratos";
import { configurarAmbienteAws, iniciarMiniStack, MiniStackIniciado } from "../helpers/ministack";

jest.setTimeout(120_000);
const exemplo = (tipo: string): EnvelopeMensagem => ({
	...JSON.parse(readFileSync(join(process.cwd(), "contratos", "exemplos", `${tipo}.json`), "utf8")),
	messageId: randomUUID(),
});

describe("Mensageria do os-service no emulador AWS", () => {
	let ministack: MiniStackIniciado;
	let sqs: SQSClient;
	let sns: SNSClient;
	let filaOrquestrador: string;
	let filaBilling: string;
	let publicador: SnsSqsPublicador;
	let consumidor: ConsumidorSqs;

	beforeAll(async () => {
		ministack = await iniciarMiniStack();
		configurarAmbienteAws(ministack.endpoint);
		sqs = new SQSClient({});
		sns = new SNSClient({});
		const topico = (await sns.send(new CreateTopicCommand({ Name: "oficina-homolog-eventos" }))).TopicArn!;
		filaOrquestrador = (await sqs.send(new CreateQueueCommand({ QueueName: "oficina-homolog-os-orquestrador-eventos" }))).QueueUrl!;
		filaBilling = (await sqs.send(new CreateQueueCommand({ QueueName: "oficina-homolog-billing-comandos" }))).QueueUrl!;
		const arn = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: filaOrquestrador, AttributeNames: ["QueueArn"] })))
			.Attributes!.QueueArn!;
		await sns.send(
			new SubscribeCommand({
				TopicArn: topico,
				Protocol: "sqs",
				Endpoint: arn,
				Attributes: {
					RawMessageDelivery: "true",
					FilterPolicy: JSON.stringify({ origem: ["billing", "execution"] }),
					FilterPolicyScope: "MessageAttributes",
				},
			}),
		);
		process.env.SNS_EVENTOS_ARN = topico;
		process.env.SQS_BILLING_COMANDOS_URL = filaBilling;
		publicador = new SnsSqsPublicador(sqs, sns);
		consumidor = new ConsumidorSqs(new ValidadorContratos(), sqs);
	});

	afterAll(async () => {
		await ministack?.container.stop();
	});

	it("evento do billing chega cru à fila do orquestrador, é processado e apagado", async () => {
		const envelope = exemplo("OrcamentoGerado");
		await publicador.publicarEvento(envelope);
		const recebidos: EnvelopeMensagem[] = [];
		for (let i = 0; i < 3 && recebidos.length === 0; i++)
			await consumidor.processarLote(filaOrquestrador, async (e) => void recebidos.push(e), ["billing", "execution"]);
		expect(recebidos.map((e) => e.messageId)).toEqual([envelope.messageId]);
		const resto = await sqs.send(new ReceiveMessageCommand({ QueueUrl: filaOrquestrador, WaitTimeSeconds: 2 }));
		expect(resto.Messages ?? []).toHaveLength(0);
	});

	it("evento de origem os não é entregue à fila do orquestrador (FilterPolicy)", async () => {
		await publicador.publicarEvento(exemplo("FluxoConcluido"));
		const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: filaOrquestrador, WaitTimeSeconds: 3 }));
		expect(r.Messages ?? []).toHaveLength(0);
	});

	it("comando vai para a fila do billing com atributos tipo e origem", async () => {
		const envelope = exemplo("CancelarOrcamento");
		await publicador.enviarComando("billing-comandos", envelope);
		const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: filaBilling, WaitTimeSeconds: 5, MessageAttributeNames: ["All"] }));
		expect(JSON.parse(r.Messages![0].Body!).messageId).toBe(envelope.messageId);
		expect(r.Messages![0].MessageAttributes).toEqual(
			expect.objectContaining({
				tipo: expect.objectContaining({ StringValue: "CancelarOrcamento" }),
				origem: expect.objectContaining({ StringValue: "os" }),
			}),
		);
	});
});
