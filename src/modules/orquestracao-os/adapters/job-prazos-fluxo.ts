import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { workersHabilitados } from "../../mensageria/configuracao-mensageria";
import { OrquestradorOrdemServico } from "../application/orquestrador-ordem-servico";

// Roda em todas as réplicas: cada fluxo é decidido sob lock e com o prazo relido, então a segunda réplica só ignora.
@Injectable()
export class JobPrazosFluxo {
	private readonly logger = new Logger(JobPrazosFluxo.name);
	private emExecucao = false;

	constructor(private readonly orquestrador: OrquestradorOrdemServico) {}

	@Cron(CronExpression.EVERY_MINUTE)
	async executar(): Promise<void> {
		if (!workersHabilitados() || this.emExecucao) return;
		this.emExecucao = true;
		try {
			await this.orquestrador.verificarPrazos(new Date());
		} catch (error) {
			this.logger.error({ event: "fluxo.job_prazos_falhou", erro: (error as Error).message });
		} finally {
			this.emExecucao = false;
		}
	}
}
