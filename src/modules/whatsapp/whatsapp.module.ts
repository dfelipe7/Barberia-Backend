import { Module } from '@nestjs/common';
import { WhatsAppService } from './service/whatsapp.service';
import { WhatsAppController } from './controller/whatsapp.controller';
import { WhatsAppPlantillasRepository } from './repository/whatsapp-plantillas.repository';
import { AuthModule } from '../../auth/auth.module';
import { PerfilNegocioModule } from '../perfil-negocio/perfil-negocio.module';

@Module({
  // `PerfilNegocioModule` aporta la dirección COMERCIAL del negocio del
  // contexto, que es la fuente canónica de los mensajes de WhatsApp.
  imports: [AuthModule, PerfilNegocioModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, WhatsAppPlantillasRepository],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
