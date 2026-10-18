import { OsStatus } from "./os-status";

export type OsTransition =
	| "iniciar_diagnostico"
	| "bloquear_por_estoque"
	| "desbloquear"
	| "orcamento_gerado"
	| "orcamento_aprovado"
	| "pagamento_confirmado"
	| "finalizar"
	| "entregar"
	| "cancelar";

const TRANSITIONS: Record<OsTransition, { from: OsStatus[]; to: OsStatus }> = {
	iniciar_diagnostico: { from: [OsStatus.RECEBIDA], to: OsStatus.EM_DIAGNOSTICO },
	bloquear_por_estoque: { from: [OsStatus.EM_DIAGNOSTICO], to: OsStatus.BLOQUEADA },
	desbloquear: { from: [OsStatus.BLOQUEADA], to: OsStatus.EM_DIAGNOSTICO },
	orcamento_gerado: { from: [OsStatus.EM_DIAGNOSTICO], to: OsStatus.AGUARDANDO_APROVACAO },
	orcamento_aprovado: { from: [OsStatus.AGUARDANDO_APROVACAO], to: OsStatus.AGUARDANDO_PAGAMENTO },
	pagamento_confirmado: { from: [OsStatus.AGUARDANDO_PAGAMENTO], to: OsStatus.EM_EXECUCAO },
	finalizar: { from: [OsStatus.EM_EXECUCAO], to: OsStatus.FINALIZADA },
	entregar: { from: [OsStatus.FINALIZADA], to: OsStatus.ENTREGUE },
	// FINALIZADA fica de fora: reparo concluído e pago é o ponto sem volta do fluxo.
	cancelar: {
		from: [
			OsStatus.RECEBIDA,
			OsStatus.EM_DIAGNOSTICO,
			OsStatus.BLOQUEADA,
			OsStatus.AGUARDANDO_APROVACAO,
			OsStatus.AGUARDANDO_PAGAMENTO,
			OsStatus.EM_EXECUCAO,
		],
		to: OsStatus.CANCELADA,
	},
};

export function canTransition(from: OsStatus, transition: OsTransition): boolean {
	return TRANSITIONS[transition].from.includes(from);
}

export function nextStatus(transition: OsTransition): OsStatus {
	return TRANSITIONS[transition].to;
}

export function transitionsFrom(from: OsStatus): OsTransition[] {
	return (Object.entries(TRANSITIONS) as [OsTransition, { from: OsStatus[]; to: OsStatus }][])
		.filter(([, def]) => def.from.includes(from))
		.map(([t]) => t);
}
