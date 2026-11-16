import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { workersHabilitados } from "../../mensageria/configuracao-mensageria";
import { ConsumidorSqs } from "../../mensageria/consumidor-sqs";
import { OrquestradorOrdemServico } from "../application/orquestrador-ordem-servico";

@Injectable()
export class WorkersOrquestracao implements OnApplicationBootstrap, OnApplicationShutdown {
	constructor(
		private readonly consumidor: ConsumidorSqs,
		private readonly orquestrador: OrquestradorOrdemServico,
	) {}

	onApplicationBootstrap(): void {
		if (!workersHabilitados()) return;
		const url = process.env.SQS_OS_ORQUESTRADOR_EVENTOS_URL;
		if (!url) throw new Error("SQS_OS_ORQUESTRADOR_EVENTOS_URL não definido");
		this.consumidor.iniciar(url, (envelope) => this.orquestrador.processarEvento(envelope), ["billing", "execution"]);
	}

	async onApplicationShutdown(): Promise<void> {
		await this.consumidor.parar();
	}
}
