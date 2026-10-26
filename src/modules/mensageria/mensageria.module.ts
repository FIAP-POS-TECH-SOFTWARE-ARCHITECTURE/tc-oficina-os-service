import { Module } from "@nestjs/common";
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import { CLIENTE_SNS, CLIENTE_SQS, PUBLICADOR_MENSAGENS } from "./publicador-mensagens.port";
import { ConsumidorSqs } from "./consumidor-sqs";
import { RelayOutbox } from "./relay-outbox";
import { SnsSqsPublicador } from "./sns-sqs-publicador";
import { ValidadorContratos } from "./validador-contratos";

@Module({
	providers: [
		ValidadorContratos,
		{ provide: CLIENTE_SQS, useFactory: () => new SQSClient({}) },
		{ provide: CLIENTE_SNS, useFactory: () => new SNSClient({}) },
		{ provide: PUBLICADOR_MENSAGENS, useClass: SnsSqsPublicador },
		RelayOutbox,
		ConsumidorSqs,
	],
	exports: [ValidadorContratos, CLIENTE_SQS, CLIENTE_SNS, PUBLICADOR_MENSAGENS, RelayOutbox, ConsumidorSqs],
})
export class MensageriaModule {}
