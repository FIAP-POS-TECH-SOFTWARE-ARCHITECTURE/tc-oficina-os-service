import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ApiEnvelopedResponse } from "../../../common/decorators/api-enveloped-response.decorator";
import { ClienteAuth } from "../../../common/decorators/cliente-auth.decorator";
import { CurrentCliente } from "../../../common/decorators/current-cliente.decorator";
import type { AuthenticatedCliente } from "../../../common/decorators/current-cliente.decorator";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../../common/decorators/current-user.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { Role } from "../../../common/enums/role.enum";
import { CreateOsDto } from "../dto/create-os.dto";
import { ListarOsDto } from "../dto/listar-os.dto";
import { MetricasTempoMedioDto } from "../dto/metricas-tempo-medio.dto";
import { OsConsultaPublicaResponseDto, OsResponseDto } from "../dto/os-response.dto";
import { TempoMedioServicoResponseDto } from "../dto/tempo-medio-servico-response.dto";
import { CancelarOsDto } from "../dto/transicao.dto";
import { OsStatus } from "../domain/os-status";
import { BuscarOsUseCase } from "../application/use-cases/buscar-os.use-case";
import { CancelarOsUseCase } from "../application/use-cases/cancelar-os.use-case";
import { ConsultaAcompanhamentoOsUseCase } from "../application/use-cases/consulta-publica-os.use-case";
import { CriarOsUseCase } from "../application/use-cases/criar-os.use-case";
import { EntregarOsUseCase } from "../application/use-cases/entregar-os.use-case";
import { HistoricoOsUseCase } from "../application/use-cases/historico-os.use-case";
import { ListarOsUseCase } from "../application/use-cases/listar-os.use-case";
import { TempoMedioServicosUseCase } from "../application/use-cases/tempo-medio-servicos.use-case";

@ApiTags("Ordens de Serviço")
@ApiBearerAuth()
@Controller("os")
export class OrdensServicoController {
	constructor(
		private readonly criarOs: CriarOsUseCase,
		private readonly listarOs: ListarOsUseCase,
		private readonly buscarOs: BuscarOsUseCase,
		private readonly historicoOs: HistoricoOsUseCase,
		private readonly tempoMedioServicos: TempoMedioServicosUseCase,
		private readonly consultaAcompanhamentoOs: ConsultaAcompanhamentoOsUseCase,
		private readonly entregarOs: EntregarOsUseCase,
		private readonly cancelarOs: CancelarOsUseCase,
	) {}

	@Post()
	@Roles(Role.ATENDENTE, Role.ADMINISTRADOR)
	@ApiOperation({ summary: "Criar uma nova Ordem de Serviço" })
	@ApiEnvelopedResponse(OsResponseDto, { status: 201 })
	create(@Body() dto: CreateOsDto) {
		return this.criarOs.execute(dto);
	}

	@Get()
	@Roles(Role.ATENDENTE, Role.ADMINISTRADOR)
	@ApiOperation({ summary: "Listar Ordens de Serviço com filtros" })
	@ApiEnvelopedResponse(OsResponseDto, { isArray: true })
	list(@Query() query: ListarOsDto) {
		// Fronteira adapter → aplicação: enums Prisma e de domínio têm valores string idênticos
		return this.listarOs.execute({ ...query, status: query.status as OsStatus | undefined });
	}

	@Get(":id/historico")
	@Roles(Role.ATENDENTE, Role.ADMINISTRADOR, Role.MECANICO)
	@ApiOperation({ summary: "Obter histórico de status da OS" })
	@ApiEnvelopedResponse(undefined, { isArray: true })
	obterHistorico(@Param("id", ParseUUIDPipe) id: string) {
		return this.historicoOs.execute(id);
	}

	@Get("metricas/tempo-medio")
	@Roles(Role.ADMINISTRADOR)
	@ApiOperation({ summary: "Tempo médio de execução por serviço (Somente Admin)" })
	@ApiEnvelopedResponse(TempoMedioServicoResponseDto, { isArray: true })
	metricas(@Query() query: MetricasTempoMedioDto) {
		return this.tempoMedioServicos.execute(query.filtro);
	}

	@ClienteAuth()
	@Get("acompanhamento/:numero")
	@ApiBearerAuth()
	@ApiOperation({ summary: "Acompanhamento da OS pelo cliente autenticado (token via CPF)" })
	@ApiEnvelopedResponse(OsConsultaPublicaResponseDto)
	acompanhamento(@Param("numero") numero: string, @CurrentCliente() cliente: AuthenticatedCliente) {
		return this.consultaAcompanhamentoOs.execute(numero, cliente.id);
	}

	@Get(":id")
	@Roles(Role.ATENDENTE, Role.ADMINISTRADOR, Role.MECANICO)
	@ApiOperation({ summary: "Buscar detalhes de uma OS por ID" })
	@ApiEnvelopedResponse(OsResponseDto)
	findOne(@Param("id", ParseUUIDPipe) id: string) {
		return this.buscarOs.execute(id);
	}

	@Post(":id/entregar")
	@Roles(Role.ATENDENTE, Role.ADMINISTRADOR)
	@ApiOperation({ summary: "Registrar entrega do veículo ao cliente" })
	@ApiEnvelopedResponse(OsResponseDto)
	entregar(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
		return this.entregarOs.execute(id, user.id);
	}

	@Post(":id/cancelar")
	@Roles(Role.ADMINISTRADOR)
	@ApiOperation({ summary: "Cancelar OS (Somente Admin)" })
	@ApiEnvelopedResponse(OsResponseDto)
	cancelar(@Param("id", ParseUUIDPipe) id: string, @Body() dto: CancelarOsDto, @CurrentUser() user: AuthenticatedUser) {
		return this.cancelarOs.execute(id, user.id, dto);
	}
}
