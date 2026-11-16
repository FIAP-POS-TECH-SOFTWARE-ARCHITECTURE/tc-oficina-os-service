import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { ClientesModule } from "./clientes/clientes.module";
import { InsumosModule } from "./insumos/insumos.module";
import { MensageriaModule } from "./mensageria/mensageria.module";
import { OrdensServicoModule } from "./ordens-servico/ordens-servico.module";
import { OrquestracaoOsModule } from "./orquestracao-os/orquestracao-os.module";
import { ServicosModule } from "./servicos/servicos.module";
import { UsuariosModule } from "./usuarios/usuarios.module";
import { VeiculosModule } from "./veiculos/veiculos.module";

@Module({
	imports: [
		AuthModule,
		UsuariosModule,
		ClientesModule,
		VeiculosModule,
		ServicosModule,
		InsumosModule,
		OrdensServicoModule,
		MensageriaModule,
		OrquestracaoOsModule,
	],
	exports: [AuthModule, UsuariosModule, ClientesModule, VeiculosModule, ServicosModule, InsumosModule, OrdensServicoModule],
})
export class ModulesModule {}
