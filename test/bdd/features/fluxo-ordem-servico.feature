# language: pt
Funcionalidade: Fluxo da ordem de serviço coordenado pelo orquestrador
  Para que abertura, diagnóstico, orçamento, pagamento e reparo fiquem consistentes entre os serviços
  Como oficina
  Quero que o orquestrador avance a OS e compense o que já foi feito quando uma etapa falhar

  Contexto:
    Dado um cliente com veículo cadastrado
    E o serviço "Troca de óleo" custando 120.00
    E o insumo "Óleo 5W30" custando 45.00 com 10 unidades em estoque

  Cenário: Caminho feliz até a OS finalizada
    Quando o atendente abre a OS
    Então o comando "SolicitarDiagnostico" é enviado ao execution
    Quando o execution confirma o diagnóstico com 1 "Troca de óleo" e 4 "Óleo 5W30"
    Então o estoque de "Óleo 5W30" fica em 6
    E o comando "GerarOrcamento" é enviado ao billing com total de 30000 centavos
    Quando o billing gera o orçamento
    E o cliente aprova o orçamento
    Então a OS fica "AGUARDANDO_PAGAMENTO"
    Quando o pagamento é confirmado
    Então o comando "IniciarReparo" é enviado ao execution
    E a OS fica "EM_EXECUCAO"
    Quando o execution conclui o reparo
    Então a OS fica "FINALIZADA"
    E o fluxo fica "CONCLUIDO"
    E o evento "FluxoConcluido" é publicado

  Cenário: Orçamento rejeitado devolve o estoque e cancela a OS
    Dado uma OS com orçamento aguardando aprovação
    Quando o cliente rejeita o orçamento
    Então o comando "CancelarOrcamento" é enviado ao billing
    E o estoque de "Óleo 5W30" fica em 10
    E a OS fica "CANCELADA"
    Quando o billing confirma o cancelamento do orçamento
    Então o fluxo fica "COMPENSADO"
    E o evento "FluxoCompensado" é publicado com as compensações "CancelarOrcamento,EstornarReservaEstoque"

  Cenário: Reparo inviável depois do pagamento estorna o pagamento, o orçamento e o estoque
    Dado uma OS paga com reparo em andamento
    Quando o execution declara o reparo inviável
    Então os comandos "EstornarPagamento,CancelarOrcamento" são enviados ao billing
    E o estoque de "Óleo 5W30" fica em 10
    E a OS fica "CANCELADA"
    Quando o billing confirma o estorno do pagamento
    E o billing confirma o cancelamento do orçamento
    Então o fluxo fica "COMPENSADO"
    E o evento "FluxoCompensado" é publicado com as compensações "CancelarOrcamento,EstornarPagamento,EstornarReservaEstoque"

  Cenário: Falta de estoque bloqueia a OS e a entrada de estoque retoma o fluxo
    Quando o atendente abre a OS
    E o execution confirma o diagnóstico com 1 "Troca de óleo" e 12 "Óleo 5W30"
    Então a OS fica "BLOQUEADA"
    E nenhum comando "GerarOrcamento" foi enviado
    Quando chegam 5 unidades de "Óleo 5W30" ao estoque
    E a verificação periódica do fluxo roda
    Então a OS fica "EM_DIAGNOSTICO"
    E o estoque de "Óleo 5W30" fica em 3
    E o comando "GerarOrcamento" é enviado ao billing com total de 66000 centavos

  Cenário: Prazo de aprovação expira sem resposta do cliente
    Dado uma OS com orçamento aguardando aprovação
    Quando o prazo de aprovação passa sem resposta do cliente
    Então o comando "CancelarOrcamento" é enviado ao billing
    E o estoque de "Óleo 5W30" fica em 10
    E a OS fica "CANCELADA"

  Cenário: Pagamento que chega depois do cancelamento é estornado
    Dado uma OS aguardando pagamento
    Quando o prazo de pagamento passa
    E o billing confirma o cancelamento do orçamento
    Então o fluxo fica "COMPENSADO"
    Quando o pagamento é confirmado
    Então o comando "EstornarPagamento" é enviado ao billing
    E o fluxo fica "COMPENSANDO"
    E a OS fica "CANCELADA"

  Cenário: Mensagem entregue duas vezes não duplica o efeito
    Quando o atendente abre a OS
    E o execution confirma o diagnóstico com 1 "Troca de óleo" e 4 "Óleo 5W30"
    E a mesma mensagem "DiagnosticoConcluido" é entregue de novo
    Então o estoque de "Óleo 5W30" fica em 6
    E o comando "GerarOrcamento" foi enviado 1 vez
