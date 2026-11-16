import { Module } from "@nestjs/common";
import { InsumosModule } from "../insumos/insumos.module";
import { MensageriaModule } from "../mensageria/mensageria.module";
import { SmtpNotificadorGateway } from "../ordens-servico/adapters/gateways/notificador.smtp.gateway";
import { NOTIFICADOR } from "../ordens-servico/application/ports/notificador.gateway";
import { FluxoOrdemServicoPrismaGateway } from "./adapters/gateways/fluxo-ordem-servico.prisma.gateway";
import { JobPrazosFluxo } from "./adapters/job-prazos-fluxo";
import { OrquestracaoController } from "./adapters/orquestracao.controller";
import { WorkersOrquestracao } from "./adapters/workers-orquestracao";
import { OrquestradorOrdemServico } from "./application/orquestrador-ordem-servico";
import { REPOSITORIO_FLUXO } from "./application/ports/repositorio-fluxo.gateway";
import { lerPrazos, PRAZOS_FLUXO } from "./domain/prazos-fluxo";

// Não importa OrdensServicoModule (ele é que importa este): o notificador entra pela classe, sem ciclo.
@Module({
	imports: [MensageriaModule, InsumosModule],
	controllers: [OrquestracaoController],
	providers: [
		OrquestradorOrdemServico,
		{ provide: REPOSITORIO_FLUXO, useClass: FluxoOrdemServicoPrismaGateway },
		{ provide: PRAZOS_FLUXO, useFactory: () => lerPrazos(process.env) },
		{ provide: NOTIFICADOR, useClass: SmtpNotificadorGateway },
		JobPrazosFluxo,
		WorkersOrquestracao,
	],
	exports: [OrquestradorOrdemServico],
})
export class OrquestracaoOsModule {}
