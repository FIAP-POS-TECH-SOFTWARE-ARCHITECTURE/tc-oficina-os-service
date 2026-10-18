import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { setupApp } from "./helpers/app-factory";
import { truncateAll } from "./helpers/db";

interface RouteCase {
	method: "get" | "post" | "patch" | "delete";
	path: string;
}

// Todas as 60 rotas protegidas (autenticadas, não públicas).
// IDs falsos são UUIDs válidos (passam ParseUUIDPipe) e levam à autenticação primeiro.
const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

const ROUTES: RouteCase[] = [
	// Usuarios
	{ method: "post", path: "/usuarios" },
	{ method: "get", path: "/usuarios" },
	{ method: "get", path: `/usuarios/${FAKE_UUID}` },
	{ method: "patch", path: `/usuarios/${FAKE_UUID}` },
	{ method: "patch", path: `/usuarios/${FAKE_UUID}/senha` },
	{ method: "delete", path: `/usuarios/${FAKE_UUID}` },
	// Clientes
	{ method: "post", path: "/clientes" },
	{ method: "get", path: "/clientes" },
	{ method: "get", path: "/clientes/buscar?documento=11144477735" },
	{ method: "get", path: `/clientes/${FAKE_UUID}` },
	{ method: "patch", path: `/clientes/${FAKE_UUID}` },
	{ method: "delete", path: `/clientes/${FAKE_UUID}` },
	// Veiculos
	{ method: "post", path: `/clientes/${FAKE_UUID}/veiculos` },
	{ method: "get", path: `/clientes/${FAKE_UUID}/veiculos` },
	{ method: "get", path: "/veiculos/buscar?placa=ABC1234" },
	{ method: "get", path: `/veiculos/${FAKE_UUID}` },
	{ method: "patch", path: `/veiculos/${FAKE_UUID}` },
	{ method: "delete", path: `/veiculos/${FAKE_UUID}` },
	// Servicos
	{ method: "post", path: "/servicos" },
	{ method: "get", path: "/servicos" },
	{ method: "get", path: `/servicos/${FAKE_UUID}` },
	{ method: "patch", path: `/servicos/${FAKE_UUID}` },
	{ method: "delete", path: `/servicos/${FAKE_UUID}` },
	// Insumos
	{ method: "post", path: "/insumos" },
	{ method: "get", path: "/insumos" },
	{ method: "get", path: "/insumos/alertas/estoque-baixo" },
	{ method: "get", path: `/insumos/${FAKE_UUID}` },
	{ method: "patch", path: `/insumos/${FAKE_UUID}` },
	{ method: "delete", path: `/insumos/${FAKE_UUID}` },
	{ method: "post", path: `/insumos/${FAKE_UUID}/entrada` },
	{ method: "post", path: `/insumos/${FAKE_UUID}/ajuste` },
	{ method: "get", path: `/insumos/${FAKE_UUID}/movimentos` },
	// Registros de compra
	{ method: "post", path: "/insumos/compras" },
	{ method: "get", path: "/insumos/compras" },
	{ method: "get", path: `/insumos/compras/${FAKE_UUID}` },
	{ method: "post", path: `/insumos/compras/${FAKE_UUID}/enviar-fornecedor` },
	{ method: "post", path: `/insumos/compras/${FAKE_UUID}/resposta-fornecedor` },
	{ method: "post", path: `/insumos/compras/${FAKE_UUID}/cancelar` },
	{ method: "post", path: `/insumos/compras/${FAKE_UUID}/receber` },
	// Ordens de servico
	{ method: "post", path: "/os" },
	{ method: "get", path: "/os" },
	{ method: "get", path: "/os/metricas/tempo-medio" },
	{ method: "get", path: `/os/${FAKE_UUID}` },
	{ method: "get", path: "/os/acompanhamento/OS-9999-999999" },
	{ method: "post", path: `/os/${FAKE_UUID}/entregar` },
	{ method: "post", path: `/os/${FAKE_UUID}/cancelar` },
];

describe("Auth Matrix (e2e) - sem token deve retornar 401", () => {
	let app: INestApplication;
	let prisma: PrismaService;

	beforeAll(async () => {
		app = await setupApp();
		prisma = app.get(PrismaService);
		await truncateAll(prisma);
	});

	afterAll(async () => {
		await app.close();
	});

	it.each(ROUTES)("$method $path → 401", async ({ method, path }) => {
		const res = await (request(app.getHttpServer())[method](path) as any).send({});
		expect(res.status).toBe(401);
	});
});
