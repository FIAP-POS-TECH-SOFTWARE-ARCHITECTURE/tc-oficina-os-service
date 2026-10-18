import { Injectable } from "@nestjs/common";
import { Insumo, MovimentoEstoque, TipoMovimentoEstoque } from "@prisma/client";
import { PrismaService } from "../../../../prisma/prisma.service";
import { InsumosGatewayPort, MovimentoEstoqueDados } from "../../application/ports/insumos.gateway";

@Injectable()
export class InsumosPrismaGateway implements InsumosGatewayPort {
	constructor(private readonly prisma: PrismaService) {}

	criar(dados: {
		codigo: string;
		nome: string;
		descricao?: string;
		precoUnitario: number;
		estoqueMinimo: number;
		quantidadeEstoque: number;
	}): Promise<Insumo> {
		return this.prisma.insumo.create({ data: dados });
	}

	listarTodos(): Promise<Insumo[]> {
		return this.prisma.insumo.findMany({ orderBy: { nome: "asc" } });
	}

	buscarPorId(id: string): Promise<Insumo | null> {
		return this.prisma.insumo.findUnique({ where: { id } });
	}

	buscarPorCodigo(codigo: string): Promise<Insumo | null> {
		return this.prisma.insumo.findUnique({ where: { codigo } });
	}

	atualizar(
		id: string,
		dados: Partial<{ nome: string; descricao: string; precoUnitario: number; estoqueMinimo: number; ativo: boolean }>,
	): Promise<Insumo> {
		return this.prisma.insumo.update({ where: { id }, data: dados });
	}

	inativar(id: string): Promise<Insumo> {
		return this.prisma.insumo.update({ where: { id }, data: { ativo: false } });
	}

	listarEstoqueBaixo(): Promise<Insumo[]> {
		return this.prisma.insumo.findMany({
			where: {
				ativo: true,
				quantidadeEstoque: { lte: this.prisma.insumo.fields.estoqueMinimo },
			},
			orderBy: { nome: "asc" },
		});
	}

	listarMovimentos(insumoId: string): Promise<MovimentoEstoque[]> {
		return this.prisma.movimentoEstoque.findMany({
			where: { insumoId },
			orderBy: { createdAt: "desc" },
		});
	}

	// Soma atômica no banco: o saldo lido pelo caso de uso pode estar desatualizado por uma
	// reserva concorrente; anterior/posterior do movimento saem da linha já atualizada.
	registrarEntrada(dados: MovimentoEstoqueDados): Promise<Insumo> {
		return this.prisma.$transaction(async (tx) => {
			const u = await tx.insumo.update({
				where: { id: dados.insumoId },
				data: { quantidadeEstoque: { increment: dados.quantidade } },
			});
			await tx.movimentoEstoque.create({
				data: {
					insumoId: dados.insumoId,
					tipo: TipoMovimentoEstoque.ENTRADA,
					quantidade: dados.quantidade,
					quantidadeAnterior: u.quantidadeEstoque - dados.quantidade,
					quantidadePosterior: u.quantidadeEstoque,
					motivo: dados.motivo,
					usuarioId: dados.usuarioId,
				},
			});
			return u;
		});
	}

	registrarAjuste(dados: MovimentoEstoqueDados): Promise<Insumo> {
		return this.registrarMovimento(TipoMovimentoEstoque.AJUSTE, dados);
	}

	private registrarMovimento(tipo: TipoMovimentoEstoque, dados: MovimentoEstoqueDados): Promise<Insumo> {
		return this.prisma.$transaction(async (tx) => {
			const u = await tx.insumo.update({
				where: { id: dados.insumoId },
				data: { quantidadeEstoque: dados.quantidadePosterior },
			});
			await tx.movimentoEstoque.create({
				data: {
					insumoId: dados.insumoId,
					tipo,
					quantidade: dados.quantidade,
					quantidadeAnterior: dados.quantidadeAnterior,
					quantidadePosterior: dados.quantidadePosterior,
					motivo: dados.motivo,
					usuarioId: dados.usuarioId,
				},
			});
			return u;
		});
	}
}
