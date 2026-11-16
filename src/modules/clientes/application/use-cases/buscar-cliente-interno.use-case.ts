import { Inject, Injectable } from "@nestjs/common";
import type { IServiceResponse } from "semantic-response";
import { SR } from "../../../../common/utils/service-response.util";
import { CLIENTES_GATEWAY, type ClientesGatewayPort } from "../ports/clientes.gateway";

const SO_DIGITOS_CPF_OU_CNPJ = /^(\d{11}|\d{14})$/;

export interface ClienteInterno {
	id: string;
	nome: string;
	ativo: boolean;
}

@Injectable()
export class BuscarClienteInternoUseCase {
	constructor(@Inject(CLIENTES_GATEWAY) private readonly gateway: ClientesGatewayPort) {}

	async execute(documento: string): Promise<IServiceResponse<ClienteInterno>> {
		if (!SO_DIGITOS_CPF_OU_CNPJ.test(documento))
			return SR.badRequest<ClienteInterno>(undefined, "Documento deve conter apenas os 11 (CPF) ou 14 (CNPJ) dígitos");

		const cliente = await this.gateway.buscarPorDocumento(documento);
		if (!cliente) return SR.notFound<ClienteInterno>(undefined, "Cliente não encontrado");

		return SR.ok({ id: cliente.id, nome: cliente.nome, ativo: cliente.ativo });
	}
}
