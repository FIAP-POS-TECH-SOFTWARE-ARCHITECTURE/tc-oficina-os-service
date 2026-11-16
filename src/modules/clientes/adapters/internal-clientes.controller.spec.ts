import { GUARDS_METADATA } from "@nestjs/common/constants";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { InternalApiKeyGuard } from "../../../common/guards/internal-api-key.guard";
import { InternalClientesController } from "./internal-clientes.controller";

describe("InternalClientesController", () => {
	const uc = { execute: jest.fn().mockResolvedValue({ status: 200 }) };
	const controller = new InternalClientesController(uc as any);

	it("porDocumento delega ao use case", async () => {
		await controller.porDocumento("52998224725");
		expect(uc.execute).toHaveBeenCalledWith("52998224725");
	});

	it("é @Public() (sem JWT) e protegido por InternalApiKeyGuard", () => {
		expect(Reflect.getMetadata(IS_PUBLIC_KEY, InternalClientesController)).toBe(true);
		expect(Reflect.getMetadata(GUARDS_METADATA, InternalClientesController)).toEqual([InternalApiKeyGuard]);
	});
});
