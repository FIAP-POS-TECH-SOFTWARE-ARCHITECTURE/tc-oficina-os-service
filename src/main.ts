import { NestFactory, Reflector } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Logger } from "nestjs-pino";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { PrismaService } from "./prisma/prisma.service";
import { deveIgnorarRateLimit } from "./common/http/rate-limit";
import { configurarRoteamento } from "./common/http/roteamento";
import { INTERNAL_API_KEY_HEADER, INTERNAL_API_KEY_SECURITY } from "./common/guards/internal-api-key.guard";
import { workersHabilitados } from "./modules/mensageria/configuracao-mensageria";
import { lerPrazos } from "./modules/orquestracao-os/domain/prazos-fluxo";

async function bootstrap() {
	if (!process.env.PORT) throw new Error("PORT não definido no .env");
	if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET não definido no .env");
	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não definido no .env");
	if (!process.env.INTERNAL_API_KEY) throw new Error("INTERNAL_API_KEY não definido no .env");
	lerPrazos(process.env);
	if (workersHabilitados())
		for (const nome of ["SNS_EVENTOS_ARN", "SQS_EXECUCAO_COMANDOS_URL", "SQS_BILLING_COMANDOS_URL", "SQS_OS_ORQUESTRADOR_EVENTOS_URL"])
			if (!process.env[nome]) throw new Error(`${nome} não definido no .env (ou WORKERS_HABILITADOS=false)`);

	const app = await NestFactory.create(AppModule, { bufferLogs: true });
	configurarRoteamento(app);
	app.useLogger(app.get(Logger));
	app.enableShutdownHooks();

	app.enableCors();
	app.use(helmet());
	app.use(
		rateLimit({
			windowMs: 15 * 60 * 1000,
			max: 100,
			standardHeaders: true,
			legacyHeaders: false,
			// probes do Kubernetes e rotas internas (serviço a serviço, com API key) ficam fora do limite por IP
			skip: (req) => deveIgnorarRateLimit(req.path),
		}),
	);

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
			transformOptions: { enableImplicitConversion: true },
		}),
	);

	const reflector = app.get(Reflector);
	const jwtService = app.get(JwtService);
	const prismaService = app.get(PrismaService);

	app.useGlobalGuards(new JwtAuthGuard(jwtService, reflector, prismaService), new RolesGuard(reflector));
	app.useGlobalInterceptors(new ResponseInterceptor());
	app.useGlobalFilters(new AllExceptionsFilter());

	const config = new DocumentBuilder()
		.setTitle("Oficina - OS service")
		.setDescription("Ordens de serviço, cadastros, estoque e rotas internas consumidas pelos demais serviços")
		.setVersion("")
		.addBearerAuth()
		.addApiKey({ type: "apiKey", in: "header", name: INTERNAL_API_KEY_HEADER }, INTERNAL_API_KEY_SECURITY)
		.build();
	const document = SwaggerModule.createDocument(app, config);
	SwaggerModule.setup("/docs", app, document);

	await app.listen(process.env.PORT);

	const logger = app.get(Logger);
	logger.log(`🚀 Aplicação rodando em: http://localhost:${process.env.PORT}`);
	logger.log(`📚 Documentação disponível em: http://localhost:${process.env.PORT}/docs`);
}

void bootstrap();
