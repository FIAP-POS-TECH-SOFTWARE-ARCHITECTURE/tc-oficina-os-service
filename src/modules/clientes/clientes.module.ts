import { Module } from "@nestjs/common";
import { ClientesController } from "./adapters/clientes.controller";
import { ClientesPrismaGateway } from "./adapters/gateways/clientes.prisma.gateway";
import { InternalClientesController } from "./adapters/internal-clientes.controller";
import { CLIENTES_GATEWAY } from "./application/ports/clientes.gateway";
import { AtualizarClienteUseCase } from "./application/use-cases/atualizar-cliente.use-case";
import { BuscarClienteInternoUseCase } from "./application/use-cases/buscar-cliente-interno.use-case";
import { BuscarClientePorDocumentoUseCase } from "./application/use-cases/buscar-cliente-por-documento.use-case";
import { BuscarClienteUseCase } from "./application/use-cases/buscar-cliente.use-case";
import { CriarClienteUseCase } from "./application/use-cases/criar-cliente.use-case";
import { InativarClienteUseCase } from "./application/use-cases/inativar-cliente.use-case";
import { ListarClientesUseCase } from "./application/use-cases/listar-clientes.use-case";

const useCases = [
	CriarClienteUseCase,
	ListarClientesUseCase,
	BuscarClienteUseCase,
	BuscarClientePorDocumentoUseCase,
	AtualizarClienteUseCase,
	InativarClienteUseCase,
	BuscarClienteInternoUseCase,
];

@Module({
	controllers: [ClientesController, InternalClientesController],
	providers: [...useCases, { provide: CLIENTES_GATEWAY, useClass: ClientesPrismaGateway }],
	exports: [CLIENTES_GATEWAY],
})
export class ClientesModule {}
