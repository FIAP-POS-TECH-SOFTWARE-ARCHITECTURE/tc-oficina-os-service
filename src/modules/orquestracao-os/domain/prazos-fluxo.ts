export interface PrazosFluxo {
	aprovacaoMin: number;
	pagamentoMin: number;
	respostaServicoMin: number;
}

export const PRAZOS_FLUXO = Symbol("PRAZOS_FLUXO");

function minutos(env: NodeJS.ProcessEnv, nome: string, padrao: number): number {
	const bruto = env[nome];
	if (bruto === undefined) return padrao;
	if (!/^\d+$/.test(bruto) || Number(bruto) <= 0) throw new Error(`${nome} deve ser um inteiro de minutos maior que zero`);
	return Number(bruto);
}

export function lerPrazos(env: NodeJS.ProcessEnv): PrazosFluxo {
	return {
		aprovacaoMin: minutos(env, "PRAZO_APROVACAO", 4320),
		pagamentoMin: minutos(env, "PRAZO_PAGAMENTO", 2880),
		respostaServicoMin: minutos(env, "PRAZO_RESPOSTA_SERVICO", 10),
	};
}

export function somarMinutos(data: Date, minutos: number): Date {
	return new Date(data.getTime() + minutos * 60_000);
}
