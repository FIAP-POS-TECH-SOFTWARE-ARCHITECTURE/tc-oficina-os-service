import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiEnvelopedResponse } from "../../../common/decorators/api-enveloped-response.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { INTERNAL_API_KEY_SECURITY, InternalApiKeyGuard } from "../../../common/guards/internal-api-key.guard";
import { ListarCatalogoServicosUseCase } from "../application/use-cases/listar-catalogo-servicos.use-case";
import { CatalogoServicoResponseDto } from "../dto/catalogo-servico-response.dto";

@ApiTags("Interno")
@ApiSecurity(INTERNAL_API_KEY_SECURITY)
@Public()
@UseGuards(InternalApiKeyGuard)
@Controller("internal/catalogo")
export class InternalCatalogoServicosController {
	constructor(private readonly listarCatalogoServicos: ListarCatalogoServicosUseCase) {}

	@Get("servicos")
	@ApiOperation({ summary: "Catálogo de serviços ativos com preço em centavos — uso serviço a serviço" })
	@ApiEnvelopedResponse(CatalogoServicoResponseDto, { isArray: true })
	servicos() {
		return this.listarCatalogoServicos.execute();
	}
}
