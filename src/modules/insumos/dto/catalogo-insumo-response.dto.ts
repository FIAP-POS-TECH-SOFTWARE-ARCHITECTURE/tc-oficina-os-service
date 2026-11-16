import { ApiProperty } from "@nestjs/swagger";

export class CatalogoInsumoResponseDto {
	@ApiProperty({ example: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f" })
	id!: string;

	@ApiProperty({ example: "OL-5W30" })
	codigo!: string;

	@ApiProperty({ example: "Óleo 5W30 1L" })
	nome!: string;

	@ApiProperty({ example: 4500, description: "Preço em centavos" })
	precoCentavos!: number;

	@ApiProperty({ example: 12 })
	quantidadeEstoque!: number;
}
