import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AuthenticatedCliente, CurrentCliente } from "./current-cliente.decorator";

const ROUTE_ARGS_METADATA = "__routeArguments__";

function extractFactory(): (data: unknown, ctx: ExecutionContext) => AuthenticatedCliente {
	class FakeCtrl {
		handle(@CurrentCliente() _: unknown) {
			return _;
		}
	}
	const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, FakeCtrl, "handle") as Record<string, any>;
	const entry = Object.values(meta).find((e: any) => e.factory);
	return entry.factory;
}

const contexto = (req: unknown) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

describe("CurrentCliente()", () => {
	it("retorna req.cliente quando o token de cliente foi validado", () => {
		const cliente: AuthenticatedCliente = { id: "c1", cpf: "52998224725", nome: "Fulano" };
		expect(extractFactory()(undefined, contexto({ cliente }))).toEqual(cliente);
	});

	it("401 quando a requisição não traz cliente autenticado", () => {
		expect(() => extractFactory()(undefined, contexto({}))).toThrow(UnauthorizedException);
	});
});
