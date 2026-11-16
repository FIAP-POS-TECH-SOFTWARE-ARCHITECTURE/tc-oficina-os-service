import { Role } from "@prisma/client";
import * as argon2 from "argon2";
import { PrismaService } from "../../src/prisma/prisma.service";

export async function truncateAll(prisma: PrismaService): Promise<void> {
	await prisma.$executeRawUnsafe(`
		TRUNCATE TABLE
			"mensagens_processadas",
			"outbox_mensagens",
			"fluxos_ordem_servico",
			"os_historico_status",
			"os_itens_insumo",
			"os_itens_servico",
			"movimentos_estoque",
			"registros_compra",
			"ordens_servico",
			"insumos",
			"servicos",
			"veiculos",
			"clientes",
			"usuarios"
		RESTART IDENTITY CASCADE
	`);
}

export interface SeededAdmin {
	id: string;
	email: string;
	senha: string;
}

export async function seedAdmin(prisma: PrismaService): Promise<SeededAdmin> {
	const senha = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "admin12345";
	const email = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@e2e.test";
	const senhaHash = await argon2.hash(senha);
	const u = await prisma.usuario.create({
		data: {
			nome: "Admin E2E",
			email,
			senhaHash,
			role: Role.ADMINISTRADOR,
			ativo: true,
		},
	});
	return { id: u.id, email, senha };
}
