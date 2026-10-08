import { CreateTableCommand, DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { CreateTopicCommand, PublishCommand, SNSClient, SubscribeCommand } from "@aws-sdk/client-sns";
import {
	CreateQueueCommand,
	GetQueueAttributesCommand,
	Message,
	ReceiveMessageCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { GetParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { configurarAmbienteAws, iniciarMiniStack, MiniStackIniciado, PORTA_MINISTACK } from "../helpers/ministack";

const ENV = "homolog";

const exemplo = (tipo: string): string =>
	readFileSync(path.join(__dirname, "..", "..", "contratos", "exemplos", `${tipo}.json`), "utf8");

const atributos = (tipo: string, origem: string) => ({
	tipo: { DataType: "String", StringValue: tipo },
	origem: { DataType: "String", StringValue: origem },
});

describe("MiniStack: recursos AWS usados pelos microsserviços", () => {
	let ministack: MiniStackIniciado;
	let sns: SNSClient;
	let sqs: SQSClient;
	let dynamo: DynamoDBClient;
	let ssm: SSMClient;

	beforeAll(async () => {
		ministack = await iniciarMiniStack();
		configurarAmbienteAws(ministack.endpoint);
		sns = new SNSClient({});
		sqs = new SQSClient({});
		dynamo = new DynamoDBClient({});
		ssm = new SSMClient({});
	});

	afterAll(async () => {
		sns?.destroy();
		sqs?.destroy();
		dynamo?.destroy();
		ssm?.destroy();
		await ministack?.container.stop();
	});

	async function arnDaFila(url: string): Promise<string> {
		const r = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }));
		return r.Attributes!.QueueArn!;
	}

	async function criarFilaComDlq(nome: string, visibilidadeSegundos: number) {
		const dlq = await sqs.send(new CreateQueueCommand({ QueueName: `${nome}-dlq` }));
		const dlqArn = await arnDaFila(dlq.QueueUrl!);
		const fila = await sqs.send(
			new CreateQueueCommand({
				QueueName: nome,
				Attributes: {
					VisibilityTimeout: String(visibilidadeSegundos),
					RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 5 }),
				},
			}),
		);
		return { filaUrl: fila.QueueUrl!, filaArn: await arnDaFila(fila.QueueUrl!), dlqUrl: dlq.QueueUrl! };
	}

	async function receber(url: string, chamadas: number): Promise<Message[]> {
		const mensagens: Message[] = [];
		for (let i = 0; i < chamadas; i++) {
			const r = await sqs.send(
				new ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 10, WaitTimeSeconds: 2, MessageAttributeNames: ["All"] }),
			);
			mensagens.push(...(r.Messages ?? []));
		}
		return mensagens;
	}

	it("devolve QueueUrl utilizável pela porta mapeada do container", async () => {
		const { filaUrl } = await criarFilaComDlq(`oficina-${ENV}-execucao-comandos`, 60);
		console.info(`QueueUrl: ${filaUrl} | porta mapeada: ${ministack.container.getMappedPort(PORTA_MINISTACK)}`);

		await sqs.send(
			new SendMessageCommand({
				QueueUrl: filaUrl,
				MessageBody: exemplo("SolicitarDiagnostico"),
				MessageAttributes: atributos("SolicitarDiagnostico", "os"),
			}),
		);
		const recebidas = await receber(filaUrl, 1);

		expect(recebidas).toHaveLength(1);
		expect(JSON.parse(recebidas[0].Body!)).toEqual(JSON.parse(exemplo("SolicitarDiagnostico")));
	});

	describe("assinatura SNS → SQS do orquestrador", () => {
		let recebidas: Message[];

		beforeAll(async () => {
			const { TopicArn } = await sns.send(new CreateTopicCommand({ Name: `oficina-${ENV}-eventos` }));
			const { filaUrl, filaArn } = await criarFilaComDlq(`oficina-${ENV}-os-orquestrador-eventos`, 60);
			await sns.send(
				new SubscribeCommand({
					TopicArn,
					Protocol: "sqs",
					Endpoint: filaArn,
					Attributes: {
						RawMessageDelivery: "true",
						FilterPolicyScope: "MessageAttributes",
						FilterPolicy: JSON.stringify({ origem: ["billing", "execution"] }),
					},
				}),
			);

			await sns.send(
				new PublishCommand({ TopicArn, Message: exemplo("FluxoConcluido"), MessageAttributes: atributos("FluxoConcluido", "os") }),
			);
			await sns.send(
				new PublishCommand({
					TopicArn,
					Message: exemplo("OrcamentoGerado"),
					MessageAttributes: atributos("OrcamentoGerado", "billing"),
				}),
			);
			await sns.send(
				new PublishCommand({
					TopicArn,
					Message: exemplo("DiagnosticoIniciado"),
					MessageAttributes: atributos("DiagnosticoIniciado", "execution"),
				}),
			);

			recebidas = await receber(filaUrl, 3);
		});

		it("entrega o corpo cru (RawMessageDelivery), sem envelope SNS", () => {
			const corpos = recebidas.map((m) => JSON.parse(m.Body!) as { tipo?: string; Type?: string });
			expect(corpos.every((c) => c.Type === undefined)).toBe(true);
			expect(corpos).toContainEqual(JSON.parse(exemplo("OrcamentoGerado")));
		});

		it("entrega os MessageAttributes do SNS como atributos da mensagem SQS", () => {
			const orcamento = recebidas.find((m) => JSON.parse(m.Body!).tipo === "OrcamentoGerado");
			expect(orcamento?.MessageAttributes?.tipo?.StringValue).toBe("OrcamentoGerado");
			expect(orcamento?.MessageAttributes?.origem?.StringValue).toBe("billing");
		});

		it("aplica FilterPolicy por origem (evento de origem os não chega)", () => {
			const tipos = recebidas.map((m) => JSON.parse(m.Body!).tipo as string).sort();
			expect(tipos).toEqual(["DiagnosticoIniciado", "OrcamentoGerado"]);
		});
	});

	it("move para a DLQ a mensagem recebida 5 vezes sem delete", async () => {
		const { filaUrl, dlqUrl } = await criarFilaComDlq(`oficina-${ENV}-billing-comandos`, 1);
		await sqs.send(
			new SendMessageCommand({
				QueueUrl: filaUrl,
				MessageBody: exemplo("GerarOrcamento"),
				MessageAttributes: atributos("GerarOrcamento", "os"),
			}),
		);

		let recebimentos = 0;
		for (let tentativa = 0; tentativa < 15 && recebimentos < 5; tentativa++) {
			const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: filaUrl, WaitTimeSeconds: 2 }));
			recebimentos += r.Messages?.length ?? 0;
			await esperar(1500);
		}
		expect(recebimentos).toBe(5);

		expect(await receber(filaUrl, 1)).toHaveLength(0);
		const naDlq = await receber(dlqUrl, 2);
		expect(naDlq).toHaveLength(1);
		expect(JSON.parse(naDlq[0].Body!)).toEqual(JSON.parse(exemplo("GerarOrcamento")));
	});

	it("TransactWriteItems com ConditionExpression cancela a transação inteira no messageId duplicado", async () => {
		const TableName = `oficina-billing-${ENV}`;
		await dynamo.send(
			new CreateTableCommand({
				TableName,
				BillingMode: "PAY_PER_REQUEST",
				AttributeDefinitions: [
					{ AttributeName: "pk", AttributeType: "S" },
					{ AttributeName: "sk", AttributeType: "S" },
				],
				KeySchema: [
					{ AttributeName: "pk", KeyType: "HASH" },
					{ AttributeName: "sk", KeyType: "RANGE" },
				],
			}),
		);
		const registrar = (messageId: string) => ({
			Put: { TableName, Item: { pk: { S: `MSG#${messageId}` }, sk: { S: "MSG" } }, ConditionExpression: "attribute_not_exists(pk)" },
		});
		const jaProcessada = "5f7c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
		const nova = "6a8d2e3f-4b5c-4d6e-9f7a-8b9c0d1e2f3a";

		await dynamo.send(new TransactWriteItemsCommand({ TransactItems: [registrar(jaProcessada)] }));
		const erro = await dynamo.send(new TransactWriteItemsCommand({ TransactItems: [registrar(nova), registrar(jaProcessada)] })).then(
			() => null,
			(e: unknown) => e as { name?: string; CancellationReasons?: { Code?: string }[] },
		);

		expect(erro?.name).toBe("TransactionCanceledException");
		const gravadaMesmoAssim = await dynamo.send(
			new GetItemCommand({ TableName, Key: { pk: { S: `MSG#${nova}` }, sk: { S: "MSG" } } }),
		);
		expect(gravadaMesmoAssim.Item).toBeUndefined();
		expect(erro?.CancellationReasons?.map((r) => r.Code)).toContain("ConditionalCheckFailed");
	});

	it("SSM grava e lê parâmetro", async () => {
		const Name = `/oficina/${ENV}/mensageria/eventos-topic-arn`;
		const Value = `arn:aws:sns:us-east-1:000000000000:oficina-${ENV}-eventos`;

		await ssm.send(new PutParameterCommand({ Name, Value, Type: "String", Overwrite: true }));
		const r = await ssm.send(new GetParameterCommand({ Name }));

		expect(r.Parameter?.Value).toBe(Value);
	});
});
