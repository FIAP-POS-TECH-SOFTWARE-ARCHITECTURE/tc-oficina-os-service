import { Module } from "@nestjs/common";
import { ClientesModule } from "../clientes/clientes.module";
import { InsumosModule } from "../insumos/insumos.module";
import { VeiculosModule } from "../veiculos/veiculos.module";
import { ClientesConsultaPrismaGateway, VeiculosConsultaPrismaGateway } from "./adapters/gateways/consultas-externas.prisma.gateway";
import { SmtpNotificadorGateway } from "./adapters/gateways/notificador.smtp.gateway";
import { OrdensServicoPrismaGateway } from "./adapters/gateways/ordens-servico.prisma.gateway";
import { OrdensServicoController } from "./adapters/ordens-servico.controller";
import { CLIENTES_CONSULTA, VEICULOS_CONSULTA } from "./application/ports/consultas-externas.gateway";
import { NOTIFICADOR } from "./application/ports/notificador.gateway";
import { ORDENS_SERVICO_GATEWAY } from "./application/ports/ordens-servico.gateway";
import { BuscarOsUseCase } from "./application/use-cases/buscar-os.use-case";
import { CancelarOsUseCase } from "./application/use-cases/cancelar-os.use-case";
import { ConsultaAcompanhamentoOsUseCase } from "./application/use-cases/consulta-publica-os.use-case";
import { CriarOsUseCase } from "./application/use-cases/criar-os.use-case";
import { EntregarOsUseCase } from "./application/use-cases/entregar-os.use-case";
import { HistoricoOsUseCase } from "./application/use-cases/historico-os.use-case";
import { ListarOsUseCase } from "./application/use-cases/listar-os.use-case";
import { TempoMedioServicosUseCase } from "./application/use-cases/tempo-medio-servicos.use-case";

const useCases = [
	CriarOsUseCase,
	ListarOsUseCase,
	BuscarOsUseCase,
	HistoricoOsUseCase,
	TempoMedioServicosUseCase,
	ConsultaAcompanhamentoOsUseCase,
	EntregarOsUseCase,
	CancelarOsUseCase,
];

@Module({
	imports: [ClientesModule, VeiculosModule, InsumosModule],
	controllers: [OrdensServicoController],
	providers: [
		...useCases,
		{ provide: ORDENS_SERVICO_GATEWAY, useClass: OrdensServicoPrismaGateway },
		{ provide: CLIENTES_CONSULTA, useClass: ClientesConsultaPrismaGateway },
		{ provide: VEICULOS_CONSULTA, useClass: VeiculosConsultaPrismaGateway },
		{ provide: NOTIFICADOR, useClass: SmtpNotificadorGateway },
	],
	exports: [ORDENS_SERVICO_GATEWAY, NOTIFICADOR],
})
export class OrdensServicoModule {}
