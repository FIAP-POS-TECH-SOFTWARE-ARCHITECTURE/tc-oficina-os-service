import { Module } from "@nestjs/common";
import { FornecedorStubGateway } from "./adapters/gateways/fornecedor-stub.gateway";
import { InsumosPrismaGateway } from "./adapters/gateways/insumos.prisma.gateway";
import { RegistrosCompraPrismaGateway } from "./adapters/gateways/registros-compra.prisma.gateway";
import { ReservaEstoqueOsPrismaGateway } from "./adapters/gateways/reserva-estoque-os.prisma.gateway";
import { InsumosController } from "./adapters/insumos.controller";
import { InternalCatalogoInsumosController } from "./adapters/internal-catalogo-insumos.controller";
import { RegistrosCompraController } from "./adapters/registros-compra.controller";
import { FORNECEDOR } from "./application/ports/fornecedor.gateway";
import { INSUMOS_GATEWAY } from "./application/ports/insumos.gateway";
import { REGISTROS_COMPRA_GATEWAY } from "./application/ports/registros-compra.gateway";
import { RESERVA_ESTOQUE_OS } from "./application/ports/reserva-estoque-os.gateway";
import { AjustarEstoqueInsumoUseCase } from "./application/use-cases/ajustar-estoque-insumo.use-case";
import { AlertasEstoqueBaixoUseCase } from "./application/use-cases/alertas-estoque-baixo.use-case";
import { AtualizarInsumoUseCase } from "./application/use-cases/atualizar-insumo.use-case";
import { BuscarInsumoUseCase } from "./application/use-cases/buscar-insumo.use-case";
import { BuscarRegistroCompraUseCase } from "./application/use-cases/buscar-registro-compra.use-case";
import { CancelarRegistroCompraUseCase } from "./application/use-cases/cancelar-registro-compra.use-case";
import { CriarInsumoUseCase } from "./application/use-cases/criar-insumo.use-case";
import { CriarRegistroCompraUseCase } from "./application/use-cases/criar-registro-compra.use-case";
import { EnviarFornecedorUseCase } from "./application/use-cases/enviar-fornecedor.use-case";
import { InativarInsumoUseCase } from "./application/use-cases/inativar-insumo.use-case";
import { ListarCatalogoInsumosUseCase } from "./application/use-cases/listar-catalogo-insumos.use-case";
import { ListarInsumosUseCase } from "./application/use-cases/listar-insumos.use-case";
import { ListarMovimentosInsumoUseCase } from "./application/use-cases/listar-movimentos-insumo.use-case";
import { ListarRegistrosCompraUseCase } from "./application/use-cases/listar-registros-compra.use-case";
import { ReceberCompraUseCase } from "./application/use-cases/receber-compra.use-case";
import { RegistrarEntradaInsumoUseCase } from "./application/use-cases/registrar-entrada-insumo.use-case";
import { RegistrarRespostaFornecedorUseCase } from "./application/use-cases/registrar-resposta-fornecedor.use-case";

const useCases = [
	CriarInsumoUseCase,
	ListarInsumosUseCase,
	BuscarInsumoUseCase,
	AtualizarInsumoUseCase,
	InativarInsumoUseCase,
	RegistrarEntradaInsumoUseCase,
	AjustarEstoqueInsumoUseCase,
	ListarMovimentosInsumoUseCase,
	AlertasEstoqueBaixoUseCase,
	CriarRegistroCompraUseCase,
	ListarRegistrosCompraUseCase,
	BuscarRegistroCompraUseCase,
	EnviarFornecedorUseCase,
	RegistrarRespostaFornecedorUseCase,
	CancelarRegistroCompraUseCase,
	ReceberCompraUseCase,
	ListarCatalogoInsumosUseCase,
];

@Module({
	controllers: [RegistrosCompraController, InsumosController, InternalCatalogoInsumosController],
	providers: [
		...useCases,
		{ provide: INSUMOS_GATEWAY, useClass: InsumosPrismaGateway },
		{ provide: REGISTROS_COMPRA_GATEWAY, useClass: RegistrosCompraPrismaGateway },
		{ provide: FORNECEDOR, useClass: FornecedorStubGateway },
		{ provide: RESERVA_ESTOQUE_OS, useClass: ReservaEstoqueOsPrismaGateway },
	],
	exports: [INSUMOS_GATEWAY, RESERVA_ESTOQUE_OS],
})
export class InsumosModule {}
