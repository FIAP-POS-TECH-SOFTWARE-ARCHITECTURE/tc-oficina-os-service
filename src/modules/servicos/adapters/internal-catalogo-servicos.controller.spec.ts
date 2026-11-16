import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { InternalApiKeyGuard } from "../../../common/guards/internal-api-key.guard";
import { InternalCatalogoServicosController } from "./internal-catalogo-servicos.controller";

describe("InternalCatalogoServicosController", () => {
	const uc = { execute: jest.fn().mockResolvedValue({ status: 200, data: [] }) };

	it("servicos delega ao use case", async () => {
		await new InternalCatalogoServicosController(uc as any).servicos();
		expect(uc.execute).toHaveBeenCalled();
	});

	it("prefixo internal/catalogo, @Public() e InternalApiKeyGuard", () => {
		expect(Reflect.getMetadata(PATH_METADATA, InternalCatalogoServicosController)).toBe("internal/catalogo");
		expect(Reflect.getMetadata(IS_PUBLIC_KEY, InternalCatalogoServicosController)).toBe(true);
		expect(Reflect.getMetadata(GUARDS_METADATA, InternalCatalogoServicosController)).toEqual([InternalApiKeyGuard]);
	});
});
