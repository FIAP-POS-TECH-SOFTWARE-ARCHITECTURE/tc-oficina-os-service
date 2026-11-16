import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class CompensarFluxoDto {
	@ApiProperty({ example: "Cliente desistiu após falha técnica", required: false })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	motivo?: string;
}
