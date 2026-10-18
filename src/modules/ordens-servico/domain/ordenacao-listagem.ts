import { OsStatus } from "./os-status";

export const PRIORIDADE_LISTAGEM: OsStatus[] = [
	OsStatus.EM_EXECUCAO,
	OsStatus.AGUARDANDO_PAGAMENTO,
	OsStatus.AGUARDANDO_APROVACAO,
	OsStatus.EM_DIAGNOSTICO,
	OsStatus.RECEBIDA,
	OsStatus.BLOQUEADA,
	OsStatus.CANCELADA,
];

export const STATUS_OCULTOS_LISTAGEM: OsStatus[] = [OsStatus.FINALIZADA, OsStatus.ENTREGUE];

function prioridadeDe(status: OsStatus): number {
	const indice = PRIORIDADE_LISTAGEM.indexOf(status);
	return indice === -1 ? PRIORIDADE_LISTAGEM.length : indice;
}

export function compararParaListagem(a: { status: OsStatus; createdAt: Date }, b: { status: OsStatus; createdAt: Date }): number {
	const prioridade = prioridadeDe(a.status) - prioridadeDe(b.status);
	if (prioridade !== 0) return prioridade;
	return a.createdAt.getTime() - b.createdAt.getTime();
}
