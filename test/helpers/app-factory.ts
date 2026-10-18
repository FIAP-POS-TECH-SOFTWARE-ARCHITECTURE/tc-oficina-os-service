import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { JwtAuthGuard } from "../../src/common/guards/jwt-auth.guard";
import { RolesGuard } from "../../src/common/guards/roles.guard";
import { configurarRoteamento } from "../../src/common/http/roteamento";
import { ResponseInterceptor } from "../../src/common/interceptors/response.interceptor";
import { PrismaService } from "../../src/prisma/prisma.service";

export async function setupApp(): Promise<INestApplication> {
	const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

	const app = moduleFixture.createNestApplication();
	configurarRoteamento(app);

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

	await app.init();
	return app;
}
