import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { setupApp } from "./helpers/app-factory";
import { bearer, loginAs } from "./helpers/auth";
import { truncateAll } from "./helpers/db";
import { CPF_VALIDOS, createCliente, createInsumo, createServico } from "./helpers/factories";

const CHAVE = process.env.INTERNAL_API_KEY as string;

describe("Rotas internas (e2e)", () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let adminToken: string;

	beforeAll(async () => {
		app = await setupApp();
		prisma = app.get(PrismaService);
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(async () => {
		await truncateAll(prisma);
		adminToken = (await loginAs(app, prisma, Role.ADMINISTRADOR)).token;
	});

	it("a chave de teste está configurada", () => {
		expect(CHAVE).toBeTruthy();
	});

	it("GET /internal/clientes/por-documento/:documento com chave → 200 { id, nome, ativo }", async () => {
		const cliente = await createCliente(app, adminToken, { documento: CPF_VALIDOS[1], nome: "Maria Souza" });

		const res = await request(app.getHttpServer())
			.get(`/internal/clientes/por-documento/${CPF_VALIDOS[1]}`)
			.set("x-internal-api-key", CHAVE);

		expect(res.status).toBe(200);
		expect(res.body.data).toEqual({ id: cliente.id, nome: "Maria Souza", ativo: true });
	});

	it("sem chave → 401; chave errada → 401; chave de outro tamanho → 401", async () => {
		const url = `/internal/clientes/por-documento/${CPF_VALIDOS[1]}`;
		expect((await request(app.getHttpServer()).get(url)).status).toBe(401);
		expect((await request(app.getHttpServer()).get(url).set("x-internal-api-key", CHAVE.replace(/.$/, "#"))).status).toBe(401);
		expect((await request(app.getHttpServer()).get(url).set("x-internal-api-key", "curta")).status).toBe(401);
	});

	it("JWT de staff sem chave não abre rota interna", async () => {
		const res = await request(app.getHttpServer())
			.get(`/internal/clientes/por-documento/${CPF_VALIDOS[1]}`)
			.set("Authorization", bearer(adminToken));
		expect(res.status).toBe(401);
	});

	it("documento inexistente → 404; com máscara → 400", async () => {
		const naoExiste = await request(app.getHttpServer())
			.get("/internal/clientes/por-documento/39053344705")
			.set("x-internal-api-key", CHAVE);
		expect(naoExiste.status).toBe(404);
		const mascarado = await request(app.getHttpServer())
			.get("/internal/clientes/por-documento/529.982.247-25")
			.set("x-internal-api-key", CHAVE);
		expect(mascarado.status).toBe(400);
	});

	it("GET /internal/catalogo/servicos → só ativos, preço em centavos", async () => {
		const ativo = await createServico(app, adminToken, { nome: "Alinhamento", preco: 19.99, tempoEstimadoMin: 30 });
		const inativo = await createServico(app, adminToken, { nome: "Descontinuado", preco: 10 });
		await request(app.getHttpServer()).delete(`/servicos/${inativo.id}`).set("Authorization", bearer(adminToken));

		const res = await request(app.getHttpServer()).get("/internal/catalogo/servicos").set("x-internal-api-key", CHAVE);

		expect(res.status).toBe(200);
		expect(res.body.data).toEqual([{ id: ativo.id, nome: "Alinhamento", descricao: null, precoCentavos: 1999, tempoEstimadoMin: 30 }]);
	});

	it("variação de caixa no path não alcança o controller interno", async () => {
		const maiusculo = await request(app.getHttpServer()).get("/INTERNAL/catalogo/servicos").set("x-internal-api-key", CHAVE);
		expect(maiusculo.status).toBe(404);
		const misto = await request(app.getHttpServer()).get("/internal/Catalogo/servicos").set("x-internal-api-key", CHAVE);
		expect(misto.status).toBe(404);
	});

	it("GET /internal/catalogo/insumos → precoCentavos e quantidadeEstoque", async () => {
		const insumo = await createInsumo(app, adminToken, {
			codigo: "OL-5W30",
			nome: "Óleo 5W30",
			precoUnitario: 45,
			quantidadeEstoque: 12,
		});

		const res = await request(app.getHttpServer()).get("/internal/catalogo/insumos").set("x-internal-api-key", CHAVE);

		expect(res.status).toBe(200);
		expect(res.body.data).toEqual([
			{ id: insumo.id, codigo: "OL-5W30", nome: "Óleo 5W30", precoCentavos: 4500, quantidadeEstoque: 12 },
		]);
	});
});
