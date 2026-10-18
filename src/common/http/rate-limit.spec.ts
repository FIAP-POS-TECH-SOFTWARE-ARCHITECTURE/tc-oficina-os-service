import { deveIgnorarRateLimit } from "./rate-limit";

describe("deveIgnorarRateLimit", () => {
	it.each(["/health", "/health/ready", "/internal/clientes/por-documento/52998224725", "/internal/catalogo/servicos"])(
		"ignora %s",
		(path) => {
			expect(deveIgnorarRateLimit(path)).toBe(true);
		},
	);

	it.each(["/os", "/clientes", "/auth/login", "/internals", "/healthz"])("aplica limite em %s", (path) => {
		expect(deveIgnorarRateLimit(path)).toBe(false);
	});
});
