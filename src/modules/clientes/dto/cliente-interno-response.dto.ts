import { ApiProperty } from "@nestjs/swagger";

export class ClienteInternoResponseDto {
	@ApiProperty({ example: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" })
	id!: string;

	@ApiProperty({ example: "Maria Souza" })
	nome!: string;

	@ApiProperty({ example: true })
	ativo!: boolean;
}
