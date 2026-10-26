import { Inject, Injectable, Logger } from "@nestjs/common";
import {
	EtapaFluxoOs as PrismaEtapaFluxoOs,
	OsStatus as PrismaOsStatus,
	Prisma,
	StatusFluxoOs as PrismaStatusFluxoOs,
} from "@prisma/client";
import { decimalParaCentavos } from "../../../../common/utils/centavos";
import { PrismaService } from "../../../../prisma/prisma.service";
import {
	RESERVA_ESTOQUE_OS,
	type ReservaEstoqueOsPort,
	type ResultadoReservaEstoque,
} from "../../../insumos/application/ports/reserva-estoque-os.gateway";
import { DestinoMensagem } from "../../../mensageria/configuracao-mensageria";
import { EnvelopeMensagem } from "../../../mensageria/envelope";
import { NotificacaoMudancaStatus } from "../../../ordens-servico/application/ports/notificador.gateway";
import { registrarTransicaoOs } from "../../../ordens-servico/adapters/gateways/historico-os.prisma";
import { canTransition, nextStatus, OsTransition } from "../../../ordens-servico/domain/fluxo-estados-os";
import { OsStatus } from "../../../ordens-servico/domain/os-status";
import {
	ComandoCompensacao,
	Compensacao,
	EtapaFluxoOs,
	ResultadoReserva,
	StatusFluxoOs,
	TipoComando,
} from "../../domain/fluxo-ordem-servico";
import { PrazosFluxo, somarMinutos } from "../../domain/prazos-fluxo";
import {
	FluxoOrdemServico,
	ItemDiagnostico,
	MensagemDoFluxo,
	RepositorioFluxoPort,
	TransacaoFluxo,
} from "../../application/ports/repositorio-fluxo.gateway";

const FLUXO_INCLUDE = { ordemServico: { select: { numero: true } } } satisfies Prisma.FluxoOrdemServicoInclude;
type FluxoComNumero = Prisma.FluxoOrdemServicoGetPayload<{ include: typeof FLUXO_INCLUDE }>;

function paraFluxo(linha: FluxoComNumero): FluxoOrdemServico {
	return {
		id: linha.id,
		osId: linha.osId,
		numeroOs: linha.ordemServico.numero,
		correlationId: linha.correlationId,
		comandoPendenteMessageId: linha.comandoPendenteMessageId,
		etapa: linha.etapa as unknown as EtapaFluxoOs,
		status: linha.status as unknown as StatusFluxoOs,
		prazoExpiraEm: linha.prazoExpiraEm,
		prazoAprovacaoEm: linha.prazoAprovacaoEm,
		compensacoesPendentes: linha.compensacoesPendentes as ComandoCompensacao[],
		compensacoesFeitas: linha.compensacoesFeitas as Compensacao[],
		motivoCompensacao: linha.motivoCompensacao,
		pagamentoId: linha.pagamentoId,
		tentativas: linha.tentativas,
	};
}

/** Operações do orquestrador sobre uma única transação Prisma (regra 3: tudo ou nada). */
export class TransacaoFluxoPrisma implements TransacaoFluxo {
	constructor(
		private readonly tx: Prisma.TransactionClient,
		private readonly reserva: ReservaEstoqueOsPort,
		private readonly logger: Logger,
	) {}

	async registrarMensagemProcessada(messageId: string, tipo: string): Promise<boolean> {
		const { count } = await this.tx.mensagemProcessada.createMany({ data: [{ messageId, tipo }], skipDuplicates: true });
		return count === 1;
	}

	async travarFluxo(fluxoId: string): Promise<FluxoOrdemServico | null> {
		await this.tx.$queryRaw`SELECT id FROM fluxos_ordem_servico WHERE id = ${fluxoId}::uuid FOR UPDATE`;
		const linha = await this.tx.fluxoOrdemServico.findUnique({ where: { id: fluxoId }, include: FLUXO_INCLUDE });
		return linha ? paraFluxo(linha) : null;
	}

	async travarFluxoPorOs(osId: string): Promise<FluxoOrdemServico | null> {
		await this.tx.$queryRaw`SELECT id FROM fluxos_ordem_servico WHERE os_id = ${osId}::uuid FOR UPDATE`;
		const linha = await this.tx.fluxoOrdemServico.findUnique({ where: { osId }, include: FLUXO_INCLUDE });
		return linha ? paraFluxo(linha) : null;
	}

	async criarOsComFluxo(dados: {
		numero: string;
		clienteId: string;
		veiculoId: string;
		correlationId: string;
		prazoExpiraEm: Date;
	}): Promise<FluxoOrdemServico> {
		const os = await this.tx.ordemServico.create({
			data: { numero: dados.numero, clienteId: dados.clienteId, veiculoId: dados.veiculoId },
		});
		await this.tx.osHistoricoStatus.create({
			data: {
				ordemServicoId: os.id,
				statusAnterior: null,
				statusNovo: PrismaOsStatus.RECEBIDA,
				observacao: "Ordem de serviço criada",
			},
		});
		const linha = await this.tx.fluxoOrdemServico.create({
			data: {
				osId: os.id,
				etapa: PrismaEtapaFluxoOs.AGUARDANDO_ACK_DIAGNOSTICO,
				correlationId: dados.correlationId,
				prazoExpiraEm: dados.prazoExpiraEm,
			},
			include: FLUXO_INCLUDE,
		});
		return paraFluxo(linha);
	}

	async salvarFluxo(fluxo: FluxoOrdemServico): Promise<void> {
		await this.tx.fluxoOrdemServico.update({
			where: { id: fluxo.id },
			data: {
				etapa: fluxo.etapa,
				status: fluxo.status,
				prazoExpiraEm: fluxo.prazoExpiraEm,
				prazoAprovacaoEm: fluxo.prazoAprovacaoEm,
				compensacoesPendentes: fluxo.compensacoesPendentes,
				compensacoesFeitas: fluxo.compensacoesFeitas,
				motivoCompensacao: fluxo.motivoCompensacao,
				pagamentoId: fluxo.pagamentoId,
				tentativas: fluxo.tentativas,
				comandoPendenteMessageId: fluxo.comandoPendenteMessageId,
			},
		});
	}

	async processarDiagnostico(osId: string, diagnostico: string, itens: ItemDiagnostico[]): Promise<ResultadoReserva> {
		const idsServico = itens.filter((i) => i.tipo === "SERVICO").map((i) => i.referenciaId);
		const idsInsumo = itens.filter((i) => i.tipo === "INSUMO").map((i) => i.referenciaId);
		if (idsServico.length === 0) return "ITENS_INVALIDOS";

		const servicos = new Map(
			(await this.tx.servico.findMany({ where: { id: { in: idsServico }, ativo: true } })).map((s) => [s.id, s]),
		);
		const insumos = new Map((await this.tx.insumo.findMany({ where: { id: { in: idsInsumo }, ativo: true } })).map((i) => [i.id, i]));
		const catalogo = (i: ItemDiagnostico) => (i.tipo === "SERVICO" ? servicos.get(i.referenciaId) : insumos.get(i.referenciaId));
		if (itens.some((i) => !catalogo(i))) return "ITENS_INVALIDOS";

		let total = new Prisma.Decimal(0);
		const precificados = itens.map((i) => {
			const preco = i.tipo === "SERVICO" ? servicos.get(i.referenciaId)!.preco : insumos.get(i.referenciaId)!.precoUnitario;
			const subtotal = preco.mul(i.quantidade);
			total = total.add(subtotal);
			return { ...i, preco, subtotal };
		});
		if (total.isZero()) return "ITENS_INVALIDOS";

		for (const i of precificados) {
			if (i.tipo === "SERVICO")
				await this.tx.osItemServico.create({
					data: {
						ordemServicoId: osId,
						servicoId: i.referenciaId,
						precoUnitario: i.preco,
						quantidade: i.quantidade,
						subtotal: i.subtotal,
					},
				});
			else
				await this.tx.osItemInsumo.create({
					data: {
						ordemServicoId: osId,
						insumoId: i.referenciaId,
						precoUnitario: i.preco,
						quantidade: i.quantidade,
						subtotal: i.subtotal,
					},
				});
		}
		await this.tx.ordemServico.update({ where: { id: osId }, data: { diagnostico, valorTotal: total } });

		const reserva = await this.reserva.reservar(
			{
				ordemServicoId: osId,
				itens: precificados.filter((i) => i.tipo === "INSUMO").map((i) => ({ insumoId: i.referenciaId, quantidade: i.quantidade })),
				motivo: "Reserva para a OS após diagnóstico",
				usuarioId: null,
			},
			this.tx,
		);
		return reserva.reservado ? "RESERVADO" : "SEM_ESTOQUE";
	}

	async reservarItensDaOs(osId: string): Promise<ResultadoReservaEstoque> {
		const itens = await this.tx.osItemInsumo.findMany({ where: { ordemServicoId: osId } });
		return this.reserva.reservar(
			{
				ordemServicoId: osId,
				itens: itens.map((i) => ({ insumoId: i.insumoId, quantidade: i.quantidade })),
				motivo: "Reserva para a OS após desbloqueio",
				usuarioId: null,
			},
			this.tx,
		);
	}

	async estornarReserva(osId: string, motivo: string): Promise<void> {
		await this.reserva.estornar({ ordemServicoId: osId, motivo, usuarioId: null }, this.tx);
	}

	async registrarInicioReparo(osId: string, em: Date): Promise<void> {
		await this.tx.osItemServico.updateMany({
			where: { ordemServicoId: osId, status: "PENDENTE" },
			data: { status: "EM_EXECUCAO", iniciadoExecucaoEm: em },
		});
		await this.tx.ordemServico.updateMany({ where: { id: osId, iniciadoExecucaoEm: null }, data: { iniciadoExecucaoEm: em } });
	}

	async registrarFimReparo(osId: string, em: Date): Promise<void> {
		await this.tx
			.$executeRaw`UPDATE os_itens_servico SET status = 'CONCLUIDO', iniciado_execucao_em = COALESCE(iniciado_execucao_em, ${em}), finalizado_execucao_em = ${em}, updated_at = now() WHERE ordem_servico_id = ${osId}::uuid AND status IN ('PENDENTE', 'EM_EXECUCAO')`;
		await this.tx.ordemServico.updateMany({ where: { id: osId, iniciadoExecucaoEm: null }, data: { iniciadoExecucaoEm: em } });
	}

	async transicionarOs(
		osId: string,
		transicoes: OsTransition[],
		observacao: string,
		usuarioId: string | null,
	): Promise<NotificacaoMudancaStatus | null> {
		const os = await this.tx.ordemServico.findUniqueOrThrow({ where: { id: osId }, include: { cliente: true } });
		const inicial = os.status as unknown as OsStatus;
		let atual = inicial;
		for (const transicao of transicoes) {
			if (!canTransition(atual, transicao)) {
				this.logger.warn({ event: "fluxo.transicao_os_ignorada", osId, status: atual, transicao });
				continue;
			}
			const novo = nextStatus(transicao);
			const agora = new Date();
			await this.tx.ordemServico.update({
				where: { id: osId },
				data: {
					status: novo,
					...(transicao === "orcamento_aprovado" ? { aprovadoEm: agora } : {}),
					...(transicao === "finalizar" ? { finalizadoEm: agora } : {}),
					...(transicao === "cancelar" ? { canceladoEm: agora } : {}),
				},
			});
			await registrarTransicaoOs(this.tx, this.logger, {
				ordemServicoId: osId,
				numero: os.numero,
				statusAnterior: atual,
				statusNovo: novo,
				usuarioId: usuarioId ?? undefined,
				observacao,
			});
			atual = novo;
		}
		if (atual === inicial) return null;
		return {
			numeroOs: os.numero,
			statusAnterior: inicial,
			statusNovo: atual,
			nomeCliente: os.cliente.nome,
			emailCliente: os.cliente.email,
			observacao,
		};
	}

	async montarPayloadComando(tipo: TipoComando, fluxo: FluxoOrdemServico, prazos: PrazosFluxo): Promise<Record<string, unknown>> {
		if (tipo === "CancelarExecucao" || tipo === "CancelarOrcamento" || tipo === "EstornarPagamento")
			return { motivo: (fluxo.motivoCompensacao ?? "Cancelamento do fluxo da OS").slice(0, 2000) };

		const os = await this.tx.ordemServico.findUniqueOrThrow({
			where: { id: fluxo.osId },
			include: {
				cliente: true,
				veiculo: true,
				itensServico: { include: { servico: true } },
				itensInsumo: { include: { insumo: true } },
			},
		});
		if (tipo === "SolicitarDiagnostico")
			return {
				cliente: { id: os.cliente.id, nome: os.cliente.nome },
				veiculo: {
					id: os.veiculo.id,
					placa: os.veiculo.placa,
					marca: os.veiculo.marca,
					modelo: os.veiculo.modelo,
					ano: os.veiculo.ano,
				},
				observacoesAtendimento: null,
			};
		if (tipo === "IniciarReparo")
			return {
				itensServico: os.itensServico
					.filter((i) => i.status !== "CANCELADO")
					.map((i) => ({
						itemId: i.id,
						servicoId: i.servicoId,
						nome: i.servico.nome,
						quantidade: i.quantidade,
						tempoEstimadoMin: i.servico.tempoEstimadoMin,
					})),
				itensInsumo: os.itensInsumo.map((i) => ({ insumoId: i.insumoId, nome: i.insumo.nome, quantidade: i.quantidade })),
			};

		// GerarOrcamento: snapshot com preços gravados no diagnóstico, em centavos inteiros.
		const itens = [
			...os.itensServico.map((i) => ({
				tipo: "SERVICO",
				referenciaId: i.servicoId,
				descricao: i.servico.nome,
				quantidade: i.quantidade,
				precoUnitarioCentavos: decimalParaCentavos(i.precoUnitario),
			})),
			...os.itensInsumo.map((i) => ({
				tipo: "INSUMO",
				referenciaId: i.insumoId,
				descricao: i.insumo.nome,
				quantidade: i.quantidade,
				precoUnitarioCentavos: decimalParaCentavos(i.precoUnitario),
			})),
		];
		return {
			cliente: { id: os.cliente.id, nome: os.cliente.nome, email: os.cliente.email, documento: os.cliente.documento },
			veiculo: { placa: os.veiculo.placa, marca: os.veiculo.marca, modelo: os.veiculo.modelo },
			itens,
			valorTotalCentavos: itens.reduce((soma, i) => soma + i.quantidade * i.precoUnitarioCentavos, 0),
			prazoAprovacaoEm: (fluxo.prazoAprovacaoEm ?? somarMinutos(new Date(), prazos.aprovacaoMin)).toISOString(),
			prazoPagamentoMinutos: prazos.pagamentoMin,
		};
	}

	async enfileirar(destino: DestinoMensagem, envelope: EnvelopeMensagem<unknown>): Promise<void> {
		await this.tx.outboxMensagem.create({
			data: {
				messageId: envelope.messageId,
				fluxoId: envelope.fluxoId,
				tipo: envelope.tipo,
				destino,
				corpo: envelope as unknown as Prisma.InputJsonValue,
			},
		});
	}

	async buscarMensagemEnfileirada(messageId: string): Promise<EnvelopeMensagem | null> {
		const linha = await this.tx.outboxMensagem.findUnique({ where: { messageId } });
		return (linha?.corpo as unknown as EnvelopeMensagem | undefined) ?? null;
	}
}

@Injectable()
export class FluxoOrdemServicoPrismaGateway implements RepositorioFluxoPort {
	private readonly logger = new Logger(FluxoOrdemServicoPrismaGateway.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(RESERVA_ESTOQUE_OS) private readonly reserva: ReservaEstoqueOsPort,
	) {}

	emTransacao<T>(fn: (tx: TransacaoFluxo) => Promise<T>): Promise<T> {
		return this.prisma.$transaction((tx) => fn(new TransacaoFluxoPrisma(tx, this.reserva, this.logger)), { timeout: 15_000 });
	}

	async listarComPrazoVencido(agora: Date, limite: number): Promise<string[]> {
		const linhas = await this.prisma.fluxoOrdemServico.findMany({
			where: { status: { in: [PrismaStatusFluxoOs.EM_ANDAMENTO, PrismaStatusFluxoOs.COMPENSANDO] }, prazoExpiraEm: { lte: agora } },
			orderBy: { prazoExpiraEm: "asc" },
			take: limite,
			select: { id: true },
		});
		return linhas.map((l) => l.id);
	}

	// Sem limite: retentativa sem estoque não altera o fluxo; com limite, os mesmos N seriam tentados sempre.
	async listarAguardandoEstoque(): Promise<string[]> {
		const linhas = await this.prisma.fluxoOrdemServico.findMany({
			where: { status: PrismaStatusFluxoOs.EM_ANDAMENTO, etapa: PrismaEtapaFluxoOs.AGUARDANDO_ESTOQUE },
			select: { osId: true },
		});
		return linhas.map((l) => l.osId);
	}

	async consultarPorOs(osId: string): Promise<{ fluxo: FluxoOrdemServico; mensagens: MensagemDoFluxo[] } | null> {
		const linha = await this.prisma.fluxoOrdemServico.findUnique({ where: { osId }, include: FLUXO_INCLUDE });
		if (!linha) return null;
		const mensagens = await this.prisma.outboxMensagem.findMany({ where: { fluxoId: linha.id }, orderBy: { createdAt: "asc" } });
		return {
			fluxo: paraFluxo(linha),
			mensagens: mensagens.map((m) => ({
				messageId: m.messageId,
				tipo: m.tipo,
				destino: m.destino,
				status: m.status,
				tentativas: m.tentativas,
				createdAt: m.createdAt,
				enviadaEm: m.enviadaEm,
			})),
		};
	}
}
