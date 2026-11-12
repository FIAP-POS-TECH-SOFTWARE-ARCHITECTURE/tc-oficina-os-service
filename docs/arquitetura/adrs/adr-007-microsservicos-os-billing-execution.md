# ADR-007: Três microsserviços — OS, Billing e Execution

- **Status:** Aceita
- **Data:** 2026-11-12

## Contexto

O enunciado da Fase 4 exige no mínimo três microsserviços independentes, cada um com
repositório, infraestrutura e banco próprios, e sugere a divisão Ordem de Serviço (abertura,
status, histórico), Orçamento e Pagamento (geração e envio de orçamentos para aprovação,
registro e verificação de pagamentos) e Execução e Produção (fila de execução, status durante
diagnóstico e reparos, comunicação da finalização ao OS).

A Fase 3 entregou um monólito NestJS em Clean Architecture (`tc-oficina-app`) que já fazia
tudo isso: cadastros, OS com máquina de estados, diagnóstico, orçamento, aprovação e controle
de estoque, com testes unitários e e2e. A organização em repositórios e os contratos via SSM
estão na [ADR-001](adr-001-quatro-repositorios-e-contratos-ssm.md); esta ADR acrescenta os
repositórios dos novos serviços.

## Decisão

**Três serviços, seguindo a divisão sugerida pelo enunciado**, com o monólito evoluindo para o
OS service:

| Serviço | Repositório | Responsabilidade |
| --- | --- | --- |
| `os-service` | `tc-oficina-os-service` (o antigo `tc-oficina-app`, renomeado) | Cadastros (clientes, veículos, catálogo de serviços, insumos e estoque, usuários), login da equipe, OS (abertura, status, histórico, acompanhamento do cliente, entrega) e o orquestrador da Saga (módulo `orquestracao-os`, ver [ADR-008](adr-008-saga-orquestrada.md)). |
| `billing-service` | `tc-oficina-billing-service` (novo) | Orçamento gerado a partir do snapshot recebido no comando, aprovação/rejeição pelo cliente, pagamento e estorno. |
| `execution-service` | `tc-oficina-execution-service` (novo) | Fila de diagnóstico e fila de reparo: o mecânico pega a próxima ordem, registra o diagnóstico com os itens necessários, executa e conclui o reparo ou o declara inviável. |

- **Diagnóstico sai do OS e vai para o Execution**: o enunciado põe "atualizar status durante
  diagnóstico e reparos" no serviço de execução. As rotas de diagnóstico e de itens da OS saíram
  do `os-service`; os itens passam a ser gravados pelo orquestrador a partir do evento
  `DiagnosticoConcluido`, e o OS continua dono dos itens e dos preços (catálogo).
- **Orçamento (gerar, aprovar, rejeitar) sai do OS e vai para o Billing**: o enunciado põe
  "geração e envio de orçamentos para aprovação" no serviço de cobrança. As rotas
  `POST /os/:numero/orcamento/aprovar|rejeitar` deixaram de existir; o cliente aprova ou rejeita
  em `/billing/cliente/orcamentos/:numeroOs/...`.
- **Rename do repositório** `tc-oficina-app` → `tc-oficina-os-service`, junto com o nome
  interno: Deployment/Service/labels `os-service`, ECR `oficina-os-service`, app New Relic
  `oficina-os-service-<env>`. O GitHub mantém o redirect do nome antigo, então os links da
  Fase 3 continuam funcionando.
- **Sem biblioteca compartilhada** entre os serviços: o contrato de mensagens fica versionado
  em `contratos/` de cada repositório (ver [ADR-012](adr-012-outbox-e-idempotencia.md)).

## Alternativas consideradas

- **Quatro ou cinco serviços** (cadastros e estoque como serviços próprios): descartada. Cada
  serviço a mais traz repositório, pipeline, banco, deploy e contratos novos, e o estoque é
  reservado dentro da mesma transação em que o orquestrador avança o fluxo — separá-lo
  transformaria uma operação local em mais um passo distribuído com compensação. Três serviços
  cumprem o requisito e concentram o esforço em Saga, mensageria e qualidade.
- **Reescrever o OS do zero**: descartada. O monólito já tinha Clean Architecture, máquina de
  estados e testes; evoluí-lo reaproveita esse código e reduz o risco.
- **Manter diagnóstico e aprovação de orçamento no OS**: descartada. Contraria a divisão de
  responsabilidades do enunciado e deixaria Execution e Billing sem regra de negócio relevante.
- **Manter o nome `tc-oficina-app`** (ou renomear só o repositório): descartada pela assimetria
  com os outros dois serviços e pela confusão entre nome do repositório, imagem e app de
  observabilidade.

## Consequências (positivas e negativas)

- **Positivo:** a divisão segue o enunciado, o que facilita justificar cada serviço; o OS
  preserva os cadastros e a OS da Fase 3 com os testes existentes.
- **Positivo:** cada serviço tem dono claro dos seus dados — o OS é o único que conhece
  clientes, catálogo e estoque; o Billing recebe no comando tudo de que precisa para orçar.
- **Negativo:** o OS continua maior que os outros dois (cadastros + OS + orquestrador). É uma
  escolha consciente: os cadastros não participam do fluxo distribuído.
- **Negativo:** o Execution precisa do catálogo do OS para montar o diagnóstico e o consulta
  por REST interno (`/internal/catalogo/servicos` e `/internal/catalogo/insumos`), um
  acoplamento síncrono entre os dois.
- **Negativo:** o rename deixou recursos legados com o nome antigo durante a transição (por
  exemplo o ECR `oficina-api`, mantido até nenhum Deployment referenciá-lo).
