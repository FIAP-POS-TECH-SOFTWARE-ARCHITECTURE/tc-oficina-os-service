# ADR-008: Saga orquestrada, com o orquestrador no OS service

- **Status:** Aceita
- **Data:** 2026-11-12

## Contexto

Com a divisão em três serviços ([ADR-007](adr-007-microsservicos-os-billing-execution.md)), o
atendimento de uma OS deixa de ser uma transação local: abrir a OS, diagnosticar, reservar
estoque, orçar, aprovar, pagar e reparar acontecem em bancos diferentes. O enunciado exige o
**Saga Pattern** para coordenar esse fluxo, com rollback e compensação em caso de falha em
qualquer etapa, e permite as duas formas vistas nas aulas: **orquestrada** (um orquestrador
central decide o próximo passo e envia comandos) ou **coreografada** (cada serviço reage aos
eventos dos outros, sem coordenador).

Uma Saga não tem o isolamento de uma transação ACID: cada passo é confirmado no banco do seu
serviço antes do próximo começar, e outras requisições enxergam esses resultados
intermediários. A escolha precisa dizer onde o fluxo fica e como o projeto lida com essa falta
de isolamento.

## Decisão

**Saga orquestrada**, com o orquestrador dentro do `os-service`, no módulo
`orquestracao-os`. No código o termo "Saga" não aparece:

| Conceito | Nome no código |
| --- | --- |
| Orquestrador da Saga | `OrquestradorOrdemServico` (`src/modules/orquestracao-os/application/orquestrador-ordem-servico.ts`) |
| Instância da Saga (estado de uma OS no fluxo) | `FluxoOrdemServico` (tabela `fluxos_ordem_servico`, um por OS) |
| Passo atual / situação da Saga | `etapa` (`EtapaFluxoOs`) / `status` (`StatusFluxoOs`: `EM_ANDAMENTO`, `COMPENSANDO`, `CONCLUIDO`, `COMPENSADO`, `FALHA_TECNICA`) |

O orquestrador envia comandos para as filas do Execution e do Billing, consome os eventos deles
numa fila própria ([ADR-009](adr-009-mensageria-sns-sqs.md)) e controla prazos com um job a
cada minuto (`PRAZO_APROVACAO`, `PRAZO_PAGAMENTO`, `PRAZO_RESPOSTA_SERVICO`, em minutos). Toda
decisão — mudar a etapa, mudar o status da OS, reservar ou estornar estoque e gravar o próximo
comando no outbox — acontece numa única transação Postgres
([ADR-012](adr-012-outbox-e-idempotencia.md)).

Os diagramas do caminho feliz e das compensações estão em
[sequencia-fluxo-os.md](../sequencia-fluxo-os.md) e
[sequencia-compensacao.md](../sequencia-compensacao.md).

### Passos e o que acontece quando algo falha

| # | Passo (gatilho) | Serviço | Status da OS | Se falhar depois deste ponto |
| --- | --- | --- | --- | --- |
| 1 | Abertura da OS → `SolicitarDiagnostico` | os → execution | `RECEBIDA` | Compensável: `CancelarExecucao` |
| 2 | `DiagnosticoIniciado` / `DiagnosticoConcluido` (itens precificados pelo catálogo) | execution → os | `EM_DIAGNOSTICO` | `DiagnosticoRejeitado` ou itens inválidos cancelam a OS sem nada a desfazer |
| 3 | Reserva de estoque (local, na transação do orquestrador) → `GerarOrcamento` | os → billing | `EM_DIAGNOSTICO` (ou `BLOQUEADA` sem estoque, retomando quando houver) | Compensável: estorno da reserva |
| 4 | `OrcamentoGerado` → aprovação pelo cliente | billing | `AGUARDANDO_APROVACAO` | Compensável: `CancelarOrcamento` + estorno da reserva (rejeição ou prazo) |
| 5 | `OrcamentoAprovado` → pagamento | billing | `AGUARDANDO_PAGAMENTO` | Compensável: `CancelarOrcamento` + estorno da reserva (prazo de pagamento) |
| 6 | **`PagamentoConfirmado`** → `IniciarReparo` | billing → os → execution | `EM_EXECUCAO` | **Fim da compensação automática por falha técnica.** Daqui em diante, comando sem confirmação no prazo leva o fluxo a `FALHA_TECNICA` (decisão humana). Só a falha **de negócio** `ReparoInviavel` compensa sozinha: `EstornarPagamento`, `CancelarOrcamento`, estorno da reserva; o cancelamento pela equipe (`ADMINISTRADOR`) também dispara `CancelarExecucao`, `EstornarPagamento`, `CancelarOrcamento` e o estorno da reserva |
| 7 | **`ReparoConcluido`** | execution → os | `FINALIZADA` | **Ponto sem volta:** reparo feito e pago não se desfaz; `FINALIZADA` não é cancelável. O que vem depois (`FluxoConcluido`, entrega) só é retentável |

Com o adapter de pagamento simulado em uso hoje, `PagamentoConfirmado` só é produzido pelos
testes do orquestrador (ver [ADR-013](adr-013-pagamento-antes-do-reparo-mercado-pago.md)).

Regras que completam a tabela:

- **OS com fluxo ativo não aceita alteração fora do orquestrador.** As rotas que mudavam itens,
  diagnóstico, orçamento ou finalizavam a OS saíram do `os-service`; o cancelamento
  (`POST /os/:id/cancelar`) e o desbloqueio (`POST /os/:id/desbloquear`) da equipe passam pelo
  orquestrador e pelo mesmo lock do fluxo. Só OS abertas antes do orquestrador existir (sem
  `FluxoOrdemServico`) são canceladas localmente.
- **`FALHA_TECNICA` e decisão humana.** Depois do pagamento, uma falha técnica não dispara
  estorno automático: o fluxo para em `FALHA_TECNICA` com alerta, e um `ADMINISTRADOR` decide
  entre `POST /orquestracao/fluxos/:fluxoId/reprocessar` (reenvia o comando pendente com
  `messageId` novo) e `POST /orquestracao/fluxos/:fluxoId/compensar` (dispara as compensações).
  Sem compensações pendentes, eventos atrasados do Execution (`ExecucaoEnfileirada`,
  `ReparoIniciado`, `ReparoConcluido`, `ReparoInviavel`) retomam o fluxo.
- **Compensações são retentáveis.** Compensação sem resposta no prazo é reenviada com
  `messageId` novo até 3 vezes; depois o fluxo vai a `FALHA_TECNICA`. `EstornoFalhou` mantém o
  estorno pendente e adia o prazo.
- **Mensagens fora de ordem** (SQS Standard não ordena): `PagamentoConfirmado` com o fluxo
  ainda em `AGUARDANDO_APROVACAO` vale como aprovação + pagamento; `PagamentoConfirmado` em
  etapa anterior (diagnóstico, espera de estoque, `AGUARDANDO_ORCAMENTO`) ou depois de o fluxo
  compensar gera `EstornarPagamento` (o cliente nunca fica cobrado com a OS cancelada); o mesmo
  `pagamentoId` é ignorado e um `pagamentoId` diferente depois do pagamento do fluxo só gera
  alerta. O ack de `SolicitarDiagnostico` que não chega no
  prazo também envia `CancelarExecucao`, e o Billing que não responde `GerarOrcamento` no
  prazo recebe `CancelarOrcamento`, porque o comando pode ter chegado tarde.

### Falta de isolamento (o I do ACID)

Como cada passo é confirmado no banco do seu serviço, duas anomalias são possíveis neste fluxo:

| Anomalia | Onde aconteceria no fluxo |
| --- | --- |
| **Dirty read** — ler um dado gravado por uma Saga que ainda pode ser desfeita | O cliente consulta e tenta aprovar ou pagar um orçamento que a Saga está cancelando (prazo vencido, cancelamento pela oficina); o Execution trabalha numa ordem cuja OS acabou de ser cancelada; o estoque reservado aparece como consumido para uma OS que vai ser compensada. |
| **Lost update** — duas atualizações concorrentes sobre o mesmo dado, uma sobrescrevendo a outra | Duas réplicas do `os-service` processam ao mesmo tempo eventos do mesmo fluxo (por exemplo `OrcamentoAprovado` e o job de prazo vencido), cada uma lendo a etapa antiga; no Billing, a aprovação do cliente pela API corre contra o `CancelarOrcamento` do orquestrador. |

As contramedidas aplicadas são as duas vistas na aula:

- **Visão Pessimista** — reordenar os passos para que o que é arriscado ou irreversível venha
  depois de tudo o que pode falhar barato. A reserva de estoque (local, desfeita por estorno)
  acontece antes de qualquer passo que envolva dinheiro, e o pagamento é o último passo antes do
  reparo. Assim, uma leitura suja de orçamento ou de estoque nunca custa dinheiro ao cliente sem
  caminho de volta: até o pagamento tudo é compensável, e o pagamento só é pedido quando
  diagnóstico, estoque e aprovação já estão garantidos.
- **Reler Valor** (Rever Valor) — reler o dado imediatamente antes de atualizá-lo e decidir
  sobre o valor relido:
  - no orquestrador, toda decisão sobre um fluxo existente (evento, job de prazos, ação da
    equipe) começa travando a linha do fluxo com
    `SELECT id FROM fluxos_ordem_servico WHERE id = ... FOR UPDATE` (as ações da equipe
    travam a mesma linha por `os_id`) e só então lê o
    `FluxoOrdemServico` e decide. Eventos concorrentes do mesmo fluxo são serializados entre
    réplicas, e cada um vê o estado deixado pelo anterior;
  - no Billing, toda atualização do orçamento no DynamoDB é uma escrita condicional
    `versao = :versaoAnterior`. Se outro processo mudou o orçamento no meio, a escrita falha:
    um comando volta para a fila e é reprocessado sobre o valor relido, e a aprovação do cliente
    recebe `422` ("Orçamento foi alterado durante a aprovação"). O Billing também recusa
    aprovar ou rejeitar orçamento já cancelado ou com prazo de aprovação vencido.

Como complemento, nos termos do livro de referência: o status do fluxo funciona como
*semantic lock* (a OS com fluxo ativo só muda pelo orquestrador), os passos 1–6 são
*compensáveis*, `ReparoConcluido` é o *pivô* e o que vem depois é *retentável*. No Execution,
a fila de trabalho usa `SELECT ... FOR UPDATE SKIP LOCKED`, de modo que dois mecânicos nunca
pegam a mesma ordem.

## Alternativas consideradas

- **Coreografia** (cada serviço reage aos eventos dos outros): descartada. O fluxo tem sete
  passos, prazos e compensações que dependem da etapa; espalhá-los entre três serviços deixaria
  a regra "o que desfazer em cada ponto" sem dono e exigiria que cada serviço conhecesse os
  eventos dos outros. Com o orquestrador, fluxo e compensações ficam num lugar só, o BDD do
  fluxo completo roda contra o orquestrador real e a demonstração mostra o estado da Saga numa
  rota (`GET /orquestracao/fluxos/:osId`). Também reduz o risco de dois desenvolvedores em
  paralelo divergirem no contrato.
- **Orquestrador como serviço próprio**: descartada. O OS já é dono do ciclo de vida da OS e do
  estoque; um quarto serviço exigiria mais um banco e transformaria a reserva de estoque e a
  mudança de status da OS em chamadas remotas.
- **Lock otimista no fluxo** (coluna de versão): descartada no orquestrador. O lock pessimista
  da linha é simples num Postgres e evita reprocessar mensagens por conflito; no Billing, onde o
  DynamoDB não tem lock de linha, a versão com escrita condicional é a forma natural de reler
  valor.

## Consequências (positivas e negativas)

- **Positivo:** o estado de cada Saga é uma linha consultável; compensações, reenvios e
  `FALHA_TECNICA` são decididos por código de domínio puro
  (`src/modules/orquestracao-os/domain/fluxo-ordem-servico.ts`), coberto por testes unitários e
  pelo BDD `test/bdd/features/fluxo-ordem-servico.feature`.
- **Positivo:** Billing e Execution não conhecem o OS nem uns aos outros: recebem comandos e
  publicam eventos.
- **Negativo:** o `os-service` concentra o fluxo e vira ponto central; se ele estiver fora do
  ar, o fluxo para (sem perder mensagens, que esperam nas filas).
- **Negativo:** depois do pagamento uma falha técnica exige ação humana, por escolha: estornar
  automaticamente um cliente cujo reparo pode estar em andamento seria pior que esperar uma
  decisão.
- **Negativo:** o lock pessimista serializa as mensagens de um mesmo fluxo; não é gargalo
  porque cada fluxo recebe poucas mensagens, mas uma transação lenta segura as outras do mesmo
  fluxo.
