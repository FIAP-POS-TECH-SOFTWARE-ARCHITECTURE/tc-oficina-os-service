// Probes do Kubernetes e chamadas serviço a serviço (protegidas por API key) não entram no limite por IP.
const PREFIXOS_ISENTOS = ["/health", "/internal"];

export function deveIgnorarRateLimit(path: string): boolean {
	return PREFIXOS_ISENTOS.some((prefixo) => path === prefixo || path.startsWith(`${prefixo}/`));
}
