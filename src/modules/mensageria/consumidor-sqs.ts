import { DeleteMessageCommand, Message, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { setTimeout as esperar } from "node:timers/promises";
import { EnvelopeMensagem, OrigemMensagem } from "./envelope";
import { CLIENTE_SQS } from "./publicador-mensagens.port";
import { ValidadorContratos } from "./validador-contratos";

export type ProcessadorMensagem = (envelope: EnvelopeMensagem) => Promise<void>;

@Injectable()
export class ConsumidorSqs {
	private readonly logger = new Logger(ConsumidorSqs.name);
	private ativo = false;
	private abortador = new AbortController();
	private laco: Promise<void> | null = null;
	esperaAposErroMs = 5_000; // ajustável em teste

	constructor(
		private readonly validador: ValidadorContratos,
		@Inject(CLIENTE_SQS) private readonly sqs: SQSClient,
	) {}

	iniciar(filaUrl: string, processar: ProcessadorMensagem, origensAceitas: OrigemMensagem[]): void {
		if (this.ativo) return;
		this.ativo = true;
		this.abortador = new AbortController();
		this.laco = this.executar(filaUrl, processar, origensAceitas);
		this.logger.log({ event: "mensageria.consumidor_iniciado", filaUrl });
	}

	async parar(): Promise<void> {
		this.ativo = false;
		this.abortador.abort();
		await this.laco;
		this.laco = null;
	}

	async processarLote(filaUrl: string, processar: ProcessadorMensagem, origensAceitas: OrigemMensagem[]): Promise<number> {
		const resposta = await this.sqs.send(
			new ReceiveMessageCommand({ QueueUrl: filaUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20, MessageAttributeNames: ["All"] }),
			{ abortSignal: this.abortador.signal },
		);
		const mensagens = resposta.Messages ?? [];
		for (const mensagem of mensagens) await this.tratar(filaUrl, mensagem, processar, origensAceitas);
		return mensagens.length;
	}

	private async executar(filaUrl: string, processar: ProcessadorMensagem, origensAceitas: OrigemMensagem[]): Promise<void> {
		while (this.ativo) {
			try {
				await this.processarLote(filaUrl, processar, origensAceitas);
			} catch (error) {
				if (!this.ativo) break;
				this.logger.error({ event: "mensageria.falha_recebimento", erro: (error as Error).message });
				await esperar(this.esperaAposErroMs, undefined, { signal: this.abortador.signal }).catch(() => undefined);
			}
		}
	}

	private async tratar(
		filaUrl: string,
		mensagem: Message,
		processar: ProcessadorMensagem,
		origensAceitas: OrigemMensagem[],
	): Promise<void> {
		let corpo: unknown;
		try {
			corpo = JSON.parse(mensagem.Body ?? "");
		} catch {
			corpo = undefined;
		}
		const validacao = this.validador.validar(corpo);
		if (!validacao.valido) {
			// Não apaga: após maxReceiveCount a mensagem vai para a DLQ e fica disponível para inspeção.
			this.logger.error({ event: "mensageria.mensagem_invalida", sqsMessageId: mensagem.MessageId, erros: validacao.erros });
			return;
		}
		const { envelope } = validacao;
		const ids = { fluxoId: envelope.fluxoId, osId: envelope.osId, messageId: envelope.messageId, tipo: envelope.tipo };
		if (!origensAceitas.includes(envelope.origem)) {
			this.logger.warn({ event: "mensageria.origem_ignorada", origem: envelope.origem, ...ids });
			await this.apagar(filaUrl, mensagem);
			return;
		}
		try {
			await processar(envelope);
			await this.apagar(filaUrl, mensagem);
		} catch (error) {
			this.logger.error({ event: "mensageria.falha_processamento", erro: (error as Error).message, ...ids });
		}
	}

	private async apagar(filaUrl: string, mensagem: Message): Promise<void> {
		await this.sqs.send(new DeleteMessageCommand({ QueueUrl: filaUrl, ReceiptHandle: mensagem.ReceiptHandle }));
	}
}
