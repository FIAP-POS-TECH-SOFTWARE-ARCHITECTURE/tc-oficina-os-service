import { Inject, Injectable, Logger } from "@nestjs/common";
import type { IServiceResponse } from "semantic-response";
import { SR } from "../../../../common/utils/service-response.util";
import { OrquestradorOrdemServico } from "../../../orquestracao-os/application/orquestrador-ordem-servico";
import { canTransition, nextStatus } from "../../domain/fluxo-estados-os";
import { NOTIFICADOR, type NotificadorPort } from "../ports/notificador.gateway";
import { ORDENS_SERVICO_GATEWAY, type OrdensServicoGatewayPort } from "../ports/ordens-servico.gateway";

@Injectable()
export class CancelarOsUseCase {
	private readonly logger = new Logger(CancelarOsUseCase.name);

	constructor(
		@Inject(ORDENS_SERVICO_GATEWAY) private readonly gateway: OrdensServicoGatewayPort,
		@Inject(NOTIFICADOR) private readonly notificador: NotificadorPort,
		private readonly orquestrador: OrquestradorOrdemServico,
	) {}

	async execute(id: string, usuarioId: string, dto: { motivo?: string | null }): Promise<IServiceResponse<unknown>> {
		const os = await this.gateway.buscarDetalhePorId(id);
		if (!os) return SR.notFound(undefined, "OS não encontrada");

		if (!canTransition(os.status, "cancelar"))
			return SR.unprocessableEntity(undefined, `Não é possível cancelar a OS no status ${os.status}`);

		const viaFluxo = await this.orquestrador.cancelarPorStaff(id, usuarioId, dto.motivo?.trim() || "Cancelada pela oficina");
		if (viaFluxo.encontrado) {
			if (!viaFluxo.aplicado) return SR.unprocessableEntity(undefined, `Não é possível cancelar a OS agora: ${viaFluxo.motivo}`);
			return SR.ok(await this.gateway.buscarDetalhePorId(id), "OS cancelada; compensações em andamento");
		}
		// OS aberta antes do orquestrador: cancelamento local com estorno

		const cancelada = await this.gateway.executarCancelamento(os, usuarioId, dto.motivo);
		if (!cancelada) return SR.unprocessableEntity(undefined, "A OS mudou de status e não pode mais ser cancelada");

		const detalhe = await this.gateway.buscarDetalhePorId(id);
		try {
			await this.notificador.notificarMudancaStatus({
				numeroOs: os.numero,
				statusAnterior: os.status,
				statusNovo: nextStatus("cancelar"),
				nomeCliente: os.cliente.nome,
				emailCliente: os.cliente.email,
				observacao: dto.motivo,
			});
		} catch (error) {
			this.logger.error("Falha ao notificar mudança de status", error instanceof Error ? error.stack : String(error));
		}
		return SR.ok(detalhe, "OS cancelada");
	}
}
