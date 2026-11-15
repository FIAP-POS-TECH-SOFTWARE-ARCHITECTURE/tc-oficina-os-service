# Roteiro do vídeo de demonstração: Fase 4

Limite do enunciado: **15 minutos**. O roteiro soma **14:00**, deixando 1 minuto de folga para
imprevistos. A demo roda pelo API Gateway de **homolog** com o script
`scripts/demo-fluxo.sh <feliz|rejeicao|inviavel> [--webhook-simulado]`, que imprime cada passo
numerado, a requisição resumida e o status da OS depois de cada evento. O vídeo mostra o script
e os consoles (GitHub Actions, New Relic, AWS) em vez de digitação ao vivo.

O enunciado pede que o vídeo demonstre quatro pontos. Cada bloco abaixo indica qual deles cobre:

- **(A)** Fluxo completo de uma OS passando pelos microsserviços.
- **(B)** Execução do Saga Pattern e tratamento de falhas.
- **(C)** Deploy automatizado de pelo menos um microsserviço com validação de testes.
- **(D)** Monitoramento e rastreamento dos fluxos distribuídos.

## Blocos

| # | Tempo | Duração | Bloco | Item do enunciado |
|---|---|---|---|---|
| 1 | 0:00–1:00 | 1:00 | Abertura e arquitetura geral | contexto (PDF: diagrama geral) |
| 2 | 1:00–2:30 | 1:30 | Divisão em microsserviços e bancos | separação em microsserviços, banco próprio, SQL + NoSQL |
| 3 | 2:30–4:00 | 1:30 | Saga orquestrada | (B) e "documentar a escolha no README" |
| 4 | 4:00–7:30 | 3:30 | Fluxo completo com pagamento | (A) |
| 5 | 7:30–10:00 | 2:30 | Falha e compensação | (B) |
| 6 | 10:00–12:00 | 2:00 | Deploy automatizado | (C) |
| 7 | 12:00–13:30 | 1:30 | Monitoramento e rastreamento | (D) |
| 8 | 13:30–14:00 | 0:30 | Encerramento | (resumo) |

### Bloco 1 (0:00–1:00): abertura

**Tela:** `docs/arquitetura/visao-geral-microsservicos.md` renderizado no GitHub (diagrama
Mermaid).

**Falas-guia:**

- "Somos o grupo Integradores, turma 15SOAT: Lucas Gardini Dias e Thiago Aio."
- "Na Fase 4 o monólito virou três microsserviços: OS, Billing e Execution, cada um com o seu
  repositório, o seu banco e o seu pipeline."
- "A borda continua sendo o API Gateway com autenticação por CPF. Entre os serviços, comandos
  em filas SQS e eventos num tópico SNS."

### Bloco 2 (1:00–2:30): divisão e dados

**Tela:** página da organização no GitHub com os repositórios; console AWS em RDS (instâncias
`oficina-db` e `oficina-execution-db`) e DynamoDB (tabela `oficina-billing-homolog`); tabela
"Serviços" da visão geral.

**Falas-guia:**

- "OS cuida de cadastros, da ordem de serviço e do orquestrador. Billing cuida de orçamento e
  pagamento com Mercado Pago. Execution cuida das filas de diagnóstico e reparo do mecânico."
- "Dois bancos relacionais PostgreSQL (OS e Execution, instâncias separadas) e um NoSQL,
  DynamoDB, no Billing: o orçamento é um agregado acessado por chave, com escrita condicional por
  versão."
- "Nenhum serviço lê o banco de outro. O que um precisa do outro chega por mensagem ou por REST
  interno, como o catálogo que o Execution consulta no OS."

### Bloco 3 (2:30–4:00): Saga orquestrada

**Tela:** seção "Saga Pattern" do README do os-service; `docs/arquitetura/sequencia-fluxo-os.md`;
no editor, `src/modules/orquestracao-os/domain/fluxo-ordem-servico.ts` (função `decidir()`) e
`application/orquestrador-ordem-servico.ts`.

**Falas-guia:**

- "Escolhemos Saga orquestrada, com o orquestrador dentro do OS. O fluxo tem sete passos,
  prazos e compensações que dependem da etapa: com um orquestrador, a regra do que desfazer em
  cada ponto tem um dono só."
- "No código a Saga é o `FluxoOrdemServico`: uma linha por OS, com etapa e status. Cada decisão
  muda etapa, status da OS, estoque e outbox numa transação só, sob `SELECT ... FOR UPDATE`."
- "Até o pagamento tudo é compensável; `ReparoConcluido` é o ponto sem volta."

### Bloco 4 (4:00–7:30): fluxo completo de uma OS

**Tela:** terminal com `bash scripts/demo-fluxo.sh feliz`; janela anônima do navegador para o
Checkout Pro; ao fim, `GET /orquestracao/fluxos/:osId` mostrando o fluxo `CONCLUIDO`.

**Roteiro da tela:**

1. Script faz login da equipe e do mecânico e emite o token do cliente por CPF.
2. Abre a OS (`POST /os`) → OS `RECEBIDA`; mostra o fluxo na etapa `AGUARDANDO_DIAGNOSTICO`.
3. Mecânico pega a próxima ordem da fila de diagnóstico e registra o diagnóstico com um serviço e
   um insumo do catálogo → OS `AGUARDANDO_APROVACAO` (estoque reservado e orçamento gerado no
   Billing).
4. Cliente consulta e aprova o orçamento (`/billing/cliente/orcamentos/:numeroOs/aprovar`) →
   o script imprime o `linkPagamento` e pausa.
5. Pagar no Checkout Pro (ver Preparação) e voltar ao terminal com ENTER. O webhook do Mercado
   Pago chega ao Billing, que publica `PagamentoConfirmado` → OS `EM_EXECUCAO`.
6. Mecânico pega a ordem da fila de reparo e conclui → OS `FINALIZADA`, fluxo `CONCLUIDO`.

**Falas-guia:**

- "Repare que o script nunca muda o status da OS diretamente: cada mudança vem de um evento que
  o orquestrador consumiu."
- "O Billing não confia no corpo do webhook: valida a assinatura `x-signature` e consulta a order
  na API do Mercado Pago antes de confirmar."

**Corte de edição:** o preenchimento do cartão pode ser acelerado na edição (manter só o clique
em pagar e a confirmação).

### Bloco 5 (7:30–10:00): falha e compensação

**Tela:** terminal com `bash scripts/demo-fluxo.sh inviavel`; `GET /orquestracao/fluxos/:osId`
com `compensacoesFeitas`; `GET /billing/orcamentos/:numeroOs` (staff); console SQS com as DLQs;
New Relic em Alerts com a issue da condição "Mensagem em DLQ".

**Roteiro da tela:**

1. Mesmo caminho do bloco 4 até o pagamento (corte de edição entre a aprovação e a confirmação).
2. Mecânico declara o reparo inviável (`POST /execucao/ordens/:id/reparo/inviavel`).
3. Orquestrador: fluxo `COMPENSANDO`, OS `CANCELADA`, reserva de estoque estornada na mesma
   transação; `EstornarPagamento` e `CancelarOrcamento` vão para a fila do Billing.
4. Saída esperada: Billing estorna no Mercado Pago, orçamento `ESTORNADO`, fluxo `COMPENSADO` e
   evento `FluxoCompensado` publicado.
5. Tratamento de falha técnica: mensagem que falha 5 vezes vai para a DLQ e dispara o alerta
   (issue aberta antes da gravação, ver Preparação).

**Falas-guia:**

- "Reparo inviável é falha de negócio depois do pagamento: o orquestrador desfaz as três coisas,
  dinheiro, orçamento e estoque."
- "Compensação sem resposta no prazo é reenviada até 3 vezes; depois o fluxo para em
  `FALHA_TECNICA` e um administrador decide entre reprocessar e compensar."
- "Mensagem que não pode ser processada não se perde: vai para a DLQ e gera alerta."

**Plano B (estorno do sandbox falhou):** é comportamento projetado, não erro. A OS fica
`CANCELADA`, o orçamento fica `ESTORNO_PENDENTE`, o Billing publica `EstornoFalhou` e agenda nova
tentativa (1, 5, 15 e 60 minutos, depois de hora em hora); o fluxo continua `COMPENSANDO` e
`FluxoCompensado` só sai quando o estorno for confirmado. Fala-guia: "o provedor recusou o
estorno; o Billing guardou o estorno como pendente e vai tentar de novo sozinho, e o orquestrador
adia o prazo em vez de travar". Mostrar o orçamento em `ESTORNO_PENDENTE` com a próxima tentativa
e o log `fluxo.estorno_falhou` no New Relic.

### Bloco 6 (10:00–12:00): deploy automatizado com validação de testes

**Tela:** PR pequeno já aberto no `tc-oficina-execution-service` (ou no billing) contra
`develop`; aba Checks do PR; GitHub Actions; terminal com `kubectl get pods -n homolog -w`.

**Roteiro da tela:**

1. Checks do PR: `Lint, build e testes` (com cobertura), `Testes de integração`,
   `Qualidade (SonarQube)` (quality gate "Cobertura 80") e `Contratos sincronizados`, todos
   verdes.
2. Merge em `develop` → workflow `cd.yml` dispara: testes antes do deploy, imagem no ECR com tag
   `homolog-<sha>`, migração, `kubectl apply -k k8s/overlays/homolog`, `rollout status` e smoke
   test de `/health/ready`.
3. Terminal: pods novos subindo em rolling update (`maxUnavailable: 0`).
4. Mostrar a regra de proteção da `main` (PR com aprovação e checks obrigatórios).

**Falas-guia:**

- "Cada serviço tem pipeline próprio. Se a cobertura cair abaixo de 80% ou o quality gate
  reprovar, o PR não passa."
- "O deploy é rolling update: nenhum pod sai antes de o novo ficar pronto."

**Corte de edição:** o CD leva alguns minutos; gravar o início e o fim do run e cortar a espera.

### Bloco 7 (12:00–13:30): monitoramento e rastreamento

**Tela:** New Relic: Distributed tracing de `oficina-os-service-homolog` com o trace do fluxo
do bloco 4; dashboard `Oficina — Fluxo da OS` (página Homolog); Logs filtrados por `fluxoId`.

**Falas-guia:**

- "Cada mensagem carrega `traceparent` e `newrelic` nos atributos do SQS; por isso o fluxo
  aparece como um único trace atravessando os três serviços."
- "O dashboard mostra fluxos iniciados, status final, compensações por motivo, tempo por etapa e
  profundidade das DLQs."
- "Todos os logs do orquestrador levam o `fluxoId`: uma busca reconstrói a história da OS."

### Bloco 8 (13:30–14:00): encerramento

**Tela:** tabela de cobertura do documento de entrega; perfil da organização no GitHub.

**Falas-guia:** "Três serviços com cobertura acima de 80% e quality gate no CI, Saga orquestrada
com compensações, deploy automatizado no EKS e observabilidade ponta a ponta. Os links estão no
PDF de entrega."

## Preparação (antes de gravar, no mesmo dia)

### Ambiente

- [ ] Lab AWS Academy ativo e `scripts/aws-academy-refresh.ps1` rodado (propaga os secrets
  `AWS_*` para os repositórios).
- [ ] `tc-oficina-infra-db/scripts/subir-tudo.sh develop` verde; `/health` dos três serviços
  respondendo `200`; as três DLQs com `ApproximateNumberOfMessages = 0`.
- [ ] Credenciais do Mercado Pago (modo teste) no Secret do billing em homolog. Sem elas o
  billing sobe com o gateway simulado (log `billing.pagamento.gateway-simulado`), o link de
  pagamento não é do Mercado Pago e o pagamento não é confirmado.
- [ ] Webhook do Mercado Pago (modo Teste) apontando para
  `https://<gateway homolog>/billing/webhooks/mercado-pago`.
- [ ] Os três cenários (`feliz`, `rejeicao`, `inviavel`) ensaiados no mesmo dia, cronometrados;
  bloco que estourar o tempo é cortado neste roteiro antes da gravação final.
- [ ] Alerta "Mensagem em DLQ" disparado antes da gravação seguindo o procedimento de
  `docs/observabilidade/alertas.md` (mensagem inválida na fila do billing), com a issue aberta
  e o e-mail recebido; depois, DLQ esvaziada.
- [ ] Tráfego gerado nos dias anteriores (`docs/observabilidade/README.md`, seção 8), para os
  dashboards terem série histórica.
- [ ] PR pequeno preparado no execution (ou billing), com CI verde, pronto para o merge no
  bloco 6.
- [ ] Status checks obrigatórios configurados na `main` do repositório usado no bloco 6 (o
  os-service já tem; billing e execution ainda não). Se não der tempo, mostrar a regra de
  proteção da `main` do os-service.

### Abas abertas

1. Perfil da organização no GitHub e `visao-geral-microsservicos.md`.
2. README do os-service (seção Saga Pattern) e `sequencia-fluxo-os.md`.
3. Editor com `fluxo-ordem-servico.ts` e `orquestrador-ordem-servico.ts`.
4. Console AWS: RDS, DynamoDB e SQS (filtro `oficina-homolog`).
5. Terminal com as variáveis exportadas (abaixo) e outro com `kubectl get pods -n homolog -w`.
6. Janela anônima do navegador, logada na conta de teste **compradora** do Mercado Pago.
7. GitHub: PR do bloco 6 e a aba Actions do repositório.
8. New Relic: Distributed tracing, dashboard `Oficina — Fluxo da OS`, Logs e Alerts.

### Variáveis do terminal

```bash
export GATEWAY_URL=https://<api gateway de homolog>
export ADMIN_EMAIL=<valor do secret ADMIN_BOOTSTRAP_EMAIL>
export ADMIN_SENHA=<valor do secret ADMIN_BOOTSTRAP_PASSWORD>
export CPF_CLIENTE=52998224725
```

### Dados do seed (`prisma/seed.ts`)

| Dado | Valor |
|---|---|
| Cliente da demo | Maria Souza, CPF `52998224725`, veículo `XYZ9876` (Volkswagen Golf) |
| Outro cliente | João Silva, CPF `11144477735`, veículos `ABC1234` e `BRA1A23` |
| Mecânico | `mecanico@oficina.local` (senha no próprio `prisma/seed.ts`) |
| Atendente | `atendente@oficina.local` |
| Administrador | criado no boot pelas variáveis `ADMIN_BOOTSTRAP_EMAIL`/`ADMIN_BOOTSTRAP_PASSWORD` (não está no seed) |
| Catálogo | serviços como "Troca de óleo" e insumos como "Óleo de motor 5W-30" (estoque 50) e "Filtro de óleo" (estoque 30) |

### Mercado Pago (sandbox)

- Pagar sempre logado na **conta de teste compradora** (Suas integrações → aplicação → Contas de
  teste → Comprador), numa janela anônima. Como visitante, o checkout recusa o pagamento porque o
  vendedor é conta de teste.
- Cartão de teste: Mastercard `5480 8328 0103 3311`, CVV `123`, validade `11/30`.
- Titular `APRO` (aprovado). `OTHE` recusa, `CONT` deixa pendente.
- CPF do pagador: `12345678909` (CPF de teste do Mercado Pago; não é o CPF do cliente do seed).

### Planos B

- **Webhook não chegou** (OS parada em `AGUARDANDO_PAGAMENTO` depois de pagar): reconciliar
  como staff com `POST /billing/orcamentos/:numeroOs/reconciliar`, que busca as orders do
  orçamento e aplica as mesmas regras do webhook. O modo `--webhook-simulado` do script reenvia
  uma notificação assinada, mas o billing consulta a order no Mercado Pago antes de confirmar:
  ele só confirma uma order que foi realmente paga.
- **Estorno falhou no sandbox:** ver o plano B do bloco 5 (`ESTORNO_PENDENTE` + retentativa).
- **Ambiente caiu durante a gravação:** regravar o bloco isolado; os blocos são independentes.

## Pós-gravação

- [ ] Conferir a duração (≤ 15:00).
- [ ] Upload no YouTube como **não listado**; testar o link numa janela anônima.
- [ ] Anotar o minuto real de início de cada bloco no `checklist-requisitos-fase-4.md` e o link
  no `entrega-fase-4.md`.
