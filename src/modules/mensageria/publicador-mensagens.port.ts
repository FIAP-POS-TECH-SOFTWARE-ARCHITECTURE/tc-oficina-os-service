import { FilaComando } from "./configuracao-mensageria";
import { EnvelopeMensagem } from "./envelope";
import { CabecalhosTrace } from "./trace";

export const PUBLICADOR_MENSAGENS = Symbol("PUBLICADOR_MENSAGENS");
export const CLIENTE_SQS = Symbol("CLIENTE_SQS");
export const CLIENTE_SNS = Symbol("CLIENTE_SNS");

export interface PublicadorMensagensPort {
	enviarComando(fila: FilaComando, envelope: EnvelopeMensagem<unknown>, trace?: CabecalhosTrace): Promise<void>;
	publicarEvento(envelope: EnvelopeMensagem<unknown>, trace?: CabecalhosTrace): Promise<void>;
}
