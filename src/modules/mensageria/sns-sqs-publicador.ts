import { Inject, Injectable } from "@nestjs/common";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { montarAtributos } from "./atributos-mensagem";
import { FilaComando, urlDaFila } from "./configuracao-mensageria";
import { EnvelopeMensagem } from "./envelope";
import { CLIENTE_SNS, CLIENTE_SQS, PublicadorMensagensPort } from "./publicador-mensagens.port";

@Injectable()
export class SnsSqsPublicador implements PublicadorMensagensPort {
	constructor(
		@Inject(CLIENTE_SQS) private readonly sqs: SQSClient,
		@Inject(CLIENTE_SNS) private readonly sns: SNSClient,
	) {}

	async enviarComando(fila: FilaComando, envelope: EnvelopeMensagem<unknown>): Promise<void> {
		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: urlDaFila(fila),
				MessageBody: JSON.stringify(envelope),
				MessageAttributes: montarAtributos(envelope),
			}),
		);
	}

	async publicarEvento(envelope: EnvelopeMensagem<unknown>): Promise<void> {
		const topico = process.env.SNS_EVENTOS_ARN;
		if (!topico) throw new Error("SNS_EVENTOS_ARN não definido");
		await this.sns.send(
			new PublishCommand({ TopicArn: topico, Message: JSON.stringify(envelope), MessageAttributes: montarAtributos(envelope) }),
		);
	}
}
