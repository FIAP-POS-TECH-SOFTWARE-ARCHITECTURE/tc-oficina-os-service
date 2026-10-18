export const CLIENTES_CONSULTA = Symbol("CLIENTES_CONSULTA");
export const VEICULOS_CONSULTA = Symbol("VEICULOS_CONSULTA");

export interface ClientesConsultaPort {
	buscarPorId(id: string): Promise<{ id: string; ativo: boolean; documento: string; nome: string; email: string | null } | null>;
}

export interface VeiculosConsultaPort {
	buscarPorId(id: string): Promise<{ id: string; ativo: boolean; clienteId: string } | null>;
}
