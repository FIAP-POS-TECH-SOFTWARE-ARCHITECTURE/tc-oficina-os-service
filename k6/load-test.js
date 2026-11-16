import http from "k6/http";
import { check, sleep } from "k6";

// Uso: k6 run -e BASE_URL=$(minikube service os-service --url) k6/load-test.js
const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

export const options = {
	stages: [
		{ duration: "1m", target: 50 }, // rampa
		{ duration: "3m", target: 200 }, // pico, deve disparar o HPA (CPU > 70%)
		{ duration: "1m", target: 0 }, // desaquecimento
	],
};

export default function () {
	// /health é público e isento de rate limit: gera carga de CPU sem 429.
	const res = http.get(`${BASE_URL}/health`);
	check(res, { "status 200": (r) => r.status === 200 });
	sleep(0.1);
}
