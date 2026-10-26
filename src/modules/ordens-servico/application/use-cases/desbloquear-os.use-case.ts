import { Inject, Injectable } from "@nestjs/common";
import type { IServiceResponse } from "semantic-response";
import { SR } from "../../../../common/utils/service-response.util";
import { OrquestradorOrdemServico } from "../../../orquestracao-os/application/orquestrador-ordem-servico";
import { ORDENS_SERVICO_GATEWAY, type OrdensServicoGatewayPort } from "../ports/ordens-servico.gateway";

@Injectable()
export class DesbloquearOsUseCase {
	constructor(
		@Inject(ORDENS_SERVICO_GATEWAY) private readonly gateway: OrdensServicoGatewayPort,
		private readonly orquestrador: OrquestradorOrdemServico,
	) {}

	async execute(id: string, usuarioId: string): Promise<IServiceResponse<unknown>> {
		if (!(await this.gateway.buscarPorId(id))) return SR.notFound(undefined, "OS não encontrada");
		const r = await this.orquestrador.retomarBloqueada(id, usuarioId);
		if (!r.encontrado) return SR.unprocessableEntity(undefined, "Só é possível desbloquear OS bloqueada por falta de estoque");
		if (!r.aplicado) {
			if (r.faltantes?.length) return SR.unprocessableEntity(undefined, `Estoque ainda insuficiente: ${r.faltantes.join("; ")}`);
			return SR.unprocessableEntity(undefined, "Só é possível desbloquear OS bloqueada por falta de estoque");
		}
		return SR.ok(await this.gateway.buscarDetalhePorId(id), "OS desbloqueada; orçamento solicitado");
	}
}
