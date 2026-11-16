import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "./prisma/prisma.module";
import { ModulesModule } from "./modules/modules.module";
import { HealthModule } from "./modules/health/health.module";
import { JwtModule } from "@nestjs/jwt";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";

@Module({
	imports: [
		ConfigModule.forRoot(),
		ScheduleModule.forRoot(),
		LoggerModule.forRoot({
			pinoHttp: {
				genReqId: (req) => {
					const headerRequestId = req.headers["x-request-id"];
					if (Array.isArray(headerRequestId)) return headerRequestId[0] ?? randomUUID();
					return headerRequestId ?? randomUUID();
				},
				customProps: (req) => ({ requestId: req.id }),
				redact: ["req.headers.authorization"],
				autoLogging: {
					ignore: (req) => req.url?.startsWith("/health") ?? false,
				},
				transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
			},
		}),
		JwtModule.register({
			global: true,
			secret: process.env.JWT_SECRET,
			signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? "8h") as `${number}${"s" | "m" | "h" | "d"}` },
		}),
		PrismaModule,
		ModulesModule,
		HealthModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
