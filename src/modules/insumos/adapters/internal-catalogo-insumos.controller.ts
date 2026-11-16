import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiEnvelopedResponse } from "../../../common/decorators/api-enveloped-response.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { INTERNAL_API_KEY_SECURITY, InternalApiKeyGuard } from "../../../common/guards/internal-api-key.guard";
import { ListarCatalogoInsumosUseCase } from "../application/use-cases/listar-catalogo-insumos.use-case";
import { CatalogoInsumoResponseDto } from "../dto/catalogo-insumo-response.dto";

@ApiTags("Interno")
@ApiSecurity(INTERNAL_API_KEY_SECURITY)
@Public()
@UseGuards(InternalApiKeyGuard)
@Controller("internal/catalogo")
export class InternalCatalogoInsumosController {
	constructor(private readonly listarCatalogoInsumos: ListarCatalogoInsumosUseCase) {}

	@Get("insumos")
	@ApiOperation({ summary: "Catálogo de insumos ativos com preço em centavos e estoque — uso serviço a serviço" })
	@ApiEnvelopedResponse(CatalogoInsumoResponseDto, { isArray: true })
	insumos() {
		return this.listarCatalogoInsumos.execute();
	}
}
