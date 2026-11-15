# ADR-012: Outbox transacional, consumidores idempotentes e contratos versionados

- **Status:** Aceita
- **Data:** 2026-11-12

## Contexto

Cada passo da Saga ([ADR-008](adr-008-saga-orquestrada.md)) grava no banco do serviço e
publica uma mensagem. Gravar e publicar em duas operações separadas abre duas falhas: o banco
confirma e a publicação falha (o fluxo trava sem ninguém saber), ou a publicação sai e o banco
desfaz (a mensagem anuncia algo que não aconteceu). Além disso, o SQS Standard entrega pelo
menos uma vez e sem ordem garantida ([ADR-009](adr-009-mensageria-sns-sqs.md)): o mesmo comando
pode chegar duas vezes, e um cancelamento pode chegar antes do comando que ele cancela.

Os três serviços estão em repositórios separados e precisam concordar sobre o formato de cada
mensagem.

## Decisão

### Outbox

- **PostgreSQL (os-service e execution-service):** a mensagem é gravada na tabela
  `outbox_mensagens` na mesma transação do efeito de domínio. Um relay separado lê as pendentes
  com `FOR UPDATE SKIP LOCKED` (várias réplicas não publicam a mesma linha), publica no SNS/SQS
  e marca como enviada; falha de publicação fica para nova tentativa.
- **DynamoDB (billing-service):** o equivalente é um item `EVENTO#<messageId>` gravado no mesmo
  `TransactWriteItems` do orçamento, com `eventoPendente = true` e presente no índice esparso
  `gsi1` (`EVENTO_PENDENTE`). O serviço publica logo após gravar e marca `eventoPendente = false`;
  um job a cada 15 s republica o que ficou pendente.

### Idempotência no consumidor

Toda mensagem tem um envelope com `messageId` (uuid), `tipo`, `versao`, `ocorridoEm`, `origem`,
`fluxoId`, `osId`, `numeroOs`, `correlationId` e `payload`. Cada consumidor segue quatro regras:

1. **`messageId` já processado** → apaga a mensagem, nenhum efeito e nenhum evento.
2. **`messageId` novo, mas ação já aplicada no domínio** (por exemplo `CancelarOrcamento` para
   um orçamento já cancelado) → registra o `messageId` e **reemite o evento de resultado**, para
   o orquestrador avançar.
3. **Registro do `messageId` e efeito de domínio juntos**: na mesma transação Postgres (tabela
   `mensagens_processadas`) ou no mesmo `TransactWriteItems` do DynamoDB (item `MSG#<messageId>`
   com `attribute_not_exists`).
4. **Ordem não garantida**: `CancelarExecucao` pode chegar antes de `SolicitarDiagnostico` ou
   `IniciarReparo`, e `CancelarOrcamento` antes de `GerarOrcamento`. O participante registra o
   cancelamento antecipado por `fluxoId` (tabela `fluxos_cancelados` no execution, item
   `FLUXO_CANCELADO#<fluxoId>` no billing), reemite o evento de cancelado e, quando o comando de
   criação chegar depois, não cria nada.

### `messageId` novo no reprocessamento

O reenvio da **mesma** mensagem (relay do outbox, nova entrega do SQS) mantém o `messageId` —
é ele que torna o reenvio inofensivo. Já o orquestrador, quando **reenvia** uma compensação sem
resposta no prazo ou quando o administrador usa `/reprocessar`, gera uma mensagem nova com
**`messageId` novo**: se o comando original foi processado e só o evento de resposta se perdeu,
o mesmo id seria descartado pela regra 1 e o fluxo nunca receberia a resposta; com id novo, a
regra 2 faz o participante reemitir o resultado.

### Contratos versionados em `contratos/`

Sem biblioteca compartilhada entre os serviços. O contrato fica em `contratos/` de cada
repositório — `tipos.json`, `schemas/envelope.schema.json`, um schema JSON por tipo de mensagem
em `schemas/payloads/`, exemplos válidos e inválidos — e a fonte da verdade é a cópia do
`os-service`. Garantias:

- o consumidor valida envelope e payload contra o schema (Ajv) antes de processar; mensagem fora
  do contrato não é apagada e acaba na DLQ;
- o teste `src/contratos/contratos.spec.ts`, presente nos três repositórios, valida os
  exemplos válidos e inválidos contra os schemas;
- no CI do billing e do execution, o job **"Contratos sincronizados"** compara `contratos/` com
  o do `tc-oficina-os-service` (`develop`) e falha se divergir.

## Alternativas consideradas

- **Publicar direto após o commit, sem outbox**: descartada pelas duas falhas descritas no
  contexto.
- **SQS FIFO com deduplicação nativa**: descartada junto com o FIFO (ver
  [ADR-009](adr-009-mensageria-sns-sqs.md)); a idempotência no consumidor é necessária de
  qualquer forma para o reprocessamento com efeito já aplicado (regra 2).
- **Pacote npm comum com tipos e schemas**: descartada. Criaria acoplamento de release entre os
  repositórios (um serviço não sobe sem publicar o pacote antes); a cópia com teste de sincronia
  dá o mesmo controle sem esse acoplamento.

## Consequências (positivas e negativas)

- **Positivo:** nenhum efeito de domínio fica sem a mensagem correspondente, e nenhuma mensagem
  sai sem o efeito; reentregas e reenvios não duplicam efeitos.
- **Positivo:** mudança de contrato é visível: quebra o teste de schema no `os-service` e o job
  de sincronia nos outros dois.
- **Negativo:** a publicação ganha latência (o relay roda em ciclo) e cada serviço carrega
  tabelas ou itens extras de controle.
- **Negativo:** toda regra nova de participante precisa respeitar as quatro regras acima; um
  handler que esqueça de reemitir o resultado na regra 2 trava o fluxo até o reenvio esgotar e
  ir a `FALHA_TECNICA`.
