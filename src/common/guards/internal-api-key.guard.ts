import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { createHash, timingSafeEqual } from "node:crypto";

export const INTERNAL_API_KEY_HEADER = "x-internal-api-key";
export const INTERNAL_API_KEY_SECURITY = "internal-api-key";

// Hash fixa o tamanho em 32 bytes: timingSafeEqual lança RangeError com buffers de tamanhos diferentes.
function resumo(valor: string): Buffer {
	return createHash("sha256").update(valor, "utf8").digest();
}

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
	private readonly logger = new Logger(InternalApiKeyGuard.name);

	canActivate(ctx: ExecutionContext): boolean {
		const esperada = process.env.INTERNAL_API_KEY;
		if (!esperada) {
			this.logger.error("INTERNAL_API_KEY não configurada; rotas internas recusadas");
			throw new UnauthorizedException("Credencial interna inválida");
		}

		const req = ctx.switchToHttp().getRequest<Request>();
		const recebida: unknown = req.headers[INTERNAL_API_KEY_HEADER];
		if (typeof recebida !== "string" || recebida.length === 0) throw new UnauthorizedException("Credencial interna ausente");

		if (!timingSafeEqual(resumo(recebida), resumo(esperada))) throw new UnauthorizedException("Credencial interna inválida");

		return true;
	}
}
