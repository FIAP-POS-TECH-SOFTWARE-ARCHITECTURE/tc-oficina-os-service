import { Inject, Injectable, Logger } from "@nestjs/common";
import { destinoDoTipo } from "../../mensageria/configuracao-mensageria";
import { criarEnvelope, EnvelopeMensagem } from "../../mensageria/envelope";
import {
	NOTIFICADOR,
	type NotificacaoMudancaStatus,
	type NotificadorPort,
} from "../../ordens-servico/application/ports/notificador.gateway";
import {
	COMANDOS_QUE_AGUARDAM_RESPOSTA,
	Decisao,
	decidir,
	ETAPAS_DIAGNOSTICO,
	EtapaFluxoOs,
	EventoFluxo,
	StatusFluxoOs,
	TipoComando,
} from "../domain/fluxo-ordem-servico";
import { PRAZOS_FLUXO, type PrazosFluxo, somarMinutos } from "../domain/prazos-fluxo";
import { paraEventoFluxo } from "./eventos-recebidos";
import {
	FluxoOrdemServico,
	ItemDiagnostico,
	MensagemDoFluxo,
	REPOSITORIO_FLUXO,
	type RepositorioFluxoPort,
	TransacaoFluxo,
} from "./ports/repositorio-fluxo.gateway";

export type ResultadoComandoFluxo =
	| { encontrado: false }
	| { encontrado: true; aplicado: boolean; motivo: string; fluxo: FluxoOrdemServico };

@Injectable()
export class OrquestradorOrdemServico {
	private readonly logger = new Logger(OrquestradorOrdemServico.name);

	constructor(
		@Inject(REPOSITORIO_FLUXO) private readonly repositorio: RepositorioFluxoPort,
		@Inject(NOTIFICADOR) private readonly notificador: NotificadorPort,
		@Inject(PRAZOS_FLUXO) private readonly prazos: PrazosFluxo,
	) {}

	abrirOs(dados: {
		numero: string;
		clienteId: string;
		veiculoId: string;
		correlationId: string;
	}): Promise<{ osId: string; fluxoId: string }> {
		return this.repositorio.emTransacao(async (tx) => {
			const fluxo = await tx.criarOsComFluxo({ ...dados, prazoExpiraEm: somarMinutos(new Date(), this.prazos.respostaServicoMin) });
			await this.enviar(tx, fluxo, ["SolicitarDiagnostico"], dados.correlationId);
			await tx.salvarFluxo(fluxo);
			this.logger.log({ event: "fluxo.iniciado", fluxoId: fluxo.id, osId: fluxo.osId });
			return { osId: fluxo.osId, fluxoId: fluxo.id };
		});
	}

	async processarEvento(envelope: EnvelopeMensagem): Promise<void> {
		const ids = { fluxoId: envelope.fluxoId, osId: envelope.osId, messageId: envelope.messageId, tipo: envelope.tipo };
		const notificacoes = await this.repositorio.emTransacao(async (tx) => {
			const fluxo = await tx.travarFluxo(envelope.fluxoId);
			if (!(await tx.registrarMensagemProcessada(envelope.messageId, envelope.tipo))) {
				this.logger.log({ event: "mensageria.duplicada", ...ids });
				return [];
			}
			if (!fluxo) {
				this.logger.warn({ event: "fluxo.desconhecido", ...ids });
				return [];
			}
			const evento = paraEventoFluxo(envelope);
			if (!evento) {
				this.logger.log({ event: "fluxo.evento_ignorado", motivo: "tipo não tratado pelo orquestrador", ...ids });
				return [];
			}
			if (
				evento.tipo === "DiagnosticoConcluido" &&
				fluxo.status === StatusFluxoOs.EM_ANDAMENTO &&
				ETAPAS_DIAGNOSTICO.includes(fluxo.etapa)
			) {
				const p = envelope.payload as { diagnostico: string; itens: ItemDiagnostico[] };
				evento.resultado = await tx.processarDiagnostico(fluxo.osId, p.diagnostico, p.itens);
			}
			return this.aplicar(
				tx,
				fluxo,
				decidir(fluxo, evento, new Date(), this.prazos),
				envelope.correlationId,
				null,
				envelope.messageId,
			);
		});
		await this.notificar(notificacoes);
	}

	cancelarPorStaff(osId: string, usuarioId: string, motivo: string): Promise<ResultadoComandoFluxo> {
		return this.executar(
			(tx) => tx.travarFluxoPorOs(osId),
			() => ({ tipo: "CancelamentoSolicitado", motivo }),
			usuarioId,
		);
	}

	async retomarBloqueada(osId: string, usuarioId: string | null): Promise<ResultadoComandoFluxo & { faltantes?: string[] }> {
		let faltantes: string[] = [];
		const resultado = await this.executar(
			(tx) => tx.travarFluxoPorOs(osId),
			async (tx, fluxo) => {
				if (fluxo.status !== StatusFluxoOs.EM_ANDAMENTO || fluxo.etapa !== EtapaFluxoOs.AGUARDANDO_ESTOQUE)
					return { tipo: "EstoqueRetomado", resultado: "SEM_ESTOQUE" };
				const reserva = await tx.reservarItensDaOs(osId);
				faltantes = reserva.faltantes;
				return { tipo: "EstoqueRetomado", resultado: reserva.reservado ? "RESERVADO" : "SEM_ESTOQUE" };
			},
			usuarioId,
		);
		return { ...resultado, faltantes };
	}

	reprocessar(fluxoId: string): Promise<ResultadoComandoFluxo> {
		return this.executar(
			(tx) => tx.travarFluxo(fluxoId),
			() => ({ tipo: "ReprocessamentoSolicitado" }),
			null,
		);
	}

	compensar(fluxoId: string, motivo: string): Promise<ResultadoComandoFluxo> {
		return this.executar(
			(tx) => tx.travarFluxo(fluxoId),
			() => ({ tipo: "CompensacaoSolicitada", motivo }),
			null,
		);
	}

	async verificarPrazos(agora: Date = new Date()): Promise<void> {
		for (const fluxoId of await this.repositorio.listarComPrazoVencido(agora, 50))
			await this.isolar(fluxoId, () =>
				this.executar(
					(tx) => tx.travarFluxo(fluxoId),
					() => ({ tipo: "PrazoExpirado" }),
					null,
					agora,
				),
			);
		for (const osId of await this.repositorio.listarAguardandoEstoque())
			await this.isolar(osId, () => this.retomarBloqueada(osId, null));
	}

	consultarPorOs(osId: string): Promise<{ fluxo: FluxoOrdemServico; mensagens: MensagemDoFluxo[] } | null> {
		return this.repositorio.consultarPorOs(osId);
	}

	private async executar(
		localizar: (tx: TransacaoFluxo) => Promise<FluxoOrdemServico | null>,
		montarEvento: (tx: TransacaoFluxo, fluxo: FluxoOrdemServico) => EventoFluxo | Promise<EventoFluxo>,
		usuarioId: string | null,
		agora: Date = new Date(),
	): Promise<ResultadoComandoFluxo> {
		const { resultado, notificacoes } = await this.repositorio.emTransacao(async (tx) => {
			const fluxo = await localizar(tx);
			if (!fluxo) return { resultado: { encontrado: false } as const, notificacoes: [] };
			const decisao = decidir(fluxo, await montarEvento(tx, fluxo), agora, this.prazos);
			const notificacoes = await this.aplicar(tx, fluxo, decisao, fluxo.correlationId, usuarioId, null);
			return { resultado: { encontrado: true as const, aplicado: decisao.aplicar, motivo: decisao.motivo, fluxo }, notificacoes };
		});
		await this.notificar(notificacoes);
		return resultado;
	}

	private async aplicar(
		tx: TransacaoFluxo,
		fluxo: FluxoOrdemServico,
		decisao: Decisao,
		correlationId: string,
		usuarioId: string | null,
		messageId: string | null,
	): Promise<NotificacaoMudancaStatus[]> {
		const ids = { fluxoId: fluxo.id, osId: fluxo.osId, messageId: messageId ?? undefined, motivo: decisao.motivo };
		if (decisao.alerta) this.logger.error({ event: decisao.alerta, ...ids });
		if (!decisao.aplicar) {
			this.logger.log({ event: "fluxo.evento_ignorado", ...ids });
			return [];
		}

		Object.assign(fluxo, decisao.estado);
		for (const acao of decisao.acoesLocais) {
			if (acao.tipo === "ESTORNAR_RESERVA")
				await tx.estornarReserva(fluxo.osId, `Estorno por compensação: ${fluxo.motivoCompensacao ?? decisao.motivo}`);
			else if (acao.tipo === "REGISTRAR_INICIO_REPARO") await tx.registrarInicioReparo(fluxo.osId, acao.em);
			else if (acao.tipo === "REGISTRAR_FIM_REPARO") await tx.registrarFimReparo(fluxo.osId, acao.em);
			else await this.reenviarComandoPendente(tx, fluxo);
		}
		const notificacao =
			decisao.transicoesOs.length > 0 ? await tx.transicionarOs(fluxo.osId, decisao.transicoesOs, decisao.motivo, usuarioId) : null;
		await this.enviar(tx, fluxo, decisao.comandos, correlationId);
		for (const tipo of decisao.eventos) {
			const payload =
				tipo === "FluxoCompensado"
					? { motivo: fluxo.motivoCompensacao ?? decisao.motivo, compensacoes: [...fluxo.compensacoesFeitas] }
					: {};
			await tx.enfileirar(
				"eventos",
				criarEnvelope({ tipo, fluxoId: fluxo.id, osId: fluxo.osId, numeroOs: fluxo.numeroOs, correlationId, payload }),
			);
		}
		await tx.salvarFluxo(fluxo);
		this.logger.log({ event: "fluxo.transicao", etapa: fluxo.etapa, status: fluxo.status, comandos: decisao.comandos, ...ids });
		return notificacao ? [notificacao] : [];
	}

	private async enviar(tx: TransacaoFluxo, fluxo: FluxoOrdemServico, comandos: TipoComando[], correlationId: string): Promise<void> {
		for (const tipo of comandos) {
			const payload = await tx.montarPayloadComando(tipo, fluxo, this.prazos);
			const envelope = criarEnvelope({ tipo, fluxoId: fluxo.id, osId: fluxo.osId, numeroOs: fluxo.numeroOs, correlationId, payload });
			await tx.enfileirar(destinoDoTipo(tipo), envelope);
			if (COMANDOS_QUE_AGUARDAM_RESPOSTA.includes(tipo)) fluxo.comandoPendenteMessageId = envelope.messageId;
		}
	}

	// messageId novo: o original pode ter sido processado com o evento de resposta perdido (regra 2 faz o participante reemitir).
	private async reenviarComandoPendente(tx: TransacaoFluxo, fluxo: FluxoOrdemServico): Promise<void> {
		const original = fluxo.comandoPendenteMessageId ? await tx.buscarMensagemEnfileirada(fluxo.comandoPendenteMessageId) : null;
		if (!original) throw new Error(`Fluxo ${fluxo.id} sem comando pendente para reenviar`);
		const { tipo, fluxoId, osId, numeroOs, correlationId, payload } = original;
		const novo = criarEnvelope({ tipo, fluxoId, osId, numeroOs, correlationId, payload });
		await tx.enfileirar(destinoDoTipo(tipo), novo);
		fluxo.comandoPendenteMessageId = novo.messageId;
	}

	private async notificar(notificacoes: NotificacaoMudancaStatus[]): Promise<void> {
		for (const n of notificacoes) {
			try {
				await this.notificador.notificarMudancaStatus(n);
			} catch (error) {
				this.logger.error({ event: "fluxo.notificacao_falhou", numeroOs: n.numeroOs, erro: (error as Error).message });
			}
		}
	}

	private async isolar(id: string, fn: () => Promise<unknown>): Promise<void> {
		try {
			await fn();
		} catch (error) {
			this.logger.error({ event: "fluxo.verificacao_falhou", id, erro: (error as Error).message });
		}
	}
}
