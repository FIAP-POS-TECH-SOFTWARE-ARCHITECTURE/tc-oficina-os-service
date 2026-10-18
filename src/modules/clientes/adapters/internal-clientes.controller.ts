import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiEnvelopedResponse } from "../../../common/decorators/api-enveloped-response.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { INTERNAL_API_KEY_SECURITY, InternalApiKeyGuard } from "../../../common/guards/internal-api-key.guard";
import { BuscarClienteInternoUseCase } from "../application/use-cases/buscar-cliente-interno.use-case";
import { ClienteInternoResponseDto } from "../dto/cliente-interno-response.dto";

@ApiTags("Interno")
@ApiSecurity(INTERNAL_API_KEY_SECURITY)
@Public()
@UseGuards(InternalApiKeyGuard)
@Controller("internal/clientes")
export class InternalClientesController {
	constructor(private readonly buscarClienteInterno: BuscarClienteInternoUseCase) {}

	@Get("por-documento/:documento")
	@ApiOperation({ summary: "Resumo do cliente por CPF/CNPJ (somente dígitos) — uso serviço a serviço" })
	@ApiEnvelopedResponse(ClienteInternoResponseDto)
	porDocumento(@Param("documento") documento: string) {
		return this.buscarClienteInterno.execute(documento);
	}
}
