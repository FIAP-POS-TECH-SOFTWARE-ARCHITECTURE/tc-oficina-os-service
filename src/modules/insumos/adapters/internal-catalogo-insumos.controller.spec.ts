import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { InternalApiKeyGuard } from "../../../common/guards/internal-api-key.guard";
import { InternalCatalogoInsumosController } from "./internal-catalogo-insumos.controller";

describe("InternalCatalogoInsumosController", () => {
	const uc = { execute: jest.fn().mockResolvedValue({ status: 200, data: [] }) };

	it("insumos delega ao use case", async () => {
		await new InternalCatalogoInsumosController(uc as any).insumos();
		expect(uc.execute).toHaveBeenCalled();
	});

	it("prefixo internal/catalogo, @Public() e InternalApiKeyGuard", () => {
		expect(Reflect.getMetadata(PATH_METADATA, InternalCatalogoInsumosController)).toBe("internal/catalogo");
		expect(Reflect.getMetadata(IS_PUBLIC_KEY, InternalCatalogoInsumosController)).toBe(true);
		expect(Reflect.getMetadata(GUARDS_METADATA, InternalCatalogoInsumosController)).toEqual([InternalApiKeyGuard]);
	});
});
