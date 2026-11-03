# Políticas de alerta — New Relic

Policy única: **`Oficina — Alertas`**, conta do grupo (região US).
Destino das notificações: **workflow com destination de e-mail do grupo** (Alerts → Destinations → Email → Workflows → `Oficina — Alertas` → notificar todas as issues).

As oito condições abaixo cobrem o bloco "Monitoramento e Observabilidade" do enunciado. A condição 1 é a exigida explicitamente ("alerta de falha no processamento de ordens de serviço") e é a que deve ser demonstrada com disparo real no vídeo. As condições 5 a 8 cobrem a mensageria e a orquestração entre os três serviços (Fase 4); a nº 5 é a que se dispara em homolog para evidenciar o alerta de mensageria.

---

## 1. Falha no processamento de ordens de serviço — **Critical**

Condição NRQL:

```sql
SELECT count(*) FROM Log
WHERE (level = 'error' OR numeric(level) >= 50)
  AND (event LIKE 'os.%' OR event = 'integration.error')
```

| Parâmetro | Valor |
|---|---|
| Tipo | NRQL, static |
| Threshold | `above 0` por **5 minutos** → Critical |
| Janela de agregação | 1 minuto, event timer/flow |
| Sinal perdido | não abrir issue (o app pode ficar legitimamente sem erros) |

**Por que o filtro de nível é duplo (`level = 'error' OR numeric(level) >= 50`):** o `pino` serializa o nível como número (`50` = error), enquanto o agente APM Node, quando encaminha os logs (`NEW_RELIC_APPLICATION_LOGGING_FORWARDING_ENABLED=true` em [k8s/base/os-service-deployment.yaml](../../k8s/base/os-service-deployment.yaml)), envia o rótulo em texto. Como as duas rotas de ingestão estão ativas hoje (ver "Fonte dupla de logs" no [runbook](README.md)), o filtro precisa aceitar as duas formas — só com `level = 'error'` a condição **não dispara** para os registros vindos do Fluent Bit. Depois de consolidar uma única fonte, simplificar para a forma que sobrar.

**Como simular** (fazer em **homolog**, avisando o grupo antes):

```bash
# 1. quebra o SMTP: host inexistente
kubectl -n homolog patch configmap os-service-config \
  --type merge -p '{"data":{"SMTP_HOST":"smtp-invalido.local"}}'
kubectl -n homolog rollout restart deployment/os-service
kubectl -n homolog rollout status deployment/os-service --timeout=300s

# 2. gera uma notificação: criar OS e mover o status pela API (collection Bruno,
#    pasta bruno/Oficina-API/OrdensServico) -> o NotificadorSmtpGateway falha e loga
#    { event: "integration.error", integration: "smtp", ... }

# 3. confere o log e espera o alerta (até ~6 min: 5 min de threshold + ingestão)
#    NRQL: SELECT * FROM Log WHERE event = 'integration.error' SINCE 15 minutes ago

# 4. REVERTE (não esquecer)
kubectl -n homolog patch configmap os-service-config \
  --type merge -p '{"data":{"SMTP_HOST":"mailhog"}}'
kubectl -n homolog rollout restart deployment/os-service
```

Evidência para o PDF/vídeo: e-mail recebido + a issue aberta em Alerts → Issues & activity.

---

## 2. API fora do ar (healthcheck) — **Critical**

Tipo: condição de **Synthetics monitor failure**, cobrindo os dois monitores de healthcheck:

- `oficina-health-homolog` — ping em `https://<api_endpoint homolog>/health`
- `oficina-health-prod` — ping em `https://<api_endpoint prod>/health`

| Parâmetro | Valor |
|---|---|
| Threshold | 2 falhas consecutivas (evita alarme por blip de rede) |
| Período do monitor | 5 minutos, localidade US East |

A URL é o endpoint do **API Gateway**, não o LoadBalancer do EKS: assim o uptime mede a cadeia inteira (gateway → LB → EKS → app), que é o que o usuário final enxerga.

---

## 3. Latência alta em produção — **Warning**

```sql
SELECT percentile(duration, 95) FROM Transaction WHERE appName = 'oficina-os-service-prod'
```

| Parâmetro | Valor |
|---|---|
| Threshold | `above 1` (segundo) por **5 minutos** → Warning |
| Janela de agregação | 1 minuto |

`duration` em `Transaction` é em **segundos** — o threshold `1` significa p95 acima de 1s.

---

## 4. Pods saturados (CPU) — **Warning**

```sql
SELECT average(cpuCoresUtilization) FROM K8sContainerSample
WHERE clusterName = 'oficina-eks' AND containerName = 'os-service'
```

| Parâmetro | Valor |
|---|---|
| Threshold | `above 90` (%) por **10 minutos** → Warning |

Complementa o HPA em vez de duplicá-lo: o HPA escala em 70% de CPU (`k8s/base/os-service-hpa.yaml`); se a utilização fica acima de 90% por 10 minutos, é sinal de que a escalada não deu conta (teto de réplicas ou falta de nós), o que exige ação humana.

---

## 5. Mensagem em DLQ — **Critical**

Condição NRQL:

```sql
SELECT max(numeric(mensagens)) FROM Log
WHERE event = 'mensageria.dlq_profundidade' AND container_name = 'os-service'
FACET fila
```

| Parâmetro | Valor |
|---|---|
| Tipo | NRQL, static |
| Threshold | `above 0` por **5 minutos** → Critical |
| Janela de agregação | 1 minuto |
| Sinal perdido | não abrir issue |

O `MonitorDlq` do os-service consulta a cada 60 s a profundidade das filas de mensagens mortas (as três DLQs, lidas dos parâmetros do SSM) e loga `{ event: "mensageria.dlq_profundidade", fila, mensagens }`; a mesma medida vai para a métrica `Custom/Mensageria/DLQ/<fila>`. O `FACET fila` abre uma série por DLQ, então a issue indica qual fila acumulou mensagem. Se o monitor falhar, loga `mensageria.dlq_erro` (e `mensageria.dlq_monitor_desligado` quando não há fila configurada); nesses casos a condição fica sem dados e **não** alerta, por isso vale procurar esses dois eventos quando uma DLQ parecer vazia demais.

**Como simular** (em **homolog**, avisando o grupo antes): publicar na fila de comandos do billing uma mensagem inválida. Ela não é apagada pelo consumidor e vai para a DLQ após 5 recebimentos (contrato §1).

```bash
URL=$(aws ssm get-parameter --name /oficina/homolog/mensageria/billing-comandos-url --query Parameter.Value --output text)
aws sqs send-message --queue-url "$URL" --message-body '{"tipo":"Invalida"}' \
  --message-attributes 'tipo={DataType=String,StringValue=Invalida},origem={DataType=String,StringValue=os}'
```

Esperar cerca de 6 minutos (5 recebimentos × visibility timeout de 60 s) mais os 5 minutos da condição; o e-mail do alerta chega em seguida. Guardar o print da issue e do e-mail para o PDF. Depois, limpar a DLQ:

```bash
aws sqs purge-queue --queue-url $(aws ssm get-parameter --name /oficina/homolog/mensageria/billing-comandos-dlq-url --query Parameter.Value --output text)
```

---

## 6. Fluxo em falha técnica — **Critical**

```sql
SELECT count(*) FROM Log WHERE event = 'fluxo.falha_tecnica'
```

| Parâmetro | Valor |
|---|---|
| Threshold | `above 0` em **5 minutos** → Critical |

O orquestrador loga `fluxo.falha_tecnica` quando um fluxo termina em `FALHA_TECNICA` (por exemplo, a execução não confirmou o reparo no prazo). É um fluxo que precisa de intervenção humana.

---

## 7. Compensação travada — **Critical**

```sql
SELECT count(*) FROM Log WHERE event = 'fluxo.compensacao_travada'
```

| Parâmetro | Valor |
|---|---|
| Threshold | `above 0` em **5 minutos** → Critical |

Emitido quando a compensação de um fluxo esgotou os reenvios sem resposta dos serviços; o fluxo vai para `FALHA_TECNICA` com compensações pendentes.

---

## 8. Estorno esgotado / falha definitiva de outbox — **Critical**

```sql
SELECT count(*) FROM Log WHERE event IN ('billing.estorno.esgotado', 'outbox.falha_definitiva')
```

| Parâmetro | Valor |
|---|---|
| Threshold | `above 0` em **5 minutos** → Critical |

`outbox.falha_definitiva` vem do relay do outbox (os-service e execution) quando uma mensagem esgota as tentativas de publicação. `billing.estorno.esgotado` é o evento do billing para o estorno que esgotou as tentativas; ele só passa a ser emitido quando a integração de pagamento existir, e até lá a condição cobre apenas o outbox.

As condições 5 a 8 notificam o mesmo workflow de e-mail da policy.

---

## Checklist de criação na UI

1. Alerts → Alert policies → **Create** → nome `Oficina — Alertas` → incident preference **por condição**.
2. Criar as 8 condições (as 7 NRQL via "NRQL query"; a 2 via "Synthetics monitor failure").
3. Alerts → Destinations → **Email** → e-mail do grupo.
4. Alerts → Workflows → novo workflow filtrando `policyName = 'Oficina — Alertas'` → destination criada acima.
5. Rodar a simulação da condição 1 e guardar o print do e-mail.
6. Rodar a simulação da condição 5 (seção 5) e guardar o print da issue e do e-mail.
