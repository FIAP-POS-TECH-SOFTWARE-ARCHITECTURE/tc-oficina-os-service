import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { DestinoMensagem, workersHabilitados } from "./configuracao-mensageria";
import { EnvelopeMensagem } from "./envelope";
import { PUBLICADOR_MENSAGENS, type PublicadorMensagensPort } from "./publicador-mensagens.port";

interface LinhaReivindicada {
	id: string;
	message_id: string;
	destino: DestinoMensagem;
	corpo: EnvelopeMensagem<unknown>;
	tentativas: number;
}

@Injectable()
export class RelayOutbox {
	static readonly LOTE = 10;
	static readonly MAX_TENTATIVAS = 10;
	private readonly logger = new Logger(RelayOutbox.name);
	private emExecucao = false;

	constructor(
		private readonly prisma: PrismaService,
		@Inject(PUBLICADOR_MENSAGENS) private readonly publicador: PublicadorMensagensPort,
	) {}

	@Interval(1000)
	async tick(): Promise<void> {
		if (!workersHabilitados() || this.emExecucao) return;
		this.emExecucao = true;
		try {
			while ((await this.processarLote()) === RelayOutbox.LOTE);
		} catch (error) {
			this.logger.error({ event: "outbox.relay_erro", erro: (error as Error).message });
		} finally {
			this.emExecucao = false;
		}
	}

	async processarLote(): Promise<number> {
		// Claim atômico com lease de 30s: outra réplica pula as linhas travadas e só as vê de novo se este pod morrer.
		const linhas = await this.prisma.$queryRaw<LinhaReivindicada[]>`
			UPDATE outbox_mensagens SET proxima_tentativa_em = now() + interval '30 seconds'
			WHERE id IN (
				SELECT id FROM outbox_mensagens
				WHERE status = 'PENDENTE' AND proxima_tentativa_em <= now()
				ORDER BY created_at
				LIMIT ${RelayOutbox.LOTE}
				FOR UPDATE SKIP LOCKED
			)
			RETURNING id, message_id, destino, corpo, tentativas
		`;
		for (const linha of linhas) await this.publicar(linha);
		return linhas.length;
	}

	private async publicar(linha: LinhaReivindicada): Promise<void> {
		try {
			if (linha.destino === "eventos") await this.publicador.publicarEvento(linha.corpo);
			else await this.publicador.enviarComando(linha.destino, linha.corpo);
			await this.prisma.outboxMensagem.update({
				where: { id: linha.id },
				data: { status: "ENVIADA", enviadaEm: new Date(), ultimoErro: null },
			});
		} catch (error) {
			const tentativas = linha.tentativas + 1;
			const esgotou = tentativas >= RelayOutbox.MAX_TENTATIVAS;
			const espera = Math.min(2 ** tentativas, 60) * 1000;
			await this.prisma.outboxMensagem.update({
				where: { id: linha.id },
				data: {
					status: esgotou ? "FALHA" : "PENDENTE",
					tentativas,
					ultimoErro: (error as Error).message,
					proximaTentativaEm: new Date(Date.now() + espera),
				},
			});
			const log = {
				event: esgotou ? "outbox.falha_definitiva" : "outbox.falha_envio",
				messageId: linha.message_id,
				tentativas,
				erro: (error as Error).message,
			};
			this.logger.error(log);
		}
	}
}
