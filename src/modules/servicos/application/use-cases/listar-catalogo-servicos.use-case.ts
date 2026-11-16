import { Inject, Injectable } from "@nestjs/common";
import type { IServiceResponse } from "semantic-response";
import { decimalParaCentavos } from "../../../../common/utils/centavos";
import { SR } from "../../../../common/utils/service-response.util";
import { SERVICOS_GATEWAY, type ServicosGatewayPort } from "../ports/servicos.gateway";

export interface ServicoCatalogo {
	id: string;
	nome: string;
	descricao: string | null;
	precoCentavos: number;
	tempoEstimadoMin: number;
}

@Injectable()
export class ListarCatalogoServicosUseCase {
	constructor(@Inject(SERVICOS_GATEWAY) private readonly gateway: ServicosGatewayPort) {}

	async execute(): Promise<IServiceResponse<ServicoCatalogo[]>> {
		const servicos = await this.gateway.listarTodos();
		return SR.ok(
			servicos
				.filter((s) => s.ativo)
				.map((s) => ({
					id: s.id,
					nome: s.nome,
					descricao: s.descricao,
					precoCentavos: decimalParaCentavos(s.preco),
					tempoEstimadoMin: s.tempoEstimadoMin,
				})),
		);
	}
}
