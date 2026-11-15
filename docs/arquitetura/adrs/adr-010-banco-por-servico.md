# ADR-010: Banco por serviço — PostgreSQL no OS e no Execution, DynamoDB no Billing

- **Status:** Aceita
- **Data:** 2026-11-12

## Contexto

O enunciado exige que cada microsserviço tenha banco próprio, que nenhum serviço acesse
diretamente o banco de outro, e que a solução use pelo menos um banco relacional (SQL) e pelo
menos um não relacional (NoSQL). Na Fase 3 havia um único RDS PostgreSQL (`oficina-db`), lido
também pela Lambda de autenticação para validar o CPF do cliente.

Restrições do ambiente: nenhuma conta externa nova (só AWS Academy) e reset periódico da conta,
que apaga o que não for recriado por Terraform.

## Decisão

| Serviço | Banco | Por quê |
| --- | --- | --- |
| `os-service` | RDS PostgreSQL `oficina-db` (o da Fase 3), bancos lógicos `oficina_homolog` / `oficina_prod` | Cadastros, OS, estoque e o fluxo da Saga são relacionais e precisam de transação: o orquestrador muda etapa, status da OS, estoque e outbox de uma vez, sob `SELECT ... FOR UPDATE`. |
| `execution-service` | **RDS PostgreSQL próprio** `oficina-execution-db`, bancos `execution_homolog` / `execution_prod`, credencial própria | A fila de diagnóstico e de reparo usa `SELECT ... FOR UPDATE SKIP LOCKED` para que dois mecânicos nunca peguem a mesma ordem; outbox e `mensagens_processadas` na mesma transação do efeito. Instância separada torna o "banco próprio" inquestionável. |
| `billing-service` | **DynamoDB** `oficina-billing-<env>` (PAY_PER_REQUEST, chave `pk`/`sk`, índice `gsi1`) | O orçamento é um agregado único acessado por chave (`orcamentoId`, `osId`, `numeroOs`); a resposta do provedor de pagamento tem esquema variável, e o modelo reserva para ela o atributo `bruto` do item `PAGAMENTO#`, guardado como veio; a escrita condicional (`attribute_not_exists`, `versao = :versaoAnterior`) e o `TransactWriteItems` dão a idempotência e a releitura de valor de que o fluxo precisa. |

Regra de dados: **nenhum serviço lê o banco de outro.** O que um serviço precisa de outro chega
por mensagem (o comando `GerarOrcamento` leva o snapshot de itens, preços e cliente) ou por
REST interno (o Execution consulta o catálogo em `/internal/catalogo/*`). A Lambda token deixou
de ler o RDS e passou a chamar `GET /internal/clientes/por-documento/:documento` no OS; o OS é o
único que acessa o `oficina-db`.

## Alternativas consideradas

- **MongoDB Atlas**: descartada — conta externa.
- **MongoDB no EKS**: descartada — o volume se perde no reset do Academy, e o banco passaria a
  depender do cluster.
- **Amazon DocumentDB**: descartada — o Billing acessa o orçamento por chave e precisa de
  escrita condicional, o que o DynamoDB entrega sem um cluster de documentos a provisionar.
- **Execution como banco lógico no RDS do OS**: descartada. Seria "banco próprio" só no nome:
  mesma instância e mesmo ponto de falha do OS.

## Consequências (positivas e negativas)

- **Positivo:** cumpre ≥ 1 SQL e ≥ 1 NoSQL sem conta externa; cada banco atende ao padrão de
  acesso do seu serviço.
- **Positivo:** a credencial de banco saiu da Lambda; cada serviço só recebe pelo SSM o
  endereço do seu banco.
- **Negativo:** dois RDS custam mais que um e levam mais tempo para subir após um reset.
- **Negativo:** no DynamoDB não há transação longa nem consulta ad hoc: todo padrão de acesso
  foi desenhado antes (itens `ORCAMENTO#`, `OS#`, `NUMERO_OS#`, `EVENTO#`, `MSG#`,
  `FLUXO_CANCELADO#`, `WEBHOOK#`, `PAGAMENTO#`), e uma listagem nova pode exigir índice novo.
- **Negativo:** dados repetidos entre serviços (o snapshot do orçamento) ficam congelados no
  momento do comando; uma mudança de preço depois do diagnóstico não altera o orçamento.
