import { OsTransition } from "../../ordens-servico/domain/fluxo-estados-os";
import { compensacoesDaEtapa, decidir, EstadoFluxo, EtapaFluxoOs as E, EventoFluxo, StatusFluxoOs as S } from "./fluxo-ordem-servico";

const AGORA = new Date("2026-10-20T12:00:00.000Z");
const PRAZOS = { aprovacaoMin: 4320, pagamentoMin: 2880, respostaServicoMin: 10 };
const mais = (min: number) => new Date(AGORA.getTime() + min * 60_000);
const estado = (p: Partial<EstadoFluxo> = {}): EstadoFluxo => ({
	etapa: E.AGUARDANDO_ACK_DIAGNOSTICO,
	status: S.EM_ANDAMENTO,
	prazoExpiraEm: null,
	prazoAprovacaoEm: null,
	compensacoesPendentes: [],
	compensacoesFeitas: [],
	motivoCompensacao: null,
	pagamentoId: null,
	tentativas: 0,
	...p,
});
const d = (e: Partial<EstadoFluxo>, ev: EventoFluxo) => decidir(estado(e), ev, AGORA, PRAZOS);

describe("decidir — caminho feliz", () => {
	it.each<[string, Partial<EstadoFluxo>, EventoFluxo, Partial<EstadoFluxo>, OsTransition[], string[]]>([
		[
			"ack diagnóstico",
			{ prazoExpiraEm: mais(5) },
			{ tipo: "ExecucaoEnfileirada", etapa: "DIAGNOSTICO" },
			{ etapa: E.AGUARDANDO_DIAGNOSTICO, prazoExpiraEm: null },
			[],
			[],
		],
		[
			"diagnóstico iniciado",
			{ etapa: E.AGUARDANDO_DIAGNOSTICO },
			{ tipo: "DiagnosticoIniciado" },
			{ etapa: E.DIAGNOSTICO_EM_ANDAMENTO },
			["iniciar_diagnostico"],
			[],
		],
		[
			"diagnóstico concluído com reserva",
			{ etapa: E.DIAGNOSTICO_EM_ANDAMENTO },
			{ tipo: "DiagnosticoConcluido", resultado: "RESERVADO" },
			{ etapa: E.AGUARDANDO_ORCAMENTO, prazoExpiraEm: mais(10), prazoAprovacaoEm: mais(4320) },
			[],
			["GerarOrcamento"],
		],
		[
			"diagnóstico concluído antes do iniciado (fora de ordem)",
			{ etapa: E.AGUARDANDO_DIAGNOSTICO },
			{ tipo: "DiagnosticoConcluido", resultado: "RESERVADO" },
			{ etapa: E.AGUARDANDO_ORCAMENTO },
			["iniciar_diagnostico"],
			["GerarOrcamento"],
		],
		[
			"sem estoque pausa",
			{ etapa: E.DIAGNOSTICO_EM_ANDAMENTO },
			{ tipo: "DiagnosticoConcluido", resultado: "SEM_ESTOQUE" },
			{ etapa: E.AGUARDANDO_ESTOQUE, prazoExpiraEm: null },
			["bloquear_por_estoque"],
			[],
		],
		[
			"retomada com estoque",
			{ etapa: E.AGUARDANDO_ESTOQUE },
			{ tipo: "EstoqueRetomado", resultado: "RESERVADO" },
			{ etapa: E.AGUARDANDO_ORCAMENTO, prazoExpiraEm: mais(10) },
			["desbloquear"],
			["GerarOrcamento"],
		],
		[
			"orçamento gerado",
			{ etapa: E.AGUARDANDO_ORCAMENTO, prazoAprovacaoEm: mais(4320) },
			{ tipo: "OrcamentoGerado" },
			{ etapa: E.AGUARDANDO_APROVACAO, prazoExpiraEm: mais(4320) },
			["orcamento_gerado"],
			[],
		],
		[
			"orçamento aprovado",
			{ etapa: E.AGUARDANDO_APROVACAO },
			{ tipo: "OrcamentoAprovado", prazoPagamentoEm: mais(2880) },
			{ etapa: E.AGUARDANDO_PAGAMENTO, prazoExpiraEm: mais(2880) },
			["orcamento_aprovado"],
			[],
		],
		[
			"pagamento confirmado",
			{ etapa: E.AGUARDANDO_PAGAMENTO },
			{ tipo: "PagamentoConfirmado", pagamentoId: "123" },
			{ etapa: E.AGUARDANDO_ACK_REPARO, pagamentoId: "123", prazoExpiraEm: mais(10) },
			["pagamento_confirmado"],
			["IniciarReparo"],
		],
		[
			"pagamento antes do OrcamentoAprovado (fora de ordem)",
			{ etapa: E.AGUARDANDO_APROVACAO },
			{ tipo: "PagamentoConfirmado", pagamentoId: "123" },
			{ etapa: E.AGUARDANDO_ACK_REPARO },
			["orcamento_aprovado", "pagamento_confirmado"],
			["IniciarReparo"],
		],
		[
			"ack reparo",
			{ etapa: E.AGUARDANDO_ACK_REPARO, prazoExpiraEm: mais(5) },
			{ tipo: "ExecucaoEnfileirada", etapa: "REPARO" },
			{ etapa: E.AGUARDANDO_REPARO, prazoExpiraEm: null },
			[],
			[],
		],
		[
			"reparo concluído",
			{ etapa: E.REPARO_EM_ANDAMENTO },
			{ tipo: "ReparoConcluido", em: AGORA },
			{ etapa: E.FINALIZADO, status: S.CONCLUIDO },
			["finalizar"],
			[],
		],
	])("%s", (_nome, antes, evento, depois, transicoes, comandos) => {
		const r = d(antes, evento);
		expect(r.aplicar).toBe(true);
		expect(r.estado).toEqual(expect.objectContaining(depois));
		expect(r.transicoesOs).toEqual(transicoes);
		expect(r.comandos).toEqual(comandos);
	});

	it("reparo iniciado e concluído registram horários; concluído publica FluxoConcluido", () => {
		expect(d({ etapa: E.AGUARDANDO_REPARO }, { tipo: "ReparoIniciado", em: AGORA }).acoesLocais).toEqual([
			{ tipo: "REGISTRAR_INICIO_REPARO", em: AGORA },
		]);
		const fim = d({ etapa: E.AGUARDANDO_ACK_REPARO }, { tipo: "ReparoConcluido", em: AGORA });
		expect(fim.acoesLocais).toEqual([{ tipo: "REGISTRAR_FIM_REPARO", em: AGORA }]);
		expect(fim.eventos).toEqual(["FluxoConcluido"]);
	});
});

describe("decidir — compensações", () => {
	it.each<[string, Partial<EstadoFluxo>, EventoFluxo, string[], boolean, S]>([
		[
			"diagnóstico rejeitado",
			{ etapa: E.DIAGNOSTICO_EM_ANDAMENTO },
			{ tipo: "DiagnosticoRejeitado", motivo: "motor fundido" },
			[],
			false,
			S.COMPENSADO,
		],
		[
			"itens inválidos",
			{ etapa: E.DIAGNOSTICO_EM_ANDAMENTO },
			{ tipo: "DiagnosticoConcluido", resultado: "ITENS_INVALIDOS" },
			[],
			false,
			S.COMPENSADO,
		],
		[
			"falha ao gerar orçamento",
			{ etapa: E.AGUARDANDO_ORCAMENTO },
			{ tipo: "FalhaGerarOrcamento", motivo: "VALOR_TOTAL_INCONSISTENTE" },
			[],
			true,
			S.COMPENSADO,
		],
		[
			"orçamento rejeitado",
			{ etapa: E.AGUARDANDO_APROVACAO },
			{ tipo: "OrcamentoRejeitado", motivo: null },
			["CancelarOrcamento"],
			true,
			S.COMPENSANDO,
		],
		[
			"reparo inviável",
			{ etapa: E.REPARO_EM_ANDAMENTO, pagamentoId: "1" },
			{ tipo: "ReparoInviavel", motivo: "peça indisponível" },
			["EstornarPagamento", "CancelarOrcamento"],
			true,
			S.COMPENSANDO,
		],
		[
			"staff cancela no diagnóstico",
			{ etapa: E.AGUARDANDO_DIAGNOSTICO },
			{ tipo: "CancelamentoSolicitado", motivo: "desistiu" },
			["CancelarExecucao"],
			false,
			S.COMPENSANDO,
		],
		[
			"staff cancela bloqueada",
			{ etapa: E.AGUARDANDO_ESTOQUE },
			{ tipo: "CancelamentoSolicitado", motivo: "desistiu" },
			[],
			false,
			S.COMPENSADO,
		],
		[
			"staff cancela aguardando pagamento",
			{ etapa: E.AGUARDANDO_PAGAMENTO },
			{ tipo: "CancelamentoSolicitado", motivo: "desistiu" },
			["CancelarOrcamento"],
			true,
			S.COMPENSANDO,
		],
		[
			"staff cancela em reparo",
			{ etapa: E.AGUARDANDO_REPARO },
			{ tipo: "CancelamentoSolicitado", motivo: "desistiu" },
			["CancelarExecucao", "EstornarPagamento", "CancelarOrcamento"],
			true,
			S.COMPENSANDO,
		],
	])("%s", (_nome, antes, evento, comandos, estornaReserva, status) => {
		const r = d(antes, evento);
		expect(r.aplicar).toBe(true);
		expect(r.transicoesOs).toEqual(["cancelar"]);
		expect(r.comandos).toEqual(comandos);
		expect(r.acoesLocais).toEqual(estornaReserva ? [{ tipo: "ESTORNAR_RESERVA" }] : []);
		expect(r.estado.status).toBe(status);
		expect(r.estado.compensacoesPendentes).toEqual(comandos);
		expect(r.eventos).toEqual(status === S.COMPENSADO ? ["FluxoCompensado"] : []);
		expect(r.estado.motivoCompensacao).toBeTruthy();
	});

	it.each<[E, string[], boolean]>([
		[E.AGUARDANDO_ACK_DIAGNOSTICO, ["CancelarExecucao"], false],
		[E.AGUARDANDO_ORCAMENTO, ["CancelarOrcamento"], true],
		[E.AGUARDANDO_APROVACAO, ["CancelarOrcamento"], true],
		[E.AGUARDANDO_PAGAMENTO, ["CancelarOrcamento"], true],
	])("prazo vencido em %s compensa", (etapa, comandos, estorna) => {
		const r = d({ etapa, prazoExpiraEm: mais(-1) }, { tipo: "PrazoExpirado" });
		expect(r.comandos).toEqual(comandos);
		expect(r.acoesLocais.length > 0).toBe(estorna);
		expect(r.transicoesOs).toEqual(["cancelar"]);
	});

	it("prazo do ack de reparo vira FALHA_TECNICA sem compensar, com alerta", () => {
		const r = d({ etapa: E.AGUARDANDO_ACK_REPARO, prazoExpiraEm: mais(-1) }, { tipo: "PrazoExpirado" });
		expect(r).toEqual(expect.objectContaining({ comandos: [], transicoesOs: [], alerta: "fluxo.falha_tecnica" }));
		expect(r.estado.status).toBe(S.FALHA_TECNICA);
	});

	it("prazo ainda não vencido (outra réplica já tratou) é ignorado", () => {
		expect(d({ etapa: E.AGUARDANDO_APROVACAO, prazoExpiraEm: mais(1) }, { tipo: "PrazoExpirado" }).aplicar).toBe(false);
		expect(d({ etapa: E.AGUARDANDO_DIAGNOSTICO, prazoExpiraEm: null }, { tipo: "PrazoExpirado" }).aplicar).toBe(false);
	});

	it.each(["", "   "])("motivo vazio (%p) vira texto padrão: contrato exige motivo não vazio", (motivo) => {
		const r = d({ etapa: E.AGUARDANDO_APROVACAO }, { tipo: "OrcamentoRejeitado", motivo });
		expect(r.estado.motivoCompensacao).toBe("Orçamento rejeitado pelo cliente");
		const s2 = d({ etapa: E.AGUARDANDO_PAGAMENTO }, { tipo: "CancelamentoSolicitado", motivo });
		expect(s2.estado.motivoCompensacao).toBe("Cancelamento do fluxo da OS");
	});

	it("compensacoesDaEtapa não tem nada para etapa finalizada", () => {
		expect(compensacoesDaEtapa(E.FINALIZADO)).toEqual([]);
	});
});

describe("decidir — em compensação", () => {
	const compensando = (p: Partial<EstadoFluxo> = {}) => ({
		status: S.COMPENSANDO,
		etapa: E.REPARO_EM_ANDAMENTO,
		compensacoesPendentes: ["EstornarPagamento", "CancelarOrcamento"] as EstadoFluxo["compensacoesPendentes"],
		compensacoesFeitas: ["EstornarReservaEstoque"] as EstadoFluxo["compensacoesFeitas"],
		prazoExpiraEm: mais(5),
		motivoCompensacao: "peça indisponível",
		...p,
	});

	it("baixa pendências uma a uma e termina COMPENSADO com FluxoCompensado", () => {
		const r1 = d(compensando(), { tipo: "PagamentoEstornado" });
		expect(r1.estado.compensacoesPendentes).toEqual(["CancelarOrcamento"]);
		expect(r1.eventos).toEqual([]);
		const r2 = decidir(r1.estado, { tipo: "OrcamentoCancelado" }, AGORA, PRAZOS);
		expect(r2.estado).toEqual(expect.objectContaining({ status: S.COMPENSADO, compensacoesPendentes: [], prazoExpiraEm: null }));
		expect(r2.estado.compensacoesFeitas).toEqual(["EstornarReservaEstoque", "EstornarPagamento", "CancelarOrcamento"]);
		expect(r2.eventos).toEqual(["FluxoCompensado"]);
	});

	it("resultado de compensação que não estava pendente é ignorado", () => {
		expect(d(compensando(), { tipo: "ExecucaoCancelada" }).aplicar).toBe(false);
	});

	it("EstornoFalhou mantém a pendência e adia o prazo", () => {
		const r = d(compensando(), { tipo: "EstornoFalhou", proximaTentativaEm: mais(60) });
		expect(r.estado.compensacoesPendentes).toContain("EstornarPagamento");
		expect(r.estado.prazoExpiraEm).toEqual(mais(70));
		expect(r.alerta).toBe("fluxo.estorno_falhou");
	});

	it("prazo vencido reenvia pendentes até 3 vezes e depois FALHA_TECNICA", () => {
		const r = d(compensando({ prazoExpiraEm: mais(-1), tentativas: 2 }), { tipo: "PrazoExpirado" });
		expect(r.comandos).toEqual(["EstornarPagamento", "CancelarOrcamento"]);
		expect(r.estado.tentativas).toBe(3);
		const r2 = d(compensando({ prazoExpiraEm: mais(-1), tentativas: 3 }), { tipo: "PrazoExpirado" });
		expect(r2.estado.status).toBe(S.FALHA_TECNICA);
		expect(r2.comandos).toEqual([]);
	});

	it("cancelamento durante compensação é recusado", () => {
		expect(d(compensando(), { tipo: "CancelamentoSolicitado", motivo: "x" }).aplicar).toBe(false);
	});
});

describe("decidir — PagamentoConfirmado fora do caminho feliz", () => {
	it("mesmo pagamentoId já registrado é duplicata de negócio: ignora", () => {
		expect(d({ etapa: E.REPARO_EM_ANDAMENTO, pagamentoId: "123" }, { tipo: "PagamentoConfirmado", pagamentoId: "123" }).aplicar).toBe(
			false,
		);
	});

	it.each([S.COMPENSANDO, S.COMPENSADO])("fluxo %s: estorna e volta a COMPENSANDO", (status) => {
		const r = d(
			{ status, etapa: E.AGUARDANDO_PAGAMENTO, compensacoesFeitas: ["CancelarOrcamento", "EstornarReservaEstoque"] },
			{ tipo: "PagamentoConfirmado", pagamentoId: "999" },
		);
		expect(r.comandos).toEqual(["EstornarPagamento"]);
		expect(r.estado).toEqual(
			expect.objectContaining({ status: S.COMPENSANDO, pagamentoId: "999", compensacoesPendentes: ["EstornarPagamento"] }),
		);
		expect(r.transicoesOs).toEqual([]);
		expect(r.alerta).toBe("fluxo.pagamento_atrasado");
	});

	it("antes da aprovação: estorno avulso, fluxo segue", () => {
		const r = d({ etapa: E.AGUARDANDO_ORCAMENTO }, { tipo: "PagamentoConfirmado", pagamentoId: "5" });
		expect(r.comandos).toEqual(["EstornarPagamento"]);
		expect(r.estado.status).toBe(S.EM_ANDAMENTO);
		expect(r.estado.pagamentoId).toBeNull();
	});

	it.each([
		[S.EM_ANDAMENTO, E.REPARO_EM_ANDAMENTO],
		[S.CONCLUIDO, E.FINALIZADO],
	])("outro pagamentoId depois do pagamento do fluxo (%s): não estorna sozinho, alerta", (status, etapa) => {
		const r = d({ status, etapa, pagamentoId: "1" }, { tipo: "PagamentoConfirmado", pagamentoId: "2" });
		expect(r.aplicar).toBe(false);
		expect(r.comandos).toEqual([]);
		expect(r.alerta).toBe("fluxo.pagamento_inesperado");
	});
});

describe("decidir — falha técnica e staff", () => {
	it("evento atrasado do Execution retoma FALHA_TECNICA sem pendências", () => {
		const r = d({ status: S.FALHA_TECNICA, etapa: E.AGUARDANDO_ACK_REPARO }, { tipo: "ExecucaoEnfileirada", etapa: "REPARO" });
		expect(r.estado).toEqual(expect.objectContaining({ status: S.EM_ANDAMENTO, etapa: E.AGUARDANDO_REPARO }));
	});

	it("reprocessar sem pendências reenvia o comando pendente", () => {
		const r = d({ status: S.FALHA_TECNICA, etapa: E.AGUARDANDO_ACK_REPARO }, { tipo: "ReprocessamentoSolicitado" });
		expect(r.acoesLocais).toEqual([{ tipo: "REENVIAR_COMANDO_PENDENTE" }]);
		expect(r.estado).toEqual(expect.objectContaining({ status: S.EM_ANDAMENTO, prazoExpiraEm: mais(10) }));
	});

	it("reprocessar com compensação travada reenvia as pendentes", () => {
		const r = d({ status: S.FALHA_TECNICA, compensacoesPendentes: ["CancelarOrcamento"] }, { tipo: "ReprocessamentoSolicitado" });
		expect(r.comandos).toEqual(["CancelarOrcamento"]);
		expect(r.estado.status).toBe(S.COMPENSANDO);
	});

	it("compensar em FALHA_TECNICA junta compensações da etapa e pendentes", () => {
		const r = d(
			{ status: S.FALHA_TECNICA, etapa: E.AGUARDANDO_ACK_REPARO },
			{ tipo: "CompensacaoSolicitada", motivo: "decisão do administrador" },
		);
		expect(r.comandos).toEqual(["CancelarExecucao", "EstornarPagamento", "CancelarOrcamento"]);
		expect(r.transicoesOs).toEqual(["cancelar"]);
	});

	it.each<[S, EventoFluxo]>([
		[S.EM_ANDAMENTO, { tipo: "ReprocessamentoSolicitado" }],
		[S.CONCLUIDO, { tipo: "CancelamentoSolicitado", motivo: "x" }],
		[S.COMPENSADO, { tipo: "OrcamentoGerado" }],
	])("%s não aceita %p", (status, evento) => {
		expect(d({ status, etapa: E.AGUARDANDO_APROVACAO }, evento).aplicar).toBe(false);
	});

	it.each([S.COMPENSADO, S.CONCLUIDO])("%s responde ExecucaoEnfileirada tardio com CancelarExecucao", (status) => {
		const r = d({ status, etapa: E.FINALIZADO }, { tipo: "ExecucaoEnfileirada", etapa: "REPARO" });
		expect(r.comandos).toEqual(["CancelarExecucao"]);
		expect(r.transicoesOs).toEqual([]);
	});

	it.each<[E, EventoFluxo]>([
		[E.AGUARDANDO_APROVACAO, { tipo: "DiagnosticoIniciado" }],
		[E.AGUARDANDO_PAGAMENTO, { tipo: "OrcamentoGerado" }],
		[E.AGUARDANDO_ORCAMENTO, { tipo: "ExecucaoEnfileirada", etapa: "DIAGNOSTICO" }],
		[E.AGUARDANDO_DIAGNOSTICO, { tipo: "ReparoConcluido", em: AGORA }],
		[E.AGUARDANDO_ORCAMENTO, { tipo: "DiagnosticoConcluido", resultado: null }],
		[E.AGUARDANDO_ESTOQUE, { tipo: "EstoqueRetomado", resultado: "SEM_ESTOQUE" }],
		[E.AGUARDANDO_ORCAMENTO, { tipo: "OrcamentoCancelado" }],
		[E.AGUARDANDO_ORCAMENTO, { tipo: "DiagnosticoRejeitado", motivo: "x" }],
		[E.AGUARDANDO_APROVACAO, { tipo: "FalhaGerarOrcamento", motivo: "x" }],
		[E.AGUARDANDO_PAGAMENTO, { tipo: "OrcamentoAprovado", prazoPagamentoEm: AGORA }],
		[E.AGUARDANDO_PAGAMENTO, { tipo: "OrcamentoRejeitado", motivo: "x" }],
		[E.REPARO_EM_ANDAMENTO, { tipo: "ReparoIniciado", em: AGORA }],
		[E.AGUARDANDO_APROVACAO, { tipo: "ReparoInviavel", motivo: "x" }],
	])("etapa %s ignora %p", (etapa, evento) => {
		expect(d({ etapa }, evento).aplicar).toBe(false);
	});

	it("prazo vencido em etapa sem prazo é ignorado", () => {
		expect(d({ etapa: E.REPARO_EM_ANDAMENTO, prazoExpiraEm: mais(-1) }, { tipo: "PrazoExpirado" }).aplicar).toBe(false);
	});

	it("FALHA_TECNICA ignora evento que não retoma nem é comando do staff", () => {
		expect(d({ status: S.FALHA_TECNICA, etapa: E.AGUARDANDO_ACK_REPARO }, { tipo: "OrcamentoGerado" }).aplicar).toBe(false);
	});
});
