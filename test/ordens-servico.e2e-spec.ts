import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import { OsStatus } from "../src/modules/ordens-servico/domain/os-status";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { setupApp } from "./helpers/app-factory";
import { bearer, loginAs, signClienteToken } from "./helpers/auth";
import { truncateAll } from "./helpers/db";
import { CPF_VALIDOS, createCliente, createOS, createVeiculo, forcarStatusOs, nextPlaca } from "./helpers/factories";

describe("Ordens de Serviço (e2e) - endpoints individuais", () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let atendenteToken: string;
	let adminToken: string;
	let mecanicoToken: string;

	beforeAll(async () => {
		app = await setupApp();
		prisma = app.get(PrismaService);
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(async () => {
		await truncateAll(prisma);
		atendenteToken = (await loginAs(app, prisma, Role.ATENDENTE)).token;
		adminToken = (await loginAs(app, prisma, Role.ADMINISTRADOR)).token;
		mecanicoToken = (await loginAs(app, prisma, Role.MECANICO)).token;
	});

	async function setupClienteVeiculo(documento = CPF_VALIDOS[0]) {
		const cliente = await createCliente(app, atendenteToken, { documento });
		const veiculo = await createVeiculo(app, atendenteToken, cliente.id);
		return { cliente, veiculo };
	}

	it("POST /os (atendente) happy → 201, status RECEBIDA, número OS-YYYY-XXXXXX", async () => {
		const { cliente, veiculo } = await setupClienteVeiculo();
		const res = await request(app.getHttpServer())
			.post("/os")
			.set("Authorization", bearer(atendenteToken))
			.send({ clienteId: cliente.id, veiculoId: veiculo.id });
		expect(res.status).toBe(201);
		expect(res.body.data.status).toBe("RECEBIDA");
		expect(res.body.data.numero).toMatch(/^OS-\d{4}-\d{6}$/);
	});

	it("POST /os cliente inexistente → 404", async () => {
		const { veiculo } = await setupClienteVeiculo();
		const res = await request(app.getHttpServer())
			.post("/os")
			.set("Authorization", bearer(atendenteToken))
			.send({ clienteId: "00000000-0000-4000-8000-000000000000", veiculoId: veiculo.id });
		expect(res.status).toBe(404);
	});

	it("POST /os veículo de outro cliente → 400", async () => {
		const { cliente: c1 } = await setupClienteVeiculo(CPF_VALIDOS[0]);
		const c2 = await createCliente(app, atendenteToken, { documento: CPF_VALIDOS[1] });
		const v2 = await createVeiculo(app, atendenteToken, c2.id, { placa: nextPlaca() });

		const res = await request(app.getHttpServer())
			.post("/os")
			.set("Authorization", bearer(atendenteToken))
			.send({ clienteId: c1.id, veiculoId: v2.id });
		expect(res.status).toBe(400);
	});

	it("POST /os (mecânico) → 403", async () => {
		const { cliente, veiculo } = await setupClienteVeiculo();
		const res = await request(app.getHttpServer())
			.post("/os")
			.set("Authorization", bearer(mecanicoToken))
			.send({ clienteId: cliente.id, veiculoId: veiculo.id });
		expect(res.status).toBe(403);
	});

	it("GET /os com filtros (status, page, pageSize) → 200, paginação correta", async () => {
		const { cliente, veiculo } = await setupClienteVeiculo();
		await createOS(app, atendenteToken, cliente.id, veiculo.id);
		const res = await request(app.getHttpServer())
			.get("/os?status=RECEBIDA&page=1&pageSize=10")
			.set("Authorization", bearer(atendenteToken));
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({ page: 1, pageSize: 10 });
		expect(Array.isArray(res.body.data.items)).toBe(true);
	});

	it("GET /os/metricas/tempo-medio (admin) → 200", async () => {
		const res = await request(app.getHttpServer()).get("/os/metricas/tempo-medio").set("Authorization", bearer(adminToken));
		expect(res.status).toBe(200);
	});

	it("GET /os/metricas/tempo-medio (atendente) → 403", async () => {
		const res = await request(app.getHttpServer()).get("/os/metricas/tempo-medio").set("Authorization", bearer(atendenteToken));
		expect(res.status).toBe(403);
	});

	it("GET /os/acompanhamento/:numero com token do dono → 200, sem dados sensíveis", async () => {
		const { cliente, veiculo } = await setupClienteVeiculo();
		const os = await createOS(app, atendenteToken, cliente.id, veiculo.id);
		const res = await request(app.getHttpServer())
			.get(`/os/acompanhamento/${os.numero}`)
			.set("Authorization", bearer(signClienteToken(app, cliente.id)));
		expect(res.status).toBe(200);
		expect(res.body.data.numero).toBe(os.numero);
		expect(res.body.data.cliente).not.toBe(cliente.nome);
	});

	it("GET /os/acompanhamento/:numero sem token → 401", async () => {
		const { cliente, veiculo } = await setupClienteVeiculo();
		const os = await createOS(app, atendenteToken, cliente.id, veiculo.id);
		const res = await request(app.getHttpServer()).get(`/os/acompanhamento/${os.numero}`);
		expect(res.status).toBe(401);
	});

	it("GET /os/acompanhamento/:numero com token de outro cliente → 403", async () => {
		const { cliente, veiculo } = await setupClienteVeiculo(CPF_VALIDOS[0]);
		const os = await createOS(app, atendenteToken, cliente.id, veiculo.id);
		const outro = await createCliente(app, atendenteToken, { documento: CPF_VALIDOS[1] });
		const res = await request(app.getHttpServer())
			.get(`/os/acompanhamento/${os.numero}`)
			.set("Authorization", bearer(signClienteToken(app, outro.id)));
		expect(res.status).toBe(403);
	});

	it("GET /os/acompanhamento/:numero número inexistente → 404", async () => {
		const cliente = await createCliente(app, atendenteToken, { documento: CPF_VALIDOS[0] });
		const res = await request(app.getHttpServer())
			.get("/os/acompanhamento/OS-9999-999999")
			.set("Authorization", bearer(signClienteToken(app, cliente.id)));
		expect(res.status).toBe(404);
	});

	it("GET /os/:id (mecânico) → 200", async () => {
		const { cliente, veiculo } = await setupClienteVeiculo();
		const os = await createOS(app, atendenteToken, cliente.id, veiculo.id);
		const res = await request(app.getHttpServer()).get(`/os/${os.id}`).set("Authorization", bearer(mecanicoToken));
		expect(res.status).toBe(200);
	});

	it.each([
		["POST", "/os/:id/orcamento/gerar"],
		["POST", "/os/:id/diagnostico/iniciar"],
		["POST", "/os/:id/finalizar"],
		["POST", "/os/:numero/orcamento/aprovar"],
	])("%s %s não existe mais no OS → 404", async (_metodo, rota) => {
		const { cliente, veiculo } = await setupClienteVeiculo();
		const os = await createOS(app, atendenteToken, cliente.id, veiculo.id);
		const url = rota.replace(":id", os.id).replace(":numero", os.numero);
		const res = await request(app.getHttpServer()).post(url).set("Authorization", bearer(adminToken)).send({});
		expect(res.status).toBe(404);
	});

	it("GET /os/:id/historico (atendente) → 200, registra mudanças de status", async () => {
		const { cliente, veiculo } = await setupClienteVeiculo();
		const os = await createOS(app, atendenteToken, cliente.id, veiculo.id);
		await forcarStatusOs(prisma, os.id, OsStatus.FINALIZADA);
		const entrega = await request(app.getHttpServer()).post(`/os/${os.id}/entregar`).set("Authorization", bearer(atendenteToken));
		expect(entrega.status).toBe(200);

		const res = await request(app.getHttpServer()).get(`/os/${os.id}/historico`).set("Authorization", bearer(atendenteToken));
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body.data)).toBe(true);
		expect(res.body.data.map((h: any) => h.statusNovo)).toContain(OsStatus.ENTREGUE);
	});

	it("GET /os/:id/historico OS inexistente → 404", async () => {
		const res = await request(app.getHttpServer())
			.get("/os/00000000-0000-4000-8000-000000000000/historico")
			.set("Authorization", bearer(atendenteToken));
		expect(res.status).toBe(404);
	});

	it("GET /os paginação → página 2 com pageSize=1 retorna segundo registro", async () => {
		const { cliente, veiculo } = await setupClienteVeiculo();
		const veiculo2 = await request(app.getHttpServer())
			.post(`/clientes/${cliente.id}/veiculos`)
			.set("Authorization", bearer(atendenteToken))
			.send({ placa: nextPlaca(), marca: "Ford", modelo: "Ka", ano: 2021 });
		const veiculo2Id = veiculo2.body.data.id;
		await createOS(app, atendenteToken, cliente.id, veiculo.id);
		await createOS(app, atendenteToken, cliente.id, veiculo2Id);

		const res = await request(app.getHttpServer()).get("/os?page=2&pageSize=1").set("Authorization", bearer(atendenteToken));
		expect(res.status).toBe(200);
		expect(res.body.data.items).toHaveLength(1);
		expect(res.body.data.page).toBe(2);
		expect(res.body.data.pageSize).toBe(1);
	});

	describe("GET /os - ordenação", () => {
		async function criarOsComVeiculo(clienteId: string) {
			const v = await request(app.getHttpServer())
				.post(`/clientes/${clienteId}/veiculos`)
				.set("Authorization", bearer(atendenteToken))
				.send({ placa: nextPlaca(), marca: "Fiat", modelo: "Uno", ano: 2020 });
			return createOS(app, atendenteToken, clienteId, v.body.data.id);
		}

		async function levarAteEntregue(os: { id: string }) {
			await forcarStatusOs(prisma, os.id, OsStatus.FINALIZADA);
			await request(app.getHttpServer()).post(`/os/${os.id}/entregar`).set("Authorization", bearer(atendenteToken));
		}

		it("ordena por prioridade de status, empata por antiguidade e oculta ENTREGUE", async () => {
			const { cliente, veiculo } = await setupClienteVeiculo();

			const recebidaAntiga = await createOS(app, atendenteToken, cliente.id, veiculo.id);
			const recebidaNova = await criarOsComVeiculo(cliente.id);

			const emDiagnostico = await criarOsComVeiculo(cliente.id);
			await forcarStatusOs(prisma, emDiagnostico.id, OsStatus.EM_DIAGNOSTICO);

			const emExecucao = await criarOsComVeiculo(cliente.id);
			await forcarStatusOs(prisma, emExecucao.id, OsStatus.EM_EXECUCAO);

			// Mesmo veículo da primeira OS: o ciclo de placas válidas do factory tem 5 posições.
			const aguardandoPagamento = await createOS(app, atendenteToken, cliente.id, veiculo.id);
			await forcarStatusOs(prisma, aguardandoPagamento.id, OsStatus.AGUARDANDO_PAGAMENTO);

			const entregue = await criarOsComVeiculo(cliente.id);
			await levarAteEntregue(entregue);

			const res = await request(app.getHttpServer()).get("/os").set("Authorization", bearer(atendenteToken));
			expect(res.status).toBe(200);

			const numeros = res.body.data.items.map((i: any) => i.numero);
			expect(numeros).not.toContain(entregue.numero);
			expect(numeros).toEqual([
				emExecucao.numero,
				aguardandoPagamento.numero,
				emDiagnostico.numero,
				recebidaAntiga.numero,
				recebidaNova.numero,
			]);
		});

		it("filtro explícito ?status=ENTREGUE ainda retorna as entregues", async () => {
			const { cliente, veiculo } = await setupClienteVeiculo();
			const entregue = await createOS(app, atendenteToken, cliente.id, veiculo.id);
			await levarAteEntregue(entregue);

			const res = await request(app.getHttpServer()).get("/os?status=ENTREGUE").set("Authorization", bearer(atendenteToken));
			expect(res.status).toBe(200);
			expect(res.body.data.items.map((i: any) => i.numero)).toContain(entregue.numero);
		});
	});
});
