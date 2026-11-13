# ADR-014: Qualidade com SonarQube no CI, BDD em pt-BR e MiniStack como emulador AWS

- **Status:** Aceita
- **Data:** 2026-11-12

## Contexto

O enunciado exige testes unitários em todos os microsserviços, pelo menos um fluxo completo
testado com BDD, cobertura mínima de 80% por serviço e validação de qualidade do código via
SonarQube ou similar no CI. Na Fase 3 o SonarQube rodava só localmente e o limite de cobertura
de branches era 70%.

Restrição do projeto: nenhuma conta externa nova. Os testes de integração precisam de SNS, SQS,
DynamoDB e SSM sem depender da conta do AWS Academy, que expira por sessão.

## Decisão

- **SonarQube Community como service container no GitHub Actions**: o job
  "Qualidade (SonarQube)" do `ci.yml` de cada serviço sobe `sonarqube:community` como
  `services:`, baixa o `lcov` gerado pelo job de testes e roda `scripts/sonar-quality-gate.sh`.
  O script cria o quality gate **"Cobertura 80"** (condições `coverage` e `new_coverage` com
  erro abaixo de 80%), analisa o projeto e consulta `/api/qualitygates/project_status`; gate
  reprovado falha o job. O mesmo script roda localmente (`npm run sonar:up` +
  `npm run sonar:scan`).
- **Cobertura no Jest**: `coverageThreshold` global de 80% em statements, branches, functions e
  lines nos três serviços — `npm run test:cov` falha abaixo disso, antes mesmo do SonarQube.
- **BDD com `jest-cucumber`, Gherkin em pt-BR** (`# language: pt`), rodando no mesmo Jest
  (`roots` inclui `test/bdd`), portanto dentro da cobertura e do CI:
  - `tc-oficina-os-service`: `test/bdd/features/fluxo-ordem-servico.feature` — o fluxo completo
    da OS com o orquestrador real e os adapters de mensageria em memória simulando Billing e
    Execution (caminho feliz, orçamento rejeitado, reparo inviável com estorno, bloqueio por
    estoque, prazo de aprovação expirado, pagamento atrasado estornado, mensagem duplicada) — e
    `fluxo-estados-os.feature`;
  - `tc-oficina-billing-service`: `aprovacao-orcamento.feature`;
  - `tc-oficina-execution-service`: `fila-reparo.feature`.
- **MiniStack no lugar do LocalStack** como emulador AWS local: imagem
  `ministackorg/ministack` no `dev/docker-compose.yml` (desenvolvimento, `npm run ministack:up`)
  e via Testcontainers nos testes de integração (`npm run test:integracao`), com as mesmas filas,
  tópico e assinatura do ambiente `local`.

## Alternativas consideradas

- **SonarCloud**: descartada — exige conta externa.
- **LocalStack**: descartada — a edição Community passou a exigir plano pago; o MiniStack é
  MIT, sem conta e compatível com o Terraform.

## Consequências (positivas e negativas)

- **Positivo:** a verificação de qualidade é reprodutível sem nenhuma conta externa, no CI e na
  máquina de cada desenvolvedor; o gate falha o job do CI no PR quando a cobertura cai.
- **Positivo:** o BDD do fluxo completo documenta a Saga em linguagem de negócio e roda a cada
  PR.
- **Positivo:** testes de integração com mensageria e DynamoDB não dependem de credencial AWS.
- **Negativo:** subir o SonarQube a cada execução deixa o job mais lento (alguns minutos para o
  servidor ficar `UP`).
- **Negativo:** o MiniStack é um emulador; diferenças de comportamento em relação à AWS (por
  exemplo no `FilterPolicy`) só aparecem no ambiente real, por isso o consumidor do orquestrador
  descarta com aviso eventos de origem inesperada em vez de falhar.
- **Negativo:** o `npm test` do `os-service` passou a exigir Docker (o BDD do fluxo usa
  Postgres real via Testcontainers).
