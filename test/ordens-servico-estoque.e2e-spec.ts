import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import request from "supertest";
import { RESERVA_ESTOQUE_OS, type ReservaEstoqueOsPort } from "../src/modules/insumos/application/ports/reserva-estoque-os.gateway";
import { OsStatus } from "../src/modules/ordens-servico/domain/os-status";
import { PrismaService } from "../src/prisma/prisma.service";
import { setupApp } from "./helpers/app-factory";
import { bearer, loginAs } from "./helpers/auth";
import { truncateAll } from "./helpers/db";
import { createCliente, createInsumo, createOS, createVeiculo, forcarStatusOs } from "./helpers/factories";

describe("Ordens de Serviço (e2e) - estoque por OS", () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let reserva: ReservaEstoqueOsPort;
	let atendenteToken: string;
	let adminToken: string;
	let estoquistaToken: string;

	beforeAll(async () => {
		app = await setupApp();
		prisma = app.get(PrismaService);
		reserva = app.get<ReservaEstoqueOsPort>(RESERVA_ESTOQUE_OS);
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(async () => {
		await truncateAll(prisma);
		atendenteToken = (await loginAs(app, prisma, Role.ATENDENTE)).token;
		adminToken = (await loginAs(app, prisma, Role.ADMINISTRADOR)).token;
		estoquistaToken = (await loginAs(app, prisma, Role.ESTOQUISTA)).token;
	});

	async function osComInsumo(estoque: number) {
		const cliente = await createCliente(app, atendenteToken);
		const veiculo = await createVeiculo(app, atendenteToken, cliente.id);
		const insumo = await createInsumo(app, estoquistaToken, { quantidadeEstoque: estoque, precoUnitario: 20 });
		const os = await createOS(app, atendenteToken, cliente.id, veiculo.id);
		return { cliente, insumo, os };
	}
	const estoqueDe = async (id: string) => (await prisma.insumo.findUniqueOrThrow({ where: { id } })).quantidadeEstoque;
	const reservar = (osId: string, insumoId: string, quantidade: number) =>
		reserva.reservar({ ordemServicoId: osId, itens: [{ insumoId, quantidade }], motivo: "Reserva para a OS", usuarioId: null });

	it("reserva baixa estoque e POST /os/:id/cancelar devolve com um ESTORNO", async () => {
		const { insumo, os } = await osComInsumo(10);
		expect((await reservar(os.id, insumo.id, 4)).reservado).toBe(true);
		expect(await estoqueDe(insumo.id)).toBe(6);
		const res = await request(app.getHttpServer())
			.post(`/os/${os.id}/cancelar`)
			.set("Authorization", bearer(adminToken))
			.send({ motivo: "teste" });
		expect(res.status).toBe(200);
		expect(await estoqueDe(insumo.id)).toBe(10);
		expect(
			(await prisma.movimentoEstoque.findMany({ where: { ordemServicoId: os.id, tipo: "ESTORNO" } })).map((m) => m.quantidade),
		).toEqual([4]);
	});

	it("reserva sem saldo → reservado false com faltante, estoque intacto", async () => {
		const { insumo, os } = await osComInsumo(2);
		const r = await reservar(os.id, insumo.id, 5);
		expect(r.reservado).toBe(false);
		expect(r.faltantes).toEqual([expect.stringContaining("2 disponíveis, 5 requisitados")]);
		expect(await estoqueDe(insumo.id)).toBe(2);
	});

	it("estorno repetido devolve uma vez só", async () => {
		const { insumo, os } = await osComInsumo(10);
		await reservar(os.id, insumo.id, 3);
		await reserva.estornar({ ordemServicoId: os.id, motivo: "m", usuarioId: null });
		expect(await reserva.estornar({ ordemServicoId: os.id, motivo: "m", usuarioId: null })).toEqual({ insumosEstornados: 0 });
		expect(await estoqueDe(insumo.id)).toBe(10);
	});

	it("duas OS concorrentes pelo mesmo insumo com saldo para uma só → exatamente uma reserva", async () => {
		const a = await osComInsumo(5);
		const veiculo2 = await createVeiculo(app, atendenteToken, a.cliente.id);
		const os2 = await createOS(app, atendenteToken, a.cliente.id, veiculo2.id);
		const [r1, r2] = await Promise.all([reservar(a.os.id, a.insumo.id, 5), reservar(os2.id, a.insumo.id, 5)]);
		expect([r1.reservado, r2.reservado].sort()).toEqual([false, true]);
		expect(await estoqueDe(a.insumo.id)).toBe(0);
	});

	it("cancelar OS sem reserva não gera movimento; FINALIZADA e ENTREGUE → 422", async () => {
		const { cliente, os } = await osComInsumo(1);
		expect(
			(await request(app.getHttpServer()).post(`/os/${os.id}/cancelar`).set("Authorization", bearer(adminToken)).send({})).status,
		).toBe(200);
		expect(await prisma.movimentoEstoque.count({ where: { ordemServicoId: os.id } })).toBe(0);
		for (const status of [OsStatus.FINALIZADA, OsStatus.ENTREGUE]) {
			const v = await createVeiculo(app, atendenteToken, cliente.id);
			const outra = await createOS(app, atendenteToken, cliente.id, v.id);
			await forcarStatusOs(prisma, outra.id, status);
			expect(
				(await request(app.getHttpServer()).post(`/os/${outra.id}/cancelar`).set("Authorization", bearer(adminToken)).send({})).status,
			).toBe(422);
		}
	});

	it("entregar OS FINALIZADA → 200 e ENTREGUE", async () => {
		const { os } = await osComInsumo(1);
		await forcarStatusOs(prisma, os.id, OsStatus.FINALIZADA);
		const res = await request(app.getHttpServer()).post(`/os/${os.id}/entregar`).set("Authorization", bearer(atendenteToken));
		expect(res.status).toBe(200);
		expect((await prisma.ordemServico.findUniqueOrThrow({ where: { id: os.id } })).status).toBe(OsStatus.ENTREGUE);
	});
});
