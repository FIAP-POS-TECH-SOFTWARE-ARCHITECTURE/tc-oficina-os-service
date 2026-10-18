import { Injectable, Logger } from "@nestjs/common";
import { Prisma, TipoMovimentoEstoque } from "@prisma/client";
import { PrismaService } from "../../../../prisma/prisma.service";
import {
	ContextoTransacao,
	ItemReservaEstoque,
	ReservaEstoqueOsPort,
	ResultadoReservaEstoque,
} from "../../application/ports/reserva-estoque-os.gateway";

interface InsumoTravado {
	id: string;
	codigo: string;
	nome: string;
	quantidade_estoque: number;
	estoque_minimo: number;
	ativo: boolean;
}

@Injectable()
export class ReservaEstoqueOsPrismaGateway implements ReservaEstoqueOsPort {
	private readonly logger = new Logger(ReservaEstoqueOsPrismaGateway.name);

	constructor(private readonly prisma: PrismaService) {}

	reservar(
		params: { ordemServicoId: string; itens: ItemReservaEstoque[]; motivo: string; usuarioId: string | null },
		contexto?: ContextoTransacao,
	): Promise<ResultadoReservaEstoque> {
		return this.emTransacao(contexto, async (tx) => {
			await this.travarOs(tx, params.ordemServicoId);
			const saldo = await this.saldoReservado(tx, params.ordemServicoId);
			if ([...saldo.values()].some((q) => q > 0)) return { reservado: true, faltantes: [] };

			const pedidos = new Map<string, number>();
			for (const item of params.itens) pedidos.set(item.insumoId, (pedidos.get(item.insumoId) ?? 0) + item.quantidade);
			const ids = [...pedidos.keys()].sort();
			if (ids.length === 0) return { reservado: true, faltantes: [] };

			const travados = new Map((await this.travarInsumos(tx, ids)).map((i) => [i.id, i]));
			const faltantes: string[] = [];
			for (const id of ids) {
				const insumo = travados.get(id);
				const quantidade = pedidos.get(id) as number;
				if (!insumo) faltantes.push(`Insumo ${id} não encontrado`);
				else if (!insumo.ativo) faltantes.push(`${insumo.nome} inativo`);
				else if (insumo.quantidade_estoque < quantidade)
					faltantes.push(`${insumo.nome} (${insumo.quantidade_estoque} disponíveis, ${quantidade} requisitados)`);
			}
			if (faltantes.length > 0) return { reservado: false, faltantes };

			for (const id of ids) {
				const insumo = travados.get(id) as InsumoTravado;
				const quantidade = pedidos.get(id) as number;
				const posterior = insumo.quantidade_estoque - quantidade;
				await this.movimentar(tx, insumo, TipoMovimentoEstoque.SAIDA, quantidade, posterior, params);
				if (posterior < insumo.estoque_minimo)
					this.logger.warn(`Insumo ${insumo.codigo} ficou abaixo do estoque mínimo (${posterior}/${insumo.estoque_minimo})`);
			}
			return { reservado: true, faltantes: [] };
		});
	}

	estornar(
		params: { ordemServicoId: string; motivo: string; usuarioId: string | null },
		contexto?: ContextoTransacao,
	): Promise<{ insumosEstornados: number }> {
		return this.emTransacao(contexto, async (tx) => {
			await this.travarOs(tx, params.ordemServicoId);
			const saldo = await this.saldoReservado(tx, params.ordemServicoId);
			const ids = [...saldo.entries()]
				.filter(([, q]) => q > 0)
				.map(([id]) => id)
				.sort();
			if (ids.length === 0) return { insumosEstornados: 0 };

			for (const insumo of await this.travarInsumos(tx, ids)) {
				const quantidade = saldo.get(insumo.id) as number;
				await this.movimentar(tx, insumo, TipoMovimentoEstoque.ESTORNO, quantidade, insumo.quantidade_estoque + quantidade, params);
			}
			return { insumosEstornados: ids.length };
		});
	}

	private async movimentar(
		tx: Prisma.TransactionClient,
		insumo: InsumoTravado,
		tipo: TipoMovimentoEstoque,
		quantidade: number,
		posterior: number,
		params: { ordemServicoId: string; motivo: string; usuarioId: string | null },
	): Promise<void> {
		await tx.insumo.update({ where: { id: insumo.id }, data: { quantidadeEstoque: posterior } });
		await tx.movimentoEstoque.create({
			data: {
				insumoId: insumo.id,
				tipo,
				quantidade,
				quantidadeAnterior: insumo.quantidade_estoque,
				quantidadePosterior: posterior,
				ordemServicoId: params.ordemServicoId,
				motivo: params.motivo,
				usuarioId: params.usuarioId,
			},
		});
	}

	private emTransacao<T>(contexto: ContextoTransacao, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
		if (contexto) return fn(contexto as Prisma.TransactionClient);
		return this.prisma.$transaction(fn);
	}

	// Serializa reserva/estorno da mesma OS entre réplicas.
	private async travarOs(tx: Prisma.TransactionClient, ordemServicoId: string): Promise<void> {
		await tx.$queryRaw`SELECT id FROM ordens_servico WHERE id = ${ordemServicoId}::uuid FOR UPDATE`;
	}

	// Ordem fixa por id: duas transações nunca travam os mesmos insumos em ordem inversa.
	private travarInsumos(tx: Prisma.TransactionClient, ids: string[]): Promise<InsumoTravado[]> {
		return tx.$queryRaw<InsumoTravado[]>`
			SELECT id, codigo, nome, quantidade_estoque, estoque_minimo, ativo
			FROM insumos
			WHERE id = ANY(${ids}::uuid[])
			ORDER BY id
			FOR UPDATE
		`;
	}

	private async saldoReservado(tx: Prisma.TransactionClient, ordemServicoId: string): Promise<Map<string, number>> {
		const grupos = await tx.movimentoEstoque.groupBy({
			by: ["insumoId", "tipo"],
			where: { ordemServicoId, tipo: { in: [TipoMovimentoEstoque.SAIDA, TipoMovimentoEstoque.ESTORNO] } },
			_sum: { quantidade: true },
		});
		const saldo = new Map<string, number>();
		for (const g of grupos) {
			const sinal = g.tipo === TipoMovimentoEstoque.SAIDA ? 1 : -1;
			saldo.set(g.insumoId, (saldo.get(g.insumoId) ?? 0) + sinal * (g._sum.quantidade ?? 0));
		}
		return saldo;
	}
}
