import { INestApplication } from "@nestjs/common";
import { configurarRoteamento } from "./roteamento";

describe("configurarRoteamento", () => {
	it("liga case sensitive routing na aplicação e no router já criado pelo adapter", () => {
		const instancia = { set: jest.fn(), router: { caseSensitive: false } };
		const app = { getHttpAdapter: () => ({ getInstance: () => instancia }) } as unknown as INestApplication;

		configurarRoteamento(app);

		expect(instancia.set).toHaveBeenCalledWith("case sensitive routing", true);
		expect(instancia.router.caseSensitive).toBe(true);
	});
});
