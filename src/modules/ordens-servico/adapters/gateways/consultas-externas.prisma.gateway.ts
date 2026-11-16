import { Inject, Injectable } from "@nestjs/common";
import { CLIENTES_GATEWAY, type ClientesGatewayPort } from "../../../clientes/application/ports/clientes.gateway";
import { VEICULOS_GATEWAY, type VeiculosGatewayPort } from "../../../veiculos/application/ports/veiculos.gateway";
import { ClientesConsultaPort, VeiculosConsultaPort } from "../../application/ports/consultas-externas.gateway";

@Injectable()
export class ClientesConsultaPrismaGateway implements ClientesConsultaPort {
	constructor(@Inject(CLIENTES_GATEWAY) private readonly clientes: ClientesGatewayPort) {}
	buscarPorId(id: string) {
		return this.clientes.buscarPorId(id);
	}
}

@Injectable()
export class VeiculosConsultaPrismaGateway implements VeiculosConsultaPort {
	constructor(@Inject(VEICULOS_GATEWAY) private readonly veiculos: VeiculosGatewayPort) {}
	buscarPorId(id: string) {
		return this.veiculos.buscarPorId(id);
	}
}
