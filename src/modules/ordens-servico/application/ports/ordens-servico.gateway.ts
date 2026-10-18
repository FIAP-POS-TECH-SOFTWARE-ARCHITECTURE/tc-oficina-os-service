import { OsStatus } from "../../domain/os-status";
import { HistoricoItemApp, OsChaveOrdenacao, OsDetalhe, OsResumo, TempoMedioServicoApp } from "./os-types";

export const ORDENS_SERVICO_GATEWAY = Symbol("ORDENS_SERVICO_GATEWAY");

export interface TransicaoPersistencia {
	id: string;
	statusAnterior: OsStatus;
	statusNovo: OsStatus;
	usuarioId?: string | null;
	observacao?: string | null;
	dadosExtras?: {
		aprovadoEm?: Date;
		iniciadoExecucaoEm?: Date;
		finalizadoEm?: Date;
		entregueEm?: Date;
		canceladoEm?: Date;
		valorTotal?: unknown;
	};
}

export interface OrdensServicoGatewayPort {
	criarComHistorico(dados: { numero: string; clienteId: string; veiculoId: string }): Promise<{ id: string }>;
	buscarPorId(id: string): Promise<OsResumo | null>;
	buscarDetalhePorId(id: string): Promise<OsDetalhe | null>;
	buscarPorNumero(numero: string): Promise<OsDetalhe | null>;
	listarParaOrdenacao(filtros: { status?: OsStatus; excluirStatus?: OsStatus[]; clienteId?: string }): Promise<OsChaveOrdenacao[]>;
	buscarDetalhesPorIds(ids: string[]): Promise<OsDetalhe[]>;
	listarHistorico(ordemServicoId: string): Promise<HistoricoItemApp[]>;
	contarPorAno(ano: number): Promise<number>;
	tempoMedioPorServico(filtro: "ativos" | "inativos" | "ambos"): Promise<TempoMedioServicoApp[]>;

	transicionarComHistorico(t: TransicaoPersistencia): Promise<void>;

	// Atômico: o estorno do saldo de estoque da OS e a mudança para CANCELADA
	// acontecem na mesma transação. false quando o status relido sob lock já não permite cancelar.
	executarCancelamento(os: OsDetalhe, usuarioId: string | null, motivo: string | null | undefined): Promise<boolean>;
}
