import { Logger } from "@nestjs/common";
import { criarEnvelope } from "../../mensageria/envelope";
import { EtapaFluxoOs as E, StatusFluxoOs as S } from "../domain/fluxo-ordem-servico";
import { FluxoOrdemServico, TransacaoFluxo } from "./ports/repositorio-fluxo.gateway";
import { OrquestradorOrdemServico } from "./orquestrador-ordem-servico";

const PRAZOS = { aprovacaoMin: 4320, pagamentoMin: 2880, respostaServicoMin: 10 };

function fluxo(p: Partial<FluxoOrdemServico> = {}): FluxoOrdemServico {
	return {
		id: "3f2a1c9e-8b7d-4e6f-a5b4-c3d2e1f0a9b8",
		osId: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
		numeroOs: "OS-2026-000123",
		correlationId: "req-1",
		comandoPendenteMessageId: null,
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
	};
}

function criarTx(f: FluxoOrdemServico | null) {
	const enfileiradas: { destino: string; envelope: any }[] = [];
	const tx = {
		enfileiradas,
		registrarMensagemProcessada: jest.fn().mockResolvedValue(true),
		travarFluxo: jest.fn().mockResolvedValue(f),
		travarFluxoPorOs: jest.fn().mockResolvedValue(f),
		criarOsComFluxo: jest.fn().mockResolvedValue(f),
		salvarFluxo: jest.fn(),
		processarDiagnostico: jest.fn().mockResolvedValue("RESERVADO"),
		reservarItensDaOs: jest.fn().mockResolvedValue({ reservado: false, faltantes: ["Óleo (1 disponíveis, 4 requisitados)"] }),
		estornarReserva: jest.fn(),
		registrarInicioReparo: jest.fn(),
		registrarFimReparo: jest.fn(),
		transicionarOs: jest.fn().mockResolvedValue({
			numeroOs: "OS-2026-000123",
			statusAnterior: "AGUARDANDO_APROVACAO",
			statusNovo: "CANCELADA",
			nomeCliente: "Maria",
			emailCliente: null,
		}),
		montarPayloadComando: jest.fn().mockResolvedValue({ motivo: "x" }),
		enfileirar: jest.fn(async (destino: string, envelope: unknown) => void enfileiradas.push({ destino, envelope })),
		buscarMensagemEnfileirada: jest.fn(),
	};
	return tx as typeof tx & TransacaoFluxo;
}

describe("OrquestradorOrdemServico", () => {
	let tx: ReturnType<typeof criarTx>;
	let repositorio: {
		emTransacao: jest.Mock;
		listarComPrazoVencido: jest.Mock;
		listarAguardandoEstoque: jest.Mock;
		consultarPorOs: jest.Mock;
	};
	let notificador: { notificarMudancaStatus: jest.Mock };
	let orq: OrquestradorOrdemServico;

	const usar = (f: FluxoOrdemServico | null) => {
		tx = criarTx(f);
		repositorio.emTransacao.mockImplementation((fn: (t: TransacaoFluxo) => unknown) => fn(tx));
	};
	const evento = (tipo: string, payload: Record<string, unknown> = {}, origem: "billing" | "execution" = "billing") =>
		criarEnvelope({
			tipo,
			origem,
			fluxoId: fluxo().id,
			osId: fluxo().osId,
			numeroOs: "OS-2026-000123",
			correlationId: "req-1",
			payload,
		});

	beforeEach(() => {
		for (const m of ["log", "warn", "error"] as const) jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined);
		repositorio = {
			emTransacao: jest.fn(),
			listarComPrazoVencido: jest.fn().mockResolvedValue([]),
			listarAguardandoEstoque: jest.fn().mockResolvedValue([]),
			consultarPorOs: jest.fn(),
		};
		notificador = { notificarMudancaStatus: jest.fn() };
		orq = new OrquestradorOrdemServico(repositorio as never, notificador, PRAZOS);
	});

	afterEach(() => jest.restoreAllMocks());

	it("abrirOs cria OS+fluxo e enfileira SolicitarDiagnostico guardando o messageId pendente", async () => {
		usar(fluxo());
		const r = await orq.abrirOs({ numero: "OS-2026-000123", clienteId: "c", veiculoId: "v", correlationId: "req-1" });
		expect(r).toEqual({ osId: fluxo().osId, fluxoId: fluxo().id });
		expect(tx.enfileiradas.map((m) => [m.destino, m.envelope.tipo])).toEqual([["execucao-comandos", "SolicitarDiagnostico"]]);
		expect(tx.salvarFluxo).toHaveBeenCalledWith(
			expect.objectContaining({ comandoPendenteMessageId: tx.enfileiradas[0].envelope.messageId }),
		);
	});

	it("mensagem já processada: nenhum efeito", async () => {
		usar(fluxo({ etapa: E.AGUARDANDO_APROVACAO }));
		tx.registrarMensagemProcessada.mockResolvedValue(false);
		await orq.processarEvento(evento("OrcamentoRejeitado", { orcamentoId: "o", motivo: null }));
		expect(tx.salvarFluxo).not.toHaveBeenCalled();
		expect(tx.enfileirar).not.toHaveBeenCalled();
	});

	it("fluxo desconhecido: registra messageId e ignora", async () => {
		usar(null);
		await orq.processarEvento(evento("OrcamentoGerado", { orcamentoId: "o", valorTotalCentavos: 1 }));
		expect(tx.registrarMensagemProcessada).toHaveBeenCalled();
		expect(tx.salvarFluxo).not.toHaveBeenCalled();
	});

	it("orçamento rejeitado: estorna reserva, cancela OS, enfileira CancelarOrcamento, salva e notifica depois", async () => {
		usar(fluxo({ etapa: E.AGUARDANDO_APROVACAO }));
		await orq.processarEvento(evento("OrcamentoRejeitado", { orcamentoId: "o", motivo: null }));
		expect(tx.estornarReserva).toHaveBeenCalledWith(fluxo().osId, expect.stringContaining("Orçamento rejeitado"));
		expect(tx.transicionarOs).toHaveBeenCalledWith(fluxo().osId, ["cancelar"], expect.any(String), null);
		expect(tx.enfileiradas.map((m) => [m.destino, m.envelope.tipo])).toEqual([["billing-comandos", "CancelarOrcamento"]]);
		expect(tx.salvarFluxo).toHaveBeenCalledWith(
			expect.objectContaining({ status: S.COMPENSANDO, compensacoesPendentes: ["CancelarOrcamento"] }),
		);
		expect(notificador.notificarMudancaStatus).toHaveBeenCalledWith(expect.objectContaining({ statusNovo: "CANCELADA" }));
	});

	it("DiagnosticoConcluido só processa itens quando a etapa aceita", async () => {
		usar(fluxo({ etapa: E.DIAGNOSTICO_EM_ANDAMENTO }));
		const itens = [{ tipo: "SERVICO", referenciaId: "s", quantidade: 1 }];
		await orq.processarEvento(evento("DiagnosticoConcluido", { mecanicoId: "m", diagnostico: "ok", itens }, "execution"));
		expect(tx.processarDiagnostico).toHaveBeenCalledWith(fluxo().osId, "ok", itens);
		expect(tx.enfileiradas.map((m) => m.envelope.tipo)).toEqual(["GerarOrcamento"]);

		usar(fluxo({ etapa: E.AGUARDANDO_APROVACAO }));
		await orq.processarEvento(evento("DiagnosticoConcluido", { mecanicoId: "m", diagnostico: "ok", itens }, "execution"));
		expect(tx.processarDiagnostico).not.toHaveBeenCalled();
	});

	it("fluxo compensado publica FluxoCompensado com motivo e compensações feitas", async () => {
		usar(
			fluxo({
				status: S.COMPENSANDO,
				etapa: E.AGUARDANDO_APROVACAO,
				compensacoesPendentes: ["CancelarOrcamento"],
				compensacoesFeitas: ["EstornarReservaEstoque"],
				motivoCompensacao: "Prazo de aprovação expirado",
			}),
		);
		await orq.processarEvento(evento("OrcamentoCancelado", { orcamentoId: null, motivo: "x" }));
		const informativo = tx.enfileiradas.find((m) => m.envelope.tipo === "FluxoCompensado");
		expect(informativo?.destino).toBe("eventos");
		expect(informativo?.envelope.payload).toEqual({
			motivo: "Prazo de aprovação expirado",
			compensacoes: ["EstornarReservaEstoque", "CancelarOrcamento"],
		});
	});

	it("falha no e-mail não desfaz nada nem propaga", async () => {
		usar(fluxo({ etapa: E.AGUARDANDO_APROVACAO }));
		notificador.notificarMudancaStatus.mockRejectedValue(new Error("smtp"));
		await expect(orq.processarEvento(evento("OrcamentoRejeitado", { orcamentoId: "o", motivo: null }))).resolves.toBeUndefined();
	});

	it("cancelamento pelo staff: sem fluxo, em compensação e aplicado", async () => {
		usar(null);
		expect(await orq.cancelarPorStaff("os", "u", "x")).toEqual({ encontrado: false });
		usar(fluxo({ status: S.COMPENSANDO }));
		expect(await orq.cancelarPorStaff("os", "u", "x")).toEqual(expect.objectContaining({ encontrado: true, aplicado: false }));
		usar(fluxo({ etapa: E.AGUARDANDO_PAGAMENTO }));
		expect(await orq.cancelarPorStaff("os", "u", "desistiu")).toEqual(expect.objectContaining({ aplicado: true }));
		expect(tx.transicionarOs).toHaveBeenCalledWith(fluxo().osId, ["cancelar"], expect.any(String), "u");
	});

	it("retomada sem estoque devolve faltantes e não muda nada", async () => {
		usar(fluxo({ etapa: E.AGUARDANDO_ESTOQUE }));
		const r = await orq.retomarBloqueada("os", "u");
		expect(r).toEqual(expect.objectContaining({ aplicado: false, faltantes: ["Óleo (1 disponíveis, 4 requisitados)"] }));
		expect(tx.salvarFluxo).not.toHaveBeenCalled();
	});

	it("reprocessar reenvia o comando pendente com messageId novo", async () => {
		const original = evento("IniciarReparo", { itensServico: [], itensInsumo: [] });
		usar(fluxo({ status: S.FALHA_TECNICA, etapa: E.AGUARDANDO_ACK_REPARO, comandoPendenteMessageId: original.messageId }));
		tx.buscarMensagemEnfileirada.mockResolvedValue({ ...original, origem: "os" });
		await orq.reprocessar(fluxo().id);
		const reenviado = tx.enfileiradas[0].envelope;
		expect(reenviado.tipo).toBe("IniciarReparo");
		expect(reenviado.messageId).not.toBe(original.messageId);
		expect(tx.salvarFluxo).toHaveBeenCalledWith(
			expect.objectContaining({ status: S.EM_ANDAMENTO, comandoPendenteMessageId: reenviado.messageId }),
		);
	});

	it("verificarPrazos segue para o próximo fluxo quando um falha", async () => {
		usar(fluxo({ etapa: E.AGUARDANDO_APROVACAO, prazoExpiraEm: new Date(0) }));
		repositorio.listarComPrazoVencido.mockResolvedValue(["f1", "f2"]);
		tx.travarFluxo
			.mockRejectedValueOnce(new Error("deadlock"))
			.mockResolvedValueOnce(fluxo({ etapa: E.AGUARDANDO_APROVACAO, prazoExpiraEm: new Date(0) }));
		await orq.verificarPrazos(new Date());
		expect(tx.enfileiradas.map((m) => m.envelope.tipo)).toEqual(["CancelarOrcamento"]);
	});
});
