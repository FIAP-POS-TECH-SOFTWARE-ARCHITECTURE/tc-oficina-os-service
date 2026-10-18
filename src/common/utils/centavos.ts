import { Prisma } from "@prisma/client";

const DECIMAL_NAO_NEGATIVO = /^(\d+)(?:\.(\d+))?$/;

function comoTexto(valor: unknown): string {
	if (typeof valor === "string") return valor;
	if (typeof valor === "number") return String(valor);
	if (Prisma.Decimal.isDecimal(valor)) return valor.toString();
	throw new Error("Valor monetário inválido");
}

/**
 * Converte um valor monetário decimal (Prisma.Decimal, string ou number) em centavos inteiros
 * operando sobre a representação textual: nunca multiplica float por 100.
 */
export function decimalParaCentavos(valor: unknown): number {
	if (valor === null || valor === undefined) throw new Error("Valor monetário ausente");

	const texto = comoTexto(valor).trim();
	const partes = DECIMAL_NAO_NEGATIVO.exec(texto);
	if (!partes) throw new Error(`Valor monetário inválido: '${texto}'`);

	const inteiros = Number.parseInt(partes[1], 10);
	const fracao = (partes[2] ?? "").padEnd(3, "0");
	const arredondamento = Number.parseInt(fracao[2], 10) >= 5 ? 1 : 0;
	const centavos = inteiros * 100 + Number.parseInt(fracao.slice(0, 2), 10) + arredondamento;

	if (!Number.isSafeInteger(centavos)) throw new Error(`Valor monetário acima do inteiro seguro: '${texto}'`);
	return centavos;
}
