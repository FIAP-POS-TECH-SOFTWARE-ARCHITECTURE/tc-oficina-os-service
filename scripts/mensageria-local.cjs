// Cria no MiniStack local (npm run ministack:up) os recursos de mensageria com <env>=local e imprime as envs.
const { SQSClient, CreateQueueCommand, GetQueueAttributesCommand, SetQueueAttributesCommand } = require("@aws-sdk/client-sqs");
const { SNSClient, CreateTopicCommand, SubscribeCommand } = require("@aws-sdk/client-sns");

const config = { region: "us-east-1", endpoint: process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566", credentials: { accessKeyId: "test", secretAccessKey: "test" } };
const sqs = new SQSClient(config);
const sns = new SNSClient(config);
const ENV = "local";

async function fila(nome) {
	const dlq = (await sqs.send(new CreateQueueCommand({ QueueName: `oficina-${ENV}-${nome}-dlq`, Attributes: { MessageRetentionPeriod: "1209600" } }))).QueueUrl;
	const dlqArn = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq, AttributeNames: ["QueueArn"] }))).Attributes.QueueArn;
	const url = (await sqs.send(new CreateQueueCommand({ QueueName: `oficina-${ENV}-${nome}`, Attributes: { VisibilityTimeout: "60", ReceiveMessageWaitTimeSeconds: "20", MessageRetentionPeriod: "345600" } }))).QueueUrl;
	await sqs.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes: { RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 5 }) } }));
	const arn = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }))).Attributes.QueueArn;
	return { url, arn };
}

(async () => {
	const execucao = await fila("execucao-comandos");
	const billing = await fila("billing-comandos");
	const orquestrador = await fila("os-orquestrador-eventos");
	const topico = (await sns.send(new CreateTopicCommand({ Name: `oficina-${ENV}-eventos` }))).TopicArn;
	await sns.send(new SubscribeCommand({
		TopicArn: topico,
		Protocol: "sqs",
		Endpoint: orquestrador.arn,
		Attributes: { RawMessageDelivery: "true", FilterPolicy: JSON.stringify({ origem: ["billing", "execution"] }), FilterPolicyScope: "MessageAttributes" },
	}));
	console.log(`SNS_EVENTOS_ARN="${topico}"`);
	console.log(`SQS_EXECUCAO_COMANDOS_URL="${execucao.url}"`);
	console.log(`SQS_BILLING_COMANDOS_URL="${billing.url}"`);
	console.log(`SQS_OS_ORQUESTRADOR_EVENTOS_URL="${orquestrador.url}"`);
})().catch((erro) => {
	console.error(`Falha ao criar a mensageria local: ${erro.message}`);
	process.exit(1);
});
