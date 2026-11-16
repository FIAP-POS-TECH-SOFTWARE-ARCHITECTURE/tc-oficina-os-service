import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { OsStatus } from "../../src/modules/ordens-servico/domain/os-status";
import { PrismaService } from "../../src/prisma/prisma.service";
import { bearer } from "./auth";
import { expectStatus } from "./assertions";

export const CPF_VALIDOS = ["11144477735", "52998224725", "39053344705"];
export const CNPJ_VALIDOS = ["11444777000161", "27865757000102"];
export const PLACAS_VALIDAS = ["ABC1234", "BRA1A23", "XYZ9876", "DEF2D34", "GHI5678"];

let cpfIdx = 0;
let cnpjIdx = 0;
let placaIdx = 0;

export function nextCpf(): string {
	const cpf = CPF_VALIDOS[cpfIdx % CPF_VALIDOS.length];
	cpfIdx++;
	return cpf;
}

export function nextCnpj(): string {
	const cnpj = CNPJ_VALIDOS[cnpjIdx % CNPJ_VALIDOS.length];
	cnpjIdx++;
	return cnpj;
}

export function nextPlaca(): string {
	const placa = PLACAS_VALIDAS[placaIdx % PLACAS_VALIDAS.length];
	placaIdx++;
	return placa;
}

export function resetFactoryCounters(): void {
	cpfIdx = 0;
	cnpjIdx = 0;
	placaIdx = 0;
}

export interface CreateClienteOverrides {
	nome?: string;
	documento?: string;
	email?: string;
	telefone?: string;
	endereco?: string;
}

export async function createCliente(app: INestApplication, token: string, overrides: CreateClienteOverrides = {}): Promise<any> {
	const res = await request(app.getHttpServer())
		.post("/clientes")
		.set("Authorization", bearer(token))
		.send({
			nome: overrides.nome ?? "Cliente Teste",
			documento: overrides.documento ?? nextCpf(),
			email: overrides.email,
			telefone: overrides.telefone,
			endereco: overrides.endereco,
		});
	expectStatus(res, 201);
	return res.body.data;
}

export interface CreateVeiculoOverrides {
	placa?: string;
	marca?: string;
	modelo?: string;
	ano?: number;
}

export async function createVeiculo(
	app: INestApplication,
	token: string,
	clienteId: string,
	overrides: CreateVeiculoOverrides = {},
): Promise<any> {
	const res = await request(app.getHttpServer())
		.post(`/clientes/${clienteId}/veiculos`)
		.set("Authorization", bearer(token))
		.send({
			placa: overrides.placa ?? nextPlaca(),
			marca: overrides.marca ?? "Fiat",
			modelo: overrides.modelo ?? "Uno",
			ano: overrides.ano ?? 2020,
		});
	expectStatus(res, 201);
	return res.body.data;
}

export interface CreateServicoOverrides {
	nome?: string;
	descricao?: string;
	preco?: number;
	tempoEstimadoMin?: number;
}

let servicoSeq = 0;
export async function createServico(app: INestApplication, adminToken: string, overrides: CreateServicoOverrides = {}): Promise<any> {
	servicoSeq++;
	const res = await request(app.getHttpServer())
		.post("/servicos")
		.set("Authorization", bearer(adminToken))
		.send({
			nome: overrides.nome ?? `Servico ${servicoSeq} ${Date.now()}`,
			descricao: overrides.descricao,
			preco: overrides.preco ?? 100,
			tempoEstimadoMin: overrides.tempoEstimadoMin ?? 60,
		});
	expectStatus(res, 201);
	return res.body.data;
}

export interface CreateInsumoOverrides {
	codigo?: string;
	nome?: string;
	descricao?: string;
	precoUnitario?: number;
	estoqueMinimo?: number;
	quantidadeEstoque?: number;
}

let insumoSeq = 0;
export async function createInsumo(app: INestApplication, token: string, overrides: CreateInsumoOverrides = {}): Promise<any> {
	insumoSeq++;
	const res = await request(app.getHttpServer())
		.post("/insumos")
		.set("Authorization", bearer(token))
		.send({
			codigo: overrides.codigo ?? `INS-${insumoSeq}-${Date.now()}`,
			nome: overrides.nome ?? `Insumo ${insumoSeq}`,
			descricao: overrides.descricao,
			precoUnitario: overrides.precoUnitario ?? 50,
			estoqueMinimo: overrides.estoqueMinimo ?? 5,
			quantidadeEstoque: overrides.quantidadeEstoque ?? 100,
		});
	expectStatus(res, 201);
	return res.body.data;
}

export async function createOS(app: INestApplication, token: string, clienteId: string, veiculoId: string): Promise<any> {
	const res = await request(app.getHttpServer()).post("/os").set("Authorization", bearer(token)).send({ clienteId, veiculoId });
	expectStatus(res, 201);
	return res.body.data;
}

// Leva a OS direto ao status desejado: as transições intermediárias são disparadas pelos outros serviços.
export async function forcarStatusOs(prisma: PrismaService, osId: string, status: OsStatus): Promise<void> {
	await prisma.ordemServico.update({ where: { id: osId }, data: { status } });
}
