import { ApiProperty } from "@nestjs/swagger";

export class CatalogoServicoResponseDto {
	@ApiProperty({ example: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e" })
	id!: string;

	@ApiProperty({ example: "Troca de óleo" })
	nome!: string;

	@ApiProperty({ example: "Troca de óleo do motor e filtro", nullable: true, type: String })
	descricao!: string | null;

	@ApiProperty({ example: 12000, description: "Preço em centavos" })
	precoCentavos!: number;

	@ApiProperty({ example: 45 })
	tempoEstimadoMin!: number;
}
