# ADR-011: Infraestrutura de dados centralizada em `tc-oficina-infra-db`

- **Status:** Aceita
- **Data:** 2026-11-12

## Contexto

O enunciado pede que cada microsserviço tenha o seu repositório, a sua infraestrutura e o seu
banco de dados. Com três bancos ([ADR-010](adr-010-banco-por-servico.md)) e a mensageria
([ADR-009](adr-009-mensageria-sns-sqs.md)), é preciso decidir onde fica o Terraform de cada
recurso.

A leitura adotada do enunciado: "infraestrutura própria" significa que cada serviço tem recursos
só seus — banco, credencial, filas, imagem, Deployment —, não que o Terraform desses recursos
precise estar no mesmo repositório do código do serviço. A Fase 3 já separava o Terraform em
`tc-oficina-infra-k8s` e `tc-oficina-infra-db` ([ADR-001](adr-001-quatro-repositorios-e-contratos-ssm.md)).

O AWS Academy reinicia a conta periodicamente; recuperar o ambiente precisa ser rápido e
previsível.

## Decisão

**Todos os bancos ficam em `tc-oficina-infra-db`**, num único root module, com os arquivos
separados por dono:

| Arquivos | Recursos |
| --- | --- |
| `os-rds.tf`, `os-databases.tf`, `os-ssm.tf` | RDS `oficina-db`, bancos `oficina_homolog` / `oficina_prod`, SSM `database-url` |
| `execution-rds.tf`, `execution-databases.tf`, `execution-ssm.tf` | RDS `oficina-execution-db`, bancos `execution_homolog` / `execution_prod`, credencial própria, SSM `execution/database-url` |
| `billing-dynamodb.tf`, `billing-ssm.tf` | Tabelas DynamoDB `oficina-billing-homolog` / `oficina-billing-prod`, SSM `billing/dynamodb-table` |
| `comum-rede.tf`, `comum-ssm.tf` | Rede dos RDS e segredos compartilhados por ambiente (`jwt-secret`, `internal-api-key`) |

- **`prevent_destroy`** nos três bancos (as duas instâncias RDS e as tabelas DynamoDB): um
  `apply` que tentasse recriá-los falha em vez de apagar dados.
- **Root module único, sem módulos por serviço**: mover os recursos para módulos mudaria os
  endereços no state e o Terraform recriaria os bancos.
- A mensageria fica em `tc-oficina-infra-k8s`, junto da plataforma (VPC, EKS, ECR), porque é
  compartilhada pelos três serviços.
- Cada serviço recebe só o que é dele pelo SSM (`/oficina/<env>/...`); os pipelines dos
  serviços não rodam Terraform.

## Alternativas consideradas

- **Terraform dentro do repositório de cada serviço**: descartada. Cada pipeline de serviço
  passaria a precisar de state remoto, credenciais de infraestrutura e `plan`/`apply`; a
  recuperação após um reset do Academy ficaria espalhada em três repositórios com ordem de
  execução entre eles (a rede dos RDS depende do state do `tc-oficina-infra-k8s`).
- **Renomear `tc-oficina-infra-db`** ou criar um repositório de infraestrutura por banco:
  descartada. Mesmo modelo aceito na Fase 3; renomear só moveria links e state sem ganho.
- **Módulos Terraform por serviço**: descartada pelo risco de recriação dos bancos já
  existentes descrito acima.

## Consequências (positivas e negativas)

- **Positivo:** um reset do Academy se resolve num lugar só; o script `scripts/subir-tudo.sh`
  dispara os CDs de infraestrutura e de serviços na ordem certa.
- **Positivo:** os arquivos por dono deixam claro qual recurso é de qual serviço, e o banco de um
  serviço nunca é exposto a outro (cada um lê só o seu parâmetro SSM).
- **Negativo:** uma mudança de banco de um serviço passa por um PR em outro repositório.
- **Negativo:** toda mudança em recurso existente exige conferir no `plan` que não há destroy
  nem replace; o `prevent_destroy` barra o pior caso, mas não substitui a revisão.
