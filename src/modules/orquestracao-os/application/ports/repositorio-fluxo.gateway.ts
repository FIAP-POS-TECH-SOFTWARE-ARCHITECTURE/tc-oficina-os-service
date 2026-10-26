import { DestinoMensagem } from "../../../mensageria/configuracao-mensageria";
import { EnvelopeMensagem } from "../../../mensageria/envelope";
import { ResultadoReservaEstoque } from "../../../insumos/application/ports/reserva-estoque-os.gateway";
import { NotificacaoMudancaStatus } from "../../../ordens-servico/application/ports/notificador.gateway";
import { OsTransition } from "../../../ordens-servico/domain/fluxo-estados-os";
import { EstadoFluxo, ResultadoReserva, TipoComando } from "../../domain/fluxo-ordem-servico";
import { PrazosFluxo } from "../../domain/prazos-fluxo";

export const REPOSITORIO_FLUXO = Symbol("REPOSITORIO_FLUXO");

export interface FluxoOrdemServico extends EstadoFluxo {
	id: string;
	osId: string;
	numeroOs: string;
	correlationId: string;
	comandoPendenteMessageId: string | null;
}

export interface ItemDiagnostico {
	tipo: "SERVICO" | "INSUMO";
	referenciaId: string;
	quantidade: number;
}

export interface MensagemDoFluxo {
	messageId: string;
	tipo: string;
	destino: string;
	status: string;
	tentativas: number;
	createdAt: Date;
	enviadaEm: Date | null;
}

/** Operações disponíveis dentro da transação do orquestrador; todas usam a mesma transação do banco. */
export interface TransacaoFluxo {
	registrarMensagemProcessada(messageId: string, tipo: string): Promise<boolean>; // false = já processada
	travarFluxo(fluxoId: string): Promise<FluxoOrdemServico | null>;
	travarFluxoPorOs(osId: string): Promise<FluxoOrdemServico | null>;
	criarOsComFluxo(dados: {
		numero: string;
		clienteId: string;
		veiculoId: string;
		correlationId: string;
		prazoExpiraEm: Date;
	}): Promise<FluxoOrdemServico>;
	salvarFluxo(fluxo: FluxoOrdemServico): Promise<void>;
	processarDiagnostico(osId: string, diagnostico: string, itens: ItemDiagnostico[]): Promise<ResultadoReserva>;
	reservarItensDaOs(osId: string): Promise<ResultadoReservaEstoque>;
	estornarReserva(osId: string, motivo: string): Promise<void>;
	registrarInicioReparo(osId: string, em: Date): Promise<void>;
	registrarFimReparo(osId: string, em: Date): Promise<void>;
	transicionarOs(
		osId: string,
		transicoes: OsTransition[],
		observacao: string,
		usuarioId: string | null,
	): Promise<NotificacaoMudancaStatus | null>;
	montarPayloadComando(tipo: TipoComando, fluxo: FluxoOrdemServico, prazos: PrazosFluxo): Promise<Record<string, unknown>>;
	enfileirar(destino: DestinoMensagem, envelope: EnvelopeMensagem<unknown>): Promise<void>;
	buscarMensagemEnfileirada(messageId: string): Promise<EnvelopeMensagem | null>;
}

export interface RepositorioFluxoPort {
	emTransacao<T>(fn: (tx: TransacaoFluxo) => Promise<T>): Promise<T>;
	listarComPrazoVencido(agora: Date, limite: number): Promise<string[]>; // fluxoIds EM_ANDAMENTO/COMPENSANDO
	listarAguardandoEstoque(): Promise<string[]>; // osIds, todos (poucos por natureza)
	consultarPorOs(osId: string): Promise<{ fluxo: FluxoOrdemServico; mensagens: MensagemDoFluxo[] } | null>;
}
