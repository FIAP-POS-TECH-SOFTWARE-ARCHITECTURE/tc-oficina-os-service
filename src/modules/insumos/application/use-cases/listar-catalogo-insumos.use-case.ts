import { Inject, Injectable } from "@nestjs/common";
import type { IServiceResponse } from "semantic-response";
import { decimalParaCentavos } from "../../../../common/utils/centavos";
import { SR } from "../../../../common/utils/service-response.util";
import { INSUMOS_GATEWAY, type InsumosGatewayPort } from "../ports/insumos.gateway";

export interface InsumoCatalogo {
	id: string;
	codigo: string;
	nome: string;
	precoCentavos: number;
	quantidadeEstoque: number;
}

@Injectable()
export class ListarCatalogoInsumosUseCase {
	constructor(@Inject(INSUMOS_GATEWAY) private readonly gateway: InsumosGatewayPort) {}

	async execute(): Promise<IServiceResponse<InsumoCatalogo[]>> {
		const insumos = await this.gateway.listarTodos();
		return SR.ok(
			insumos
				.filter((i) => i.ativo)
				.map((i) => ({
					id: i.id,
					codigo: i.codigo,
					nome: i.nome,
					precoCentavos: decimalParaCentavos(i.precoUnitario),
					quantidadeEstoque: i.quantidadeEstoque,
				})),
		);
	}
}
