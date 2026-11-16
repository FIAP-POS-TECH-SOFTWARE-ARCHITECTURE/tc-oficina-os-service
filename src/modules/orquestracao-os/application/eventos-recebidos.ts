import { EnvelopeMensagem } from "../../mensageria/envelope";
import { EventoFluxo } from "../domain/fluxo-ordem-servico";

// Payloads já validados pelo contrato no consumidor; aqui só a conversão de tipos.
export function paraEventoFluxo(envelope: EnvelopeMensagem): EventoFluxo | null {
	const p = envelope.payload as Record<string, string | null>;
	switch (envelope.tipo) {
		case "ExecucaoEnfileirada":
			return { tipo: "ExecucaoEnfileirada", etapa: p.etapa as "DIAGNOSTICO" | "REPARO" };
		case "DiagnosticoIniciado":
			return { tipo: "DiagnosticoIniciado" };
		case "DiagnosticoConcluido":
			return { tipo: "DiagnosticoConcluido", resultado: null };
		case "DiagnosticoRejeitado":
			return { tipo: "DiagnosticoRejeitado", motivo: String(p.motivo) };
		case "ReparoIniciado":
			return { tipo: "ReparoIniciado", em: new Date(envelope.ocorridoEm) };
		case "ReparoConcluido":
			return { tipo: "ReparoConcluido", em: new Date(String(p.concluidoEm)) };
		case "ReparoInviavel":
			return { tipo: "ReparoInviavel", motivo: String(p.motivo) };
		case "ExecucaoCancelada":
			return { tipo: "ExecucaoCancelada" };
		case "OrcamentoGerado":
			return { tipo: "OrcamentoGerado" };
		case "FalhaGerarOrcamento":
			return { tipo: "FalhaGerarOrcamento", motivo: String(p.motivo) };
		case "OrcamentoAprovado":
			return { tipo: "OrcamentoAprovado", prazoPagamentoEm: new Date(String(p.prazoPagamentoEm)) };
		case "OrcamentoRejeitado":
			return { tipo: "OrcamentoRejeitado", motivo: p.motivo ?? null };
		case "OrcamentoCancelado":
			return { tipo: "OrcamentoCancelado" };
		case "PagamentoConfirmado":
			return { tipo: "PagamentoConfirmado", pagamentoId: String(p.pagamentoId) };
		case "PagamentoEstornado":
			return { tipo: "PagamentoEstornado" };
		case "EstornoFalhou":
			return { tipo: "EstornoFalhou", proximaTentativaEm: new Date(String(p.proximaTentativaEm)) };
		default:
			return null;
	}
}
