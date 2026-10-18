import { Inject, Injectable, Logger } from "@nestjs/common";
import { OsStatus as PrismaOsStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../../../prisma/prisma.service";
import { RESERVA_ESTOQUE_OS, type ReservaEstoqueOsPort } from "../../../insumos/application/ports/reserva-estoque-os.gateway";
import { OsStatus } from "../../domain/os-status";
import { OrdensServicoGatewayPort, TransicaoPersistencia } from "../../application/ports/ordens-servico.gateway";
import { HistoricoItemApp, OsChaveOrdenacao, OsDetalhe, OsResumo, TempoMedioServicoApp } from "../../application/ports/os-types";
import { registrarTransicaoOs } from "./historico-os.prisma";

const OS_INCLUDE = {
	cliente: true,
	veiculo: true,
	itensServico: { include: { servico: true } },
	itensInsumo: { include: { insumo: true } },
	historico: { orderBy: { createdAt: "asc" } as const },
} satisfies Prisma.OrdemServicoInclude;

@Injectable()
export class OrdensServicoPrismaGateway implements OrdensServicoGatewayPort {
	private readonly logger = new Logger(OrdensServicoPrismaGateway.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(RESERVA_ESTOQUE_OS) private readonly reservaEstoque: ReservaEstoqueOsPort,
	) {}

	async criarComHistorico(dados: { numero: string; clienteId: string; veiculoId: string }): Promise<{ id: string }> {
		return this.prisma.$transaction(async (tx) => {
			const os = await tx.ordemServico.create({
				data: { numero: dados.numero, clienteId: dados.clienteId, veiculoId: dados.veiculoId },
			});
			await tx.osHistoricoStatus.create({
				data: {
					ordemServicoId: os.id,
					statusAnterior: null,
					statusNovo: PrismaOsStatus.RECEBIDA,
					observacao: "Ordem de serviço criada",
				},
			});
			return { id: os.id };
		});
	}

	async buscarPorId(id: string): Promise<OsResumo | null> {
		const os = await this.prisma.ordemServico.findUnique({ where: { id } });
		return os as unknown as OsResumo | null;
	}

	async buscarDetalhePorId(id: string): Promise<OsDetalhe | null> {
		const os = await this.prisma.ordemServico.findUnique({
			where: { id },
			include: OS_INCLUDE,
		});
		return os as unknown as OsDetalhe | null;
	}

	async buscarPorNumero(numero: string): Promise<OsDetalhe | null> {
		const os = await this.prisma.ordemServico.findUnique({
			where: { numero },
			include: OS_INCLUDE,
		});
		return os as unknown as OsDetalhe | null;
	}

	async listarParaOrdenacao(filtros: {
		status?: OsStatus;
		excluirStatus?: OsStatus[];
		clienteId?: string;
	}): Promise<OsChaveOrdenacao[]> {
		const where: Prisma.OrdemServicoWhereInput = {};
		if (filtros.status) where.status = filtros.status;
		else if (filtros.excluirStatus?.length) where.status = { notIn: filtros.excluirStatus as unknown as PrismaOsStatus[] };
		if (filtros.clienteId) where.clienteId = filtros.clienteId;
		const items = await this.prisma.ordemServico.findMany({ where, select: { id: true, status: true, createdAt: true } });
		return items as unknown as OsChaveOrdenacao[];
	}

	async buscarDetalhesPorIds(ids: string[]): Promise<OsDetalhe[]> {
		if (!ids.length) return [];
		const items = await this.prisma.ordemServico.findMany({ where: { id: { in: ids } }, include: OS_INCLUDE });
		return items as unknown as OsDetalhe[];
	}

	async listarHistorico(ordemServicoId: string): Promise<HistoricoItemApp[]> {
		const historico = await this.prisma.osHistoricoStatus.findMany({
			where: { ordemServicoId },
			include: { usuario: true },
			orderBy: { createdAt: "asc" },
		});
		return historico as unknown as HistoricoItemApp[];
	}

	contarPorAno(ano: number): Promise<number> {
		return this.prisma.ordemServico.count({
			where: {
				createdAt: {
					gte: new Date(`${ano}-01-01T00:00:00Z`),
					lt: new Date(`${ano + 1}-01-01T00:00:00Z`),
				},
			},
		});
	}

	tempoMedioPorServico(filtro: "ativos" | "inativos" | "ambos"): Promise<TempoMedioServicoApp[]> {
		const condicao =
			filtro === "ativos"
				? Prisma.sql`WHERE s.ativo = true`
				: filtro === "inativos"
					? Prisma.sql`WHERE s.ativo = false`
					: Prisma.sql``;

		return this.prisma.$queryRaw<TempoMedioServicoApp[]>`
			SELECT
				s.id AS servico_id,
				s.nome,
				s.ativo,
				AVG(EXTRACT(EPOCH FROM (ois.finalizado_execucao_em - ois.iniciado_execucao_em)) / 60)::float AS tempo_medio_min,
				COUNT(ois.id)::int AS total_execucoes
			FROM servicos s
			LEFT JOIN os_itens_servico ois
				ON ois.servico_id = s.id
				AND ois.status = 'CONCLUIDO'
				AND ois.finalizado_execucao_em IS NOT NULL
				AND ois.iniciado_execucao_em IS NOT NULL
			${condicao}
			GROUP BY s.id, s.nome, s.ativo
			ORDER BY s.nome ASC
		`;
	}

	async transicionarComHistorico(t: TransicaoPersistencia): Promise<void> {
		const extras = (t.dadosExtras ?? {}) as Prisma.OrdemServicoUpdateInput;
		await this.prisma.$transaction(async (tx) => {
			await tx.ordemServico.update({
				where: { id: t.id },
				data: { ...extras, status: t.statusNovo },
			});
			await registrarTransicaoOs(tx, this.logger, {
				ordemServicoId: t.id,
				statusAnterior: t.statusAnterior,
				statusNovo: t.statusNovo,
				usuarioId: t.usuarioId ?? undefined,
				observacao: t.observacao ?? undefined,
			});
		});
	}

	async executarCancelamento(os: OsDetalhe, usuarioId: string | null, motivo: string | null | undefined): Promise<void> {
		await this.prisma.$transaction(async (tx) => {
			await this.reservaEstoque.estornar({ ordemServicoId: os.id, motivo: "Estorno por cancelamento de OS", usuarioId }, tx);
			await tx.ordemServico.update({ where: { id: os.id }, data: { status: PrismaOsStatus.CANCELADA, canceladoEm: new Date() } });
			await registrarTransicaoOs(tx, this.logger, {
				ordemServicoId: os.id,
				numero: os.numero,
				statusAnterior: os.status,
				statusNovo: PrismaOsStatus.CANCELADA,
				observacao: motivo ?? "OS cancelada",
				usuarioId: usuarioId ?? undefined,
			});
		});
	}
}
