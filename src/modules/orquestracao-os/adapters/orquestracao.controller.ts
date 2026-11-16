import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ApiEnvelopedResponse } from "../../../common/decorators/api-enveloped-response.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { Role } from "../../../common/enums/role.enum";
import { SR } from "../../../common/utils/service-response.util";
import { OrquestradorOrdemServico, ResultadoComandoFluxo } from "../application/orquestrador-ordem-servico";
import { CompensarFluxoDto } from "../dto/compensar-fluxo.dto";
import { FluxoResponseDto } from "../dto/fluxo-response.dto";

@ApiTags("Orquestração")
@ApiBearerAuth()
@Controller("orquestracao/fluxos")
export class OrquestracaoController {
	constructor(private readonly orquestrador: OrquestradorOrdemServico) {}

	@Get(":osId")
	@Roles(Role.ADMINISTRADOR)
	@ApiOperation({ summary: "Estado do fluxo da OS, compensações e mensagens trocadas" })
	@ApiEnvelopedResponse(FluxoResponseDto)
	async consultar(@Param("osId", ParseUUIDPipe) osId: string) {
		const r = await this.orquestrador.consultarPorOs(osId);
		return r ? SR.ok(r) : SR.notFound(undefined, "Fluxo não encontrado para a OS");
	}

	@Post(":fluxoId/reprocessar")
	@Roles(Role.ADMINISTRADOR)
	@ApiOperation({ summary: "Reenvia o comando pendente (messageId novo) de um fluxo em FALHA_TECNICA" })
	@ApiEnvelopedResponse(FluxoResponseDto)
	async reprocessar(@Param("fluxoId", ParseUUIDPipe) fluxoId: string) {
		return this.responder(await this.orquestrador.reprocessar(fluxoId));
	}

	@Post(":fluxoId/compensar")
	@Roles(Role.ADMINISTRADOR)
	@ApiOperation({ summary: "Dispara as compensações de um fluxo em FALHA_TECNICA" })
	@ApiEnvelopedResponse(FluxoResponseDto)
	async compensar(@Param("fluxoId", ParseUUIDPipe) fluxoId: string, @Body() dto: CompensarFluxoDto) {
		return this.responder(
			await this.orquestrador.compensar(fluxoId, dto.motivo?.trim() || "Compensação solicitada pelo administrador"),
		);
	}

	private responder(r: ResultadoComandoFluxo) {
		if (!r.encontrado) return SR.notFound(undefined, "Fluxo não encontrado");
		if (!r.aplicado) return SR.unprocessableEntity(undefined, `Operação recusada: ${r.motivo}`);
		return SR.ok(r.fluxo, r.motivo);
	}
}
