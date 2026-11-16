import { INestApplication } from "@nestjs/common";

interface InstanciaExpress {
	set(configuracao: string, valor: unknown): unknown;
	router: { caseSensitive: boolean };
}

// Paths diferem por caixa: "/INTERNAL/..." não pode cair no controller de "/internal/...".
// O adapter do Nest já instanciou o router do Express (que lê a opção só na criação), então a
// flag vai também no router; as rotas dos controllers são registradas depois, no init().
export function configurarRoteamento(app: INestApplication): void {
	const instancia = app.getHttpAdapter().getInstance() as InstanciaExpress;
	instancia.set("case sensitive routing", true);
	instancia.router.caseSensitive = true;
}
