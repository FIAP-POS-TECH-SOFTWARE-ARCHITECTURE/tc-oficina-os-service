import { Prisma } from "@prisma/client";
import { decimalParaCentavos } from "./centavos";

describe("decimalParaCentavos", () => {
	it.each([
		["19.99", 1999],
		["0.1", 10],
		["150", 15000],
		["150.5", 15050],
		["0.01", 1],
		["0", 0],
		["99999999.99", 9999999999],
		[" 12.30 ", 1230],
	])("string %p → %p", (entrada, esperado) => {
		expect(decimalParaCentavos(entrada)).toBe(esperado);
	});

	it("number 19.99 → 1999 (sem erro de float)", () => {
		expect(19.99 * 100).not.toBe(1999);
		expect(decimalParaCentavos(19.99)).toBe(1999);
	});

	it("Prisma.Decimal → centavos", () => {
		expect(decimalParaCentavos(new Prisma.Decimal("19.99"))).toBe(1999);
		expect(decimalParaCentavos(new Prisma.Decimal("150.00"))).toBe(15000);
	});

	it("arredonda half-up na terceira casa", () => {
		expect(decimalParaCentavos("0.125")).toBe(13);
		expect(decimalParaCentavos("0.124")).toBe(12);
		expect(decimalParaCentavos("0.995")).toBe(100);
	});

	it.each([null, undefined, "-1", "abc", "1e+21", "", "1.2.3", {}])("rejeita %p", (entrada) => {
		expect(() => decimalParaCentavos(entrada)).toThrow(Error);
	});

	it("rejeita valor acima do inteiro seguro", () => {
		expect(() => decimalParaCentavos("900719925474099.99")).toThrow(/inteiro seguro/);
	});
});
