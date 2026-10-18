import { Logger } from "@nestjs/common";
import { OsStatus as PrismaOsStatus, Prisma } from "@prisma/client";
import { OsStatus } from "../../domain/os-status";

export interface TransicaoHistoricoOs {
	ordemServicoId: string;
	numero?: string;
	statusAnterior: PrismaOsStatus | OsStatus | null;
	statusNovo: PrismaOsStatus | OsStatus;
	usuarioId?: string;
	observacao?: string;
}

/**
 * Grava a linha de histórico de uma transição de status e emite o evento
 * de negócio `os.status.changed` consumido pelos dashboards.
 *
 * `durationMs` = tempo (ms) que a OS passou no status anterior, medido a
 * partir do `createdAt` da linha de histórico imediatamente anterior. Quando
 * não existe linha anterior (primeira transição após a criação), assume 0.
 */
export async function registrarTransicaoOs(tx: Prisma.TransactionClient, logger: Logger, args: TransicaoHistoricoOs): Promise<void> {
	const anterior = await tx.osHistoricoStatus.findFirst({
		where: { ordemServicoId: args.ordemServicoId },
		orderBy: { createdAt: "desc" },
		select: { createdAt: true },
	});
	const durationMs = anterior ? Date.now() - anterior.createdAt.getTime() : 0;

	let numero = args.numero;
	if (!numero) {
		const os = await tx.ordemServico.findUnique({
			where: { id: args.ordemServicoId },
			select: { numero: true },
		});
		numero = os?.numero ?? undefined;
	}

	await tx.osHistoricoStatus.create({
		data: {
			ordemServicoId: args.ordemServicoId,
			statusAnterior: args.statusAnterior,
			statusNovo: args.statusNovo,
			usuarioId: args.usuarioId ?? undefined,
			observacao: args.observacao ?? undefined,
		},
	});

	// Emitido dentro da transação: é a última instrução antes do commit nos
	// chamadores, então a janela pra um rollback posterior é mínima. O
	// trade-off aceito é um evento eventualmente órfão em caso de rollback,
	// preferível a perder o evento se o log falhasse fora da transação.
	logger.log(
		{
			event: "os.status.changed",
			osId: args.ordemServicoId,
			numero,
			fromStatus: args.statusAnterior,
			toStatus: args.statusNovo,
			durationMs,
		},
		"OrdensServicoPrismaGateway",
	);
}
