import { OsTransition } from "../../ordens-servico/domain/fluxo-estados-os";
import { PrazosFluxo, somarMinutos } from "./prazos-fluxo";

export enum EtapaFluxoOs {
	AGUARDANDO_ACK_DIAGNOSTICO = "AGUARDANDO_ACK_DIAGNOSTICO",
	AGUARDANDO_DIAGNOSTICO = "AGUARDANDO_DIAGNOSTICO",
	DIAGNOSTICO_EM_ANDAMENTO = "DIAGNOSTICO_EM_ANDAMENTO",
	AGUARDANDO_ESTOQUE = "AGUARDANDO_ESTOQUE",
	AGUARDANDO_ORCAMENTO = "AGUARDANDO_ORCAMENTO",
	AGUARDANDO_APROVACAO = "AGUARDANDO_APROVACAO",
	AGUARDANDO_PAGAMENTO = "AGUARDANDO_PAGAMENTO",
	AGUARDANDO_ACK_REPARO = "AGUARDANDO_ACK_REPARO",
	AGUARDANDO_REPARO = "AGUARDANDO_REPARO",
	REPARO_EM_ANDAMENTO = "REPARO_EM_ANDAMENTO",
	FINALIZADO = "FINALIZADO",
}

export enum StatusFluxoOs {
	EM_ANDAMENTO = "EM_ANDAMENTO",
	COMPENSANDO = "COMPENSANDO",
	CONCLUIDO = "CONCLUIDO",
	COMPENSADO = "COMPENSADO",
	FALHA_TECNICA = "FALHA_TECNICA",
}

export type TipoComando =
	| "SolicitarDiagnostico"
	| "IniciarReparo"
	| "CancelarExecucao"
	| "GerarOrcamento"
	| "CancelarOrcamento"
	| "EstornarPagamento";
export type ComandoCompensacao = "CancelarExecucao" | "EstornarPagamento" | "CancelarOrcamento";
export type Compensacao = ComandoCompensacao | "EstornarReservaEstoque";
export type EventoInformativo = "FluxoConcluido" | "FluxoCompensado";
export type ResultadoReserva = "RESERVADO" | "SEM_ESTOQUE" | "ITENS_INVALIDOS";

export interface EstadoFluxo {
	etapa: EtapaFluxoOs;
	status: StatusFluxoOs;
	prazoExpiraEm: Date | null;
	prazoAprovacaoEm: Date | null;
	compensacoesPendentes: ComandoCompensacao[];
	compensacoesFeitas: Compensacao[];
	motivoCompensacao: string | null;
	pagamentoId: string | null;
	tentativas: number;
}

export type EventoFluxo =
	| { tipo: "ExecucaoEnfileirada"; etapa: "DIAGNOSTICO" | "REPARO" }
	| { tipo: "DiagnosticoIniciado" }
	| { tipo: "DiagnosticoConcluido"; resultado: ResultadoReserva | null } // null = aplicação não processou (guarda falhou)
	| { tipo: "DiagnosticoRejeitado"; motivo: string }
	| { tipo: "ReparoIniciado"; em: Date }
	| { tipo: "ReparoConcluido"; em: Date }
	| { tipo: "ReparoInviavel"; motivo: string }
	| { tipo: "ExecucaoCancelada" }
	| { tipo: "OrcamentoGerado" }
	| { tipo: "FalhaGerarOrcamento"; motivo: string }
	| { tipo: "OrcamentoAprovado"; prazoPagamentoEm: Date }
	| { tipo: "OrcamentoRejeitado"; motivo: string | null }
	| { tipo: "OrcamentoCancelado" }
	| { tipo: "PagamentoConfirmado"; pagamentoId: string }
	| { tipo: "PagamentoEstornado" }
	| { tipo: "EstornoFalhou"; proximaTentativaEm: Date }
	| { tipo: "PrazoExpirado" }
	| { tipo: "EstoqueRetomado"; resultado: ResultadoReserva }
	| { tipo: "CancelamentoSolicitado"; motivo: string }
	| { tipo: "ReprocessamentoSolicitado" }
	| { tipo: "CompensacaoSolicitada"; motivo: string };

export type AcaoLocal =
	| { tipo: "ESTORNAR_RESERVA" }
	| { tipo: "REGISTRAR_INICIO_REPARO"; em: Date }
	| { tipo: "REGISTRAR_FIM_REPARO"; em: Date }
	| { tipo: "REENVIAR_COMANDO_PENDENTE" };

export interface Decisao {
	aplicar: boolean; // false = ignorado (estado inalterado; só loga)
	motivo: string;
	estado: EstadoFluxo;
	transicoesOs: OsTransition[]; // aplicadas em ordem pela aplicação
	comandos: TipoComando[];
	acoesLocais: AcaoLocal[];
	eventos: EventoInformativo[];
	alerta: string | null; // evento de log de erro usado pelos alertas de observabilidade
}

export const COMANDOS_QUE_AGUARDAM_RESPOSTA: readonly TipoComando[] = ["SolicitarDiagnostico", "GerarOrcamento", "IniciarReparo"];
export const ETAPAS_DIAGNOSTICO: readonly EtapaFluxoOs[] = [
	EtapaFluxoOs.AGUARDANDO_ACK_DIAGNOSTICO,
	EtapaFluxoOs.AGUARDANDO_DIAGNOSTICO,
	EtapaFluxoOs.DIAGNOSTICO_EM_ANDAMENTO,
];
const ETAPAS_ORCAMENTO: readonly EtapaFluxoOs[] = [
	EtapaFluxoOs.AGUARDANDO_ORCAMENTO,
	EtapaFluxoOs.AGUARDANDO_APROVACAO,
	EtapaFluxoOs.AGUARDANDO_PAGAMENTO,
];
const ETAPAS_REPARO: readonly EtapaFluxoOs[] = [
	EtapaFluxoOs.AGUARDANDO_ACK_REPARO,
	EtapaFluxoOs.AGUARDANDO_REPARO,
	EtapaFluxoOs.REPARO_EM_ANDAMENTO,
];
const ETAPAS_ANTES_DA_APROVACAO: readonly EtapaFluxoOs[] = [
	...ETAPAS_DIAGNOSTICO,
	EtapaFluxoOs.AGUARDANDO_ESTOQUE,
	EtapaFluxoOs.AGUARDANDO_ORCAMENTO,
];
const EVENTOS_QUE_RETOMAM_FALHA_TECNICA = ["ExecucaoEnfileirada", "ReparoIniciado", "ReparoConcluido", "ReparoInviavel"];
const MAX_REENVIOS_COMPENSACAO = 3;

export function compensacoesDaEtapa(etapa: EtapaFluxoOs): Compensacao[] {
	if (ETAPAS_DIAGNOSTICO.includes(etapa)) return ["CancelarExecucao"];
	if (ETAPAS_ORCAMENTO.includes(etapa)) return ["CancelarOrcamento", "EstornarReservaEstoque"];
	if (ETAPAS_REPARO.includes(etapa)) return ["CancelarExecucao", "EstornarPagamento", "CancelarOrcamento", "EstornarReservaEstoque"];
	return [];
}

const unir = <T>(a: readonly T[], b: readonly T[]): T[] => [...a, ...b.filter((x) => !a.includes(x))];

function ignorar(estado: EstadoFluxo, motivo: string, alerta: string | null = null): Decisao {
	return { aplicar: false, motivo, estado, transicoesOs: [], comandos: [], acoesLocais: [], eventos: [], alerta };
}

function aplicar(
	estado: EstadoFluxo,
	motivo: string,
	parcial: Partial<Omit<Decisao, "aplicar" | "motivo" | "estado">> & { estado?: Partial<EstadoFluxo> } = {},
): Decisao {
	const { estado: mudancas, ...resto } = parcial;
	return {
		aplicar: true,
		motivo,
		transicoesOs: [],
		comandos: [],
		acoesLocais: [],
		eventos: [],
		alerta: null,
		...resto,
		estado: { ...estado, ...mudancas },
	};
}

// Motivo vira "motivo" de comandos/eventos (contrato exige texto não vazio).
export const textoOuPadrao = (texto: string | null | undefined, padrao: string): string => texto?.trim() || padrao;

function compensar(
	estado: EstadoFluxo,
	motivoRecebido: string,
	compensacoes: Compensacao[],
	agora: Date,
	prazos: PrazosFluxo,
	alerta: string | null = null,
): Decisao {
	const motivo = textoOuPadrao(motivoRecebido, "Cancelamento do fluxo da OS").slice(0, 2000);
	const remotas = compensacoes.filter((c): c is ComandoCompensacao => c !== "EstornarReservaEstoque");
	const estornaReserva = compensacoes.includes("EstornarReservaEstoque");
	const pendentes = unir(estado.compensacoesPendentes, remotas);
	const terminou = pendentes.length === 0;
	return aplicar(estado, `compensação: ${motivo}`, {
		transicoesOs: ["cancelar"],
		comandos: remotas,
		acoesLocais: estornaReserva ? [{ tipo: "ESTORNAR_RESERVA" }] : [],
		eventos: terminou ? ["FluxoCompensado"] : [],
		alerta,
		estado: {
			status: terminou ? StatusFluxoOs.COMPENSADO : StatusFluxoOs.COMPENSANDO,
			compensacoesPendentes: pendentes,
			compensacoesFeitas: estornaReserva ? unir(estado.compensacoesFeitas, ["EstornarReservaEstoque"]) : estado.compensacoesFeitas,
			motivoCompensacao: estado.motivoCompensacao ?? motivo,
			prazoExpiraEm: terminou ? null : somarMinutos(agora, prazos.respostaServicoMin),
			tentativas: 0,
		},
	});
}

function baixarCompensacao(estado: EstadoFluxo, feita: ComandoCompensacao): Decisao {
	if (!estado.compensacoesPendentes.includes(feita)) return ignorar(estado, `${feita} não estava pendente`);
	const pendentes = estado.compensacoesPendentes.filter((c) => c !== feita);
	const terminou = pendentes.length === 0;
	return aplicar(estado, `compensação ${feita} confirmada`, {
		eventos: terminou ? ["FluxoCompensado"] : [],
		estado: {
			compensacoesPendentes: pendentes,
			compensacoesFeitas: unir(estado.compensacoesFeitas, [feita]),
			status: terminou ? StatusFluxoOs.COMPENSADO : StatusFluxoOs.COMPENSANDO,
			prazoExpiraEm: terminou ? null : estado.prazoExpiraEm,
		},
	});
}

function resultadoDaReserva(
	estado: EstadoFluxo,
	resultado: ResultadoReserva,
	anteriores: OsTransition[],
	agora: Date,
	prazos: PrazosFluxo,
): Decisao {
	if (resultado === "ITENS_INVALIDOS") return compensar(estado, "Itens do diagnóstico inválidos", [], agora, prazos);
	if (resultado === "SEM_ESTOQUE")
		return aplicar(estado, "sem estoque: OS bloqueada", {
			transicoesOs: [...anteriores, "bloquear_por_estoque"],
			estado: { etapa: EtapaFluxoOs.AGUARDANDO_ESTOQUE, prazoExpiraEm: null },
		});
	return aplicar(estado, "estoque reservado: orçamento solicitado", {
		transicoesOs: anteriores,
		comandos: ["GerarOrcamento"],
		estado: {
			etapa: EtapaFluxoOs.AGUARDANDO_ORCAMENTO,
			prazoExpiraEm: somarMinutos(agora, prazos.respostaServicoMin),
			prazoAprovacaoEm: somarMinutos(agora, prazos.aprovacaoMin),
		},
	});
}

function decidirPagamento(estado: EstadoFluxo, pagamentoId: string, agora: Date, prazos: PrazosFluxo): Decisao {
	if (estado.pagamentoId === pagamentoId) return ignorar(estado, "pagamento já registrado");
	const { etapa, status } = estado;
	if (
		status === StatusFluxoOs.EM_ANDAMENTO &&
		(etapa === EtapaFluxoOs.AGUARDANDO_APROVACAO || etapa === EtapaFluxoOs.AGUARDANDO_PAGAMENTO)
	)
		return aplicar(estado, "pagamento confirmado: reparo solicitado", {
			transicoesOs:
				etapa === EtapaFluxoOs.AGUARDANDO_APROVACAO ? ["orcamento_aprovado", "pagamento_confirmado"] : ["pagamento_confirmado"],
			comandos: ["IniciarReparo"],
			estado: {
				etapa: EtapaFluxoOs.AGUARDANDO_ACK_REPARO,
				pagamentoId,
				prazoExpiraEm: somarMinutos(agora, prazos.respostaServicoMin),
			},
		});
	if (status === StatusFluxoOs.COMPENSANDO || status === StatusFluxoOs.COMPENSADO)
		return aplicar(estado, "pagamento depois do cancelamento: estorno", {
			comandos: ["EstornarPagamento"],
			alerta: "fluxo.pagamento_atrasado",
			estado: {
				status: StatusFluxoOs.COMPENSANDO,
				pagamentoId,
				compensacoesPendentes: unir(estado.compensacoesPendentes, ["EstornarPagamento"]),
				compensacoesFeitas: estado.compensacoesFeitas.filter((c) => c !== "EstornarPagamento"),
				prazoExpiraEm: somarMinutos(agora, prazos.respostaServicoMin),
			},
		});
	if (status === StatusFluxoOs.EM_ANDAMENTO && ETAPAS_ANTES_DA_APROVACAO.includes(etapa))
		return aplicar(estado, "pagamento antes da aprovação: estorno avulso", {
			comandos: ["EstornarPagamento"],
			alerta: "fluxo.pagamento_inesperado",
		});
	return ignorar(estado, "pagamento com outro id depois do pagamento do fluxo: decisão manual", "fluxo.pagamento_inesperado");
}

function decidirPrazo(estado: EstadoFluxo, agora: Date, prazos: PrazosFluxo): Decisao {
	if (!estado.prazoExpiraEm || estado.prazoExpiraEm > agora) return ignorar(estado, "prazo não vencido");
	switch (estado.etapa) {
		case EtapaFluxoOs.AGUARDANDO_ACK_DIAGNOSTICO:
			return compensar(estado, "Execução não confirmou o diagnóstico no prazo", ["CancelarExecucao"], agora, prazos);
		case EtapaFluxoOs.AGUARDANDO_ORCAMENTO:
			return compensar(estado, "Billing não respondeu no prazo", compensacoesDaEtapa(estado.etapa), agora, prazos);
		case EtapaFluxoOs.AGUARDANDO_APROVACAO:
			return compensar(estado, "Prazo de aprovação expirado", compensacoesDaEtapa(estado.etapa), agora, prazos);
		case EtapaFluxoOs.AGUARDANDO_PAGAMENTO:
			return compensar(estado, "Prazo de pagamento expirado", compensacoesDaEtapa(estado.etapa), agora, prazos);
		case EtapaFluxoOs.AGUARDANDO_ACK_REPARO:
			return aplicar(estado, "execução não confirmou o reparo no prazo", {
				alerta: "fluxo.falha_tecnica",
				estado: { status: StatusFluxoOs.FALHA_TECNICA, prazoExpiraEm: null },
			});
		default:
			return ignorar(estado, `etapa ${estado.etapa} sem prazo`);
	}
}

function decidirEmAndamento(estado: EstadoFluxo, evento: EventoFluxo, agora: Date, prazos: PrazosFluxo): Decisao {
	const { etapa } = estado;
	switch (evento.tipo) {
		case "ExecucaoEnfileirada":
			if (evento.etapa === "DIAGNOSTICO" && etapa === EtapaFluxoOs.AGUARDANDO_ACK_DIAGNOSTICO)
				return aplicar(estado, "diagnóstico enfileirado", {
					estado: { etapa: EtapaFluxoOs.AGUARDANDO_DIAGNOSTICO, prazoExpiraEm: null },
				});
			if (evento.etapa === "REPARO" && etapa === EtapaFluxoOs.AGUARDANDO_ACK_REPARO)
				return aplicar(estado, "reparo enfileirado", { estado: { etapa: EtapaFluxoOs.AGUARDANDO_REPARO, prazoExpiraEm: null } });
			break;
		case "DiagnosticoIniciado":
			if (etapa === EtapaFluxoOs.AGUARDANDO_ACK_DIAGNOSTICO || etapa === EtapaFluxoOs.AGUARDANDO_DIAGNOSTICO)
				return aplicar(estado, "diagnóstico iniciado", {
					transicoesOs: ["iniciar_diagnostico"],
					estado: { etapa: EtapaFluxoOs.DIAGNOSTICO_EM_ANDAMENTO, prazoExpiraEm: null },
				});
			break;
		case "DiagnosticoConcluido":
			if (ETAPAS_DIAGNOSTICO.includes(etapa) && evento.resultado)
				return resultadoDaReserva(
					estado,
					evento.resultado,
					etapa === EtapaFluxoOs.DIAGNOSTICO_EM_ANDAMENTO ? [] : ["iniciar_diagnostico"],
					agora,
					prazos,
				);
			break;
		case "DiagnosticoRejeitado":
			if (ETAPAS_DIAGNOSTICO.includes(etapa)) return compensar(estado, evento.motivo, [], agora, prazos);
			break;
		case "EstoqueRetomado":
			if (etapa === EtapaFluxoOs.AGUARDANDO_ESTOQUE && evento.resultado === "RESERVADO")
				return resultadoDaReserva(estado, "RESERVADO", ["desbloquear"], agora, prazos);
			break;
		case "OrcamentoGerado":
			if (etapa === EtapaFluxoOs.AGUARDANDO_ORCAMENTO)
				return aplicar(estado, "orçamento enviado ao cliente", {
					transicoesOs: ["orcamento_gerado"],
					estado: { etapa: EtapaFluxoOs.AGUARDANDO_APROVACAO, prazoExpiraEm: estado.prazoAprovacaoEm },
				});
			break;
		case "FalhaGerarOrcamento":
			if (etapa === EtapaFluxoOs.AGUARDANDO_ORCAMENTO)
				return compensar(estado, evento.motivo, ["EstornarReservaEstoque"], agora, prazos);
			break;
		case "OrcamentoAprovado":
			if (etapa === EtapaFluxoOs.AGUARDANDO_APROVACAO)
				return aplicar(estado, "orçamento aprovado", {
					transicoesOs: ["orcamento_aprovado"],
					estado: { etapa: EtapaFluxoOs.AGUARDANDO_PAGAMENTO, prazoExpiraEm: evento.prazoPagamentoEm },
				});
			break;
		case "OrcamentoRejeitado":
			if (etapa === EtapaFluxoOs.AGUARDANDO_APROVACAO)
				return compensar(
					estado,
					textoOuPadrao(evento.motivo, "Orçamento rejeitado pelo cliente"),
					compensacoesDaEtapa(etapa),
					agora,
					prazos,
				);
			break;
		case "ReparoIniciado":
			if (etapa === EtapaFluxoOs.AGUARDANDO_ACK_REPARO || etapa === EtapaFluxoOs.AGUARDANDO_REPARO)
				return aplicar(estado, "reparo iniciado", {
					acoesLocais: [{ tipo: "REGISTRAR_INICIO_REPARO", em: evento.em }],
					estado: { etapa: EtapaFluxoOs.REPARO_EM_ANDAMENTO, prazoExpiraEm: null },
				});
			break;
		case "ReparoConcluido":
			if (ETAPAS_REPARO.includes(etapa))
				return aplicar(estado, "reparo concluído", {
					transicoesOs: ["finalizar"],
					acoesLocais: [{ tipo: "REGISTRAR_FIM_REPARO", em: evento.em }],
					eventos: ["FluxoConcluido"],
					estado: { etapa: EtapaFluxoOs.FINALIZADO, status: StatusFluxoOs.CONCLUIDO, prazoExpiraEm: null },
				});
			break;
		case "ReparoInviavel":
			if (ETAPAS_REPARO.includes(etapa))
				return compensar(estado, evento.motivo, ["EstornarPagamento", "CancelarOrcamento", "EstornarReservaEstoque"], agora, prazos);
			break;
		case "PrazoExpirado":
			return decidirPrazo(estado, agora, prazos);
		case "CancelamentoSolicitado":
			return compensar(estado, evento.motivo, compensacoesDaEtapa(etapa), agora, prazos);
	}
	return ignorar(estado, `${evento.tipo} inesperado na etapa ${etapa}`);
}

function decidirCompensando(estado: EstadoFluxo, evento: EventoFluxo, agora: Date, prazos: PrazosFluxo): Decisao {
	switch (evento.tipo) {
		case "OrcamentoCancelado":
			return baixarCompensacao(estado, "CancelarOrcamento");
		case "PagamentoEstornado":
			return baixarCompensacao(estado, "EstornarPagamento");
		case "ExecucaoCancelada":
			return baixarCompensacao(estado, "CancelarExecucao");
		case "EstornoFalhou":
			if (!estado.compensacoesPendentes.includes("EstornarPagamento")) return ignorar(estado, "estorno não estava pendente");
			return aplicar(estado, "estorno falhou; billing tenta de novo", {
				alerta: "fluxo.estorno_falhou",
				estado: { prazoExpiraEm: somarMinutos(evento.proximaTentativaEm, prazos.respostaServicoMin) },
			});
		case "PrazoExpirado":
			if (!estado.prazoExpiraEm || estado.prazoExpiraEm > agora) return ignorar(estado, "prazo não vencido");
			if (estado.tentativas >= MAX_REENVIOS_COMPENSACAO)
				return aplicar(estado, "compensação sem resposta", {
					alerta: "fluxo.compensacao_travada",
					estado: { status: StatusFluxoOs.FALHA_TECNICA, prazoExpiraEm: null },
				});
			return aplicar(estado, "compensação atrasada: reenvio", {
				comandos: [...estado.compensacoesPendentes],
				alerta: "fluxo.compensacao_atrasada",
				estado: { tentativas: estado.tentativas + 1, prazoExpiraEm: somarMinutos(agora, prazos.respostaServicoMin) },
			});
		default:
			return ignorar(estado, `${evento.tipo} ignorado: fluxo em compensação`);
	}
}

function decidirFalhaTecnica(estado: EstadoFluxo, evento: EventoFluxo, agora: Date, prazos: PrazosFluxo): Decisao {
	switch (evento.tipo) {
		case "ReprocessamentoSolicitado":
			if (estado.compensacoesPendentes.length > 0)
				return aplicar(estado, "reenvio das compensações pendentes", {
					comandos: [...estado.compensacoesPendentes],
					estado: { status: StatusFluxoOs.COMPENSANDO, tentativas: 0, prazoExpiraEm: somarMinutos(agora, prazos.respostaServicoMin) },
				});
			return aplicar(estado, "reenvio do comando pendente", {
				acoesLocais: [{ tipo: "REENVIAR_COMANDO_PENDENTE" }],
				estado: { status: StatusFluxoOs.EM_ANDAMENTO, prazoExpiraEm: somarMinutos(agora, prazos.respostaServicoMin) },
			});
		case "CompensacaoSolicitada":
		case "CancelamentoSolicitado":
			return compensar(
				{ ...estado, compensacoesPendentes: [] },
				evento.motivo,
				unir(compensacoesDaEtapa(estado.etapa), estado.compensacoesPendentes),
				agora,
				prazos,
			);
		default:
			return ignorar(estado, `${evento.tipo} ignorado: fluxo em falha técnica`);
	}
}

export function decidir(atual: EstadoFluxo, evento: EventoFluxo, agora: Date, prazos: PrazosFluxo): Decisao {
	const retoma =
		atual.status === StatusFluxoOs.FALHA_TECNICA &&
		atual.compensacoesPendentes.length === 0 &&
		EVENTOS_QUE_RETOMAM_FALHA_TECNICA.includes(evento.tipo);
	const estado = retoma ? { ...atual, status: StatusFluxoOs.EM_ANDAMENTO } : atual;

	if (evento.tipo === "PagamentoConfirmado") return decidirPagamento(estado, evento.pagamentoId, agora, prazos);
	switch (estado.status) {
		case StatusFluxoOs.EM_ANDAMENTO:
			return decidirEmAndamento(estado, evento, agora, prazos);
		case StatusFluxoOs.COMPENSANDO:
			return decidirCompensando(estado, evento, agora, prazos);
		case StatusFluxoOs.FALHA_TECNICA:
			return decidirFalhaTecnica(estado, evento, agora, prazos);
		default:
			// SQS não ordena: a ordem pode nascer no execution depois de o fluxo encerrar sem ter mandado cancelamento.
			if (evento.tipo === "ExecucaoEnfileirada")
				return aplicar(estado, "ordem criada depois do fim do fluxo: cancelamento", {
					comandos: ["CancelarExecucao"],
					alerta: "fluxo.cancelamento_tardio",
				});
			return ignorar(estado, `fluxo ${estado.status} não aceita ${evento.tipo}`);
	}
}
