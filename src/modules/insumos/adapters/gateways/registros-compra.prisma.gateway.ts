import { Injectable } from "@nestjs/common";
import { Prisma, RegistroCompra, RegistroCompraStatus, TipoMovimentoEstoque } from "@prisma/client";
import { PrismaService } from "../../../../prisma/prisma.service";
import {
	AtualizacaoRegistroCompra,
	RecebimentoCompraDados,
	RegistrosCompraGatewayPort,
} from "../../application/ports/registros-compra.gateway";

const REGISTRO_COMPRA_INCLUDE = {
	insumo: true,
	ordemServico: true,
	solicitadoPor: true,
	recebidoPor: true,
} satisfies Prisma.RegistroCompraInclude;

@Injectable()
export class RegistrosCompraPrismaGateway implements RegistrosCompraGatewayPort {
	constructor(private readonly prisma: PrismaService) {}

	criar(dados: {
		insumoId: string;
		quantidadeSolicitada: number;
		solicitadoPorId: string;
		ordemServicoId?: string;
	}): Promise<RegistroCompra> {
		return this.prisma.registroCompra.create({
			data: {
				quantidadeSolicitada: dados.quantidadeSolicitada,
				insumo: { connect: { id: dados.insumoId } },
				solicitadoPor: { connect: { id: dados.solicitadoPorId } },
				ordemServico: dados.ordemServicoId ? { connect: { id: dados.ordemServicoId } } : undefined,
			},
		});
	}

	listarTodos() {
		return this.prisma.registroCompra.findMany({
			orderBy: { createdAt: "desc" },
			include: REGISTRO_COMPRA_INCLUDE,
		});
	}

	buscarPorId(id: string): Promise<RegistroCompra | null> {
		return this.prisma.registroCompra.findUnique({ where: { id } });
	}

	buscarDetalhePorId(id: string) {
		return this.prisma.registroCompra.findUnique({
			where: { id },
			include: REGISTRO_COMPRA_INCLUDE,
		});
	}

	atualizar(id: string, dados: AtualizacaoRegistroCompra): Promise<RegistroCompra> {
		return this.prisma.registroCompra.update({
			where: { id },
			data: dados as Prisma.RegistroCompraUpdateInput,
		});
	}

	async ordemServicoExiste(ordemServicoId: string): Promise<boolean> {
		const os = await this.prisma.ordemServico.findUnique({ where: { id: ordemServicoId } });
		return os !== null;
	}

	async receberComEntradaEstoque(dados: RecebimentoCompraDados): Promise<void> {
		await this.prisma.$transaction(async (tx) => {
			const insumo = await tx.insumo.findUnique({ where: { id: dados.insumoId } });
			if (!insumo) throw new Error(`Insumo ${dados.insumoId} não encontrado`);

			// Soma atômica: uma reserva concorrente pode ter mudado o saldo depois da leitura acima.
			const atualizado = await tx.insumo.update({
				where: { id: insumo.id },
				data: { quantidadeEstoque: { increment: dados.quantidade } },
			});
			const posterior = atualizado.quantidadeEstoque;
			const anterior = posterior - dados.quantidade;

			await tx.movimentoEstoque.create({
				data: {
					insumoId: insumo.id,
					tipo: TipoMovimentoEstoque.ENTRADA,
					quantidade: dados.quantidade,
					quantidadeAnterior: anterior,
					quantidadePosterior: posterior,
					motivo: dados.motivo,
					usuarioId: dados.usuarioId,
				},
			});

			await tx.registroCompra.update({
				where: { id: dados.registroId },
				data: {
					status: RegistroCompraStatus.RECEBIDO,
					recebidoEm: new Date(),
					recebidoPorId: dados.usuarioId,
					notaFiscalNumero: dados.notaFiscal.numero,
					notaFiscalChave: dados.notaFiscal.chave,
					notaFiscalArquivoNome: dados.notaFiscal.arquivoNome,
					notaFiscalArquivoTipo: dados.notaFiscal.arquivoTipo,
					notaFiscalArquivoTamanho: dados.notaFiscal.arquivoTamanho,
					notaFiscalArquivoUrl: dados.notaFiscal.arquivoUrl,
				},
			});
		});
	}
}
