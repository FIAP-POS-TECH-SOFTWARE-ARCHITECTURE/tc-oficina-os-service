import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";

export const IMAGEM_MINISTACK = "ministackorg/ministack:1.5.17";
export const PORTA_MINISTACK = 4566;

export interface MiniStackIniciado {
	container: StartedTestContainer;
	endpoint: string;
}

export async function iniciarMiniStack(): Promise<MiniStackIniciado> {
	const container = await new GenericContainer(IMAGEM_MINISTACK)
		.withExposedPorts(PORTA_MINISTACK)
		.withEnvironment({ MINISTACK_REGION: "us-east-1" })
		.withWaitStrategy(Wait.forHttp("/_ministack/health", PORTA_MINISTACK).forStatusCode(200))
		.withStartupTimeout(120_000)
		.start();

	return { container, endpoint: `http://${container.getHost()}:${container.getMappedPort(PORTA_MINISTACK)}` };
}

// Deve ser chamado antes de instanciar qualquer cliente do AWS SDK: a configuração é lida na construção do cliente.
export function configurarAmbienteAws(endpoint: string): void {
	process.env.AWS_ENDPOINT_URL = endpoint;
	process.env.AWS_REGION = "us-east-1";
	process.env.AWS_ACCESS_KEY_ID = "test";
	process.env.AWS_SECRET_ACCESS_KEY = "test";
}
