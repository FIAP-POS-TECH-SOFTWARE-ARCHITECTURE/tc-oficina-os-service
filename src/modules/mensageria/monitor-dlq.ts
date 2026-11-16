import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Inject, Injectable, Logger, type LoggerService, OnModuleInit, Optional } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import newrelic from "newrelic";
import { workersHabilitados } from "./configuracao-mensageria";
import { CLIENTE_SQS } from "./publicador-mensagens.port";

@Injectable()
export class MonitorDlq implements OnModuleInit {
	private readonly urls: string[];

	constructor(
		@Inject(CLIENTE_SQS) private readonly sqs: SQSClient,
		@Optional() urls: string = process.env.SQS_DLQ_URLS ?? "",
		@Optional() private readonly logger: LoggerService = new Logger(MonitorDlq.name),
	) {
		this.urls = urls
			.split(",")
			.map((u) => u.trim())
			.filter(Boolean);
	}

	onModuleInit(): void {
		if (this.urls.length === 0) this.logger.warn({ event: "mensageria.dlq_monitor_desligado" });
	}

	@Interval(60_000)
	async tick(): Promise<void> {
		if (workersHabilitados()) await this.verificar();
	}

	async verificar(): Promise<void> {
		for (const url of this.urls) {
			const fila = url.substring(url.lastIndexOf("/") + 1);
			try {
				const r = await this.sqs.send(
					new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["ApproximateNumberOfMessages"] }),
				);
				const mensagens = Number(r.Attributes?.ApproximateNumberOfMessages ?? 0);
				newrelic.recordMetric(`Custom/Mensageria/DLQ/${fila}`, mensagens);
				this.logger.log({ event: "mensageria.dlq_profundidade", fila, mensagens });
			} catch (error) {
				this.logger.error({ event: "mensageria.dlq_erro", fila, erro: (error as Error).message });
			}
		}
	}
}
