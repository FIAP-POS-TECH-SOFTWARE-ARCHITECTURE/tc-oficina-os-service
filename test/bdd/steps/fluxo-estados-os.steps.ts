import path from "node:path";
import { defineFeature, loadFeature, type DefineStepFunction } from "jest-cucumber";
import { canTransition, nextStatus, OsTransition } from "../../../src/modules/ordens-servico/domain/fluxo-estados-os";
import { OsStatus } from "../../../src/modules/ordens-servico/domain/os-status";

const feature = loadFeature(path.join(__dirname, "..", "features", "fluxo-estados-os.feature"));

defineFeature(feature, (test) => {
	let statusAtual: OsStatus;
	let transicao: OsTransition;
	let permitida: boolean;

	const dadoOsComStatus = (given: DefineStepFunction) => {
		given(/^uma OS com status "(.*)"$/, (status: string) => {
			expect(Object.values(OsStatus)).toContain(status);
			statusAtual = status as OsStatus;
		});
	};

	const quandoTransicaoSolicitada = (when: DefineStepFunction) => {
		when(/^a transição "(.*)" é solicitada$/, (nome: string) => {
			transicao = nome as OsTransition;
			permitida = canTransition(statusAtual, transicao);
		});
	};

	test("OS finalizada é entregue ao cliente", ({ given, when, then, and }) => {
		dadoOsComStatus(given);
		quandoTransicaoSolicitada(when);
		then("a transição é permitida", () => {
			expect(permitida).toBe(true);
		});
		and(/^o novo status é "(.*)"$/, (status: string) => {
			expect(nextStatus(transicao)).toBe(status);
		});
	});

	test("Transição fora de ordem é recusada", ({ given, when, then }) => {
		dadoOsComStatus(given);
		quandoTransicaoSolicitada(when);
		then("a transição é recusada", () => {
			expect(permitida).toBe(false);
		});
	});
});
