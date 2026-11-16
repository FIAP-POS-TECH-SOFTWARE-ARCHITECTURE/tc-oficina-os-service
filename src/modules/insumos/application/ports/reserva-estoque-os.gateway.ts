export const RESERVA_ESTOQUE_OS = Symbol("RESERVA_ESTOQUE_OS");

// Transação do chamador, opaca para a aplicação (mesmo padrão dos valores Decimal tipados como unknown).
export type ContextoTransacao = unknown;

export interface ItemReservaEstoque {
	insumoId: string;
	quantidade: number;
}

export interface ResultadoReservaEstoque {
	reservado: boolean;
	faltantes: string[];
}

export interface ReservaEstoqueOsPort {
	/** Tudo ou nada. Idempotente: se a OS já tem saldo reservado, não reserva de novo e devolve reservado=true. */
	reservar(
		params: { ordemServicoId: string; itens: ItemReservaEstoque[]; motivo: string; usuarioId: string | null },
		contexto?: ContextoTransacao,
	): Promise<ResultadoReservaEstoque>;
	/** Devolve o saldo líquido (SAIDA − ESTORNO) de cada insumo da OS. Idempotente: a segunda chamada estorna 0 insumos. */
	estornar(
		params: { ordemServicoId: string; motivo: string; usuarioId: string | null },
		contexto?: ContextoTransacao,
	): Promise<{ insumosEstornados: number }>;
}
