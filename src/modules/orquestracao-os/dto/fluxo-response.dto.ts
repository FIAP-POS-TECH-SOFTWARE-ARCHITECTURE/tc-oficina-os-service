import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { EtapaFluxoOs, StatusFluxoOs } from "../domain/fluxo-ordem-servico";

export class FluxoOrdemServicoResponseDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	osId: string;

	@ApiProperty({ example: "OS-2026-000123" })
	numeroOs: string;

	@ApiProperty({ enum: EtapaFluxoOs })
	etapa: EtapaFluxoOs;

	@ApiProperty({ enum: StatusFluxoOs })
	status: StatusFluxoOs;

	@ApiPropertyOptional({ type: Date, nullable: true })
	prazoExpiraEm: Date | null;

	@ApiPropertyOptional({ type: Date, nullable: true })
	prazoAprovacaoEm: Date | null;

	@ApiProperty({ type: [String], example: ["CancelarOrcamento"] })
	compensacoesPendentes: string[];

	@ApiProperty({ type: [String], example: ["EstornarReservaEstoque"] })
	compensacoesFeitas: string[];

	@ApiPropertyOptional({ type: String, nullable: true })
	motivoCompensacao: string | null;

	@ApiPropertyOptional({ type: String, nullable: true })
	pagamentoId: string | null;

	@ApiPropertyOptional({ type: String, nullable: true })
	comandoPendenteMessageId: string | null;

	@ApiProperty()
	correlationId: string;

	@ApiProperty({ description: "Reenvios de compensação sem resposta" })
	tentativas: number;
}

export class MensagemDoFluxoResponseDto {
	@ApiProperty()
	messageId: string;

	@ApiProperty({ example: "GerarOrcamento" })
	tipo: string;

	@ApiProperty({ example: "billing-comandos" })
	destino: string;

	@ApiProperty({ enum: ["PENDENTE", "ENVIADA", "FALHA"] })
	status: string;

	@ApiProperty()
	tentativas: number;

	@ApiProperty()
	createdAt: Date;

	@ApiPropertyOptional({ type: Date, nullable: true })
	enviadaEm: Date | null;
}

export class FluxoResponseDto {
	@ApiProperty({ type: FluxoOrdemServicoResponseDto })
	fluxo: FluxoOrdemServicoResponseDto;

	@ApiProperty({ type: [MensagemDoFluxoResponseDto] })
	mensagens: MensagemDoFluxoResponseDto[];
}
