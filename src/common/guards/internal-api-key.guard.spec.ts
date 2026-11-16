import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { INTERNAL_API_KEY_HEADER, InternalApiKeyGuard } from "./internal-api-key.guard";

const CHAVE = "chave-interna-de-teste-0123456789";

function contexto(headers: Record<string, unknown>): ExecutionContext {
	return {
		switchToHttp: () => ({ getRequest: () => ({ headers }) }),
	} as unknown as ExecutionContext;
}

describe("InternalApiKeyGuard", () => {
	const original = process.env.INTERNAL_API_KEY;
	let guard: InternalApiKeyGuard;

	beforeEach(() => {
		process.env.INTERNAL_API_KEY = CHAVE;
		guard = new InternalApiKeyGuard();
	});

	afterAll(() => {
		process.env.INTERNAL_API_KEY = original;
	});

	it("aceita a chave correta", () => {
		expect(guard.canActivate(contexto({ [INTERNAL_API_KEY_HEADER]: CHAVE }))).toBe(true);
	});

	it("401 sem header", () => {
		expect(() => guard.canActivate(contexto({}))).toThrow(UnauthorizedException);
	});

	it("401 com header vazio", () => {
		expect(() => guard.canActivate(contexto({ [INTERNAL_API_KEY_HEADER]: "" }))).toThrow(UnauthorizedException);
	});

	it("401 com header não-string (array)", () => {
		expect(() => guard.canActivate(contexto({ [INTERNAL_API_KEY_HEADER]: [CHAVE, CHAVE] }))).toThrow(UnauthorizedException);
	});

	it("401 com chave errada de mesmo tamanho", () => {
		const errada = CHAVE.slice(0, -1) + "X";
		expect(errada).toHaveLength(CHAVE.length);
		expect(() => guard.canActivate(contexto({ [INTERNAL_API_KEY_HEADER]: errada }))).toThrow(UnauthorizedException);
	});

	it("401 (nunca RangeError/500) com chave de tamanho diferente", () => {
		for (const tentativa of ["x", CHAVE + "a", CHAVE.repeat(3)]) {
			let erro: unknown;
			try {
				guard.canActivate(contexto({ [INTERNAL_API_KEY_HEADER]: tentativa }));
			} catch (e) {
				erro = e;
			}
			expect(erro).toBeInstanceOf(UnauthorizedException);
		}
	});

	it("401 quando INTERNAL_API_KEY não está configurada (falha fechada)", () => {
		delete process.env.INTERNAL_API_KEY;
		expect(() => guard.canActivate(contexto({ [INTERNAL_API_KEY_HEADER]: "qualquer" }))).toThrow(UnauthorizedException);
	});
});
