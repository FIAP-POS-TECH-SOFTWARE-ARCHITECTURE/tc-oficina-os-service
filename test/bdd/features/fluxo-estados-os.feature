# language: pt
Funcionalidade: Transições de status da ordem de serviço
  Para manter o histórico do atendimento consistente
  Como equipe da oficina
  Quero que a OS só mude de status por transições permitidas

  Cenário: OS finalizada é entregue ao cliente
    Dado uma OS com status "FINALIZADA"
    Quando a transição "entregar" é solicitada
    Então a transição é permitida
    E o novo status é "ENTREGUE"

  Esquema do Cenário: Transição fora de ordem é recusada
    Dado uma OS com status "<status>"
    Quando a transição "<transicao>" é solicitada
    Então a transição é recusada

    Exemplos:
      | status      | transicao |
      | ENTREGUE    | cancelar  |
      | EM_EXECUCAO | entregar  |
