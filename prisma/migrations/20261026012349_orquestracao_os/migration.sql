-- CreateEnum
CREATE TYPE "EtapaFluxoOs" AS ENUM ('AGUARDANDO_ACK_DIAGNOSTICO', 'AGUARDANDO_DIAGNOSTICO', 'DIAGNOSTICO_EM_ANDAMENTO', 'AGUARDANDO_ESTOQUE', 'AGUARDANDO_ORCAMENTO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_PAGAMENTO', 'AGUARDANDO_ACK_REPARO', 'AGUARDANDO_REPARO', 'REPARO_EM_ANDAMENTO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "StatusFluxoOs" AS ENUM ('EM_ANDAMENTO', 'COMPENSANDO', 'CONCLUIDO', 'COMPENSADO', 'FALHA_TECNICA');

-- CreateEnum
CREATE TYPE "StatusOutbox" AS ENUM ('PENDENTE', 'ENVIADA', 'FALHA');

-- CreateTable
CREATE TABLE "fluxos_ordem_servico" (
    "id" UUID NOT NULL,
    "os_id" UUID NOT NULL,
    "etapa" "EtapaFluxoOs" NOT NULL,
    "status" "StatusFluxoOs" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "prazo_expira_em" TIMESTAMP(3),
    "prazo_aprovacao_em" TIMESTAMP(3),
    "compensacoes_pendentes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "compensacoes_feitas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "motivo_compensacao" TEXT,
    "comando_pendente_message_id" UUID,
    "pagamento_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fluxos_ordem_servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_mensagens" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "fluxo_id" UUID,
    "tipo" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "corpo" JSONB NOT NULL,
    "status" "StatusOutbox" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimo_erro" TEXT,
    "proxima_tentativa_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviada_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens_processadas" (
    "message_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "processada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_processadas_pkey" PRIMARY KEY ("message_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fluxos_ordem_servico_os_id_key" ON "fluxos_ordem_servico"("os_id");

-- CreateIndex
CREATE INDEX "fluxos_ordem_servico_status_prazo_expira_em_idx" ON "fluxos_ordem_servico"("status", "prazo_expira_em");

-- CreateIndex
CREATE INDEX "fluxos_ordem_servico_etapa_idx" ON "fluxos_ordem_servico"("etapa");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_mensagens_message_id_key" ON "outbox_mensagens"("message_id");

-- CreateIndex
CREATE INDEX "outbox_mensagens_status_proxima_tentativa_em_idx" ON "outbox_mensagens"("status", "proxima_tentativa_em");

-- CreateIndex
CREATE INDEX "outbox_mensagens_fluxo_id_idx" ON "outbox_mensagens"("fluxo_id");

-- AddForeignKey
ALTER TABLE "fluxos_ordem_servico" ADD CONSTRAINT "fluxos_ordem_servico_os_id_fkey" FOREIGN KEY ("os_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
