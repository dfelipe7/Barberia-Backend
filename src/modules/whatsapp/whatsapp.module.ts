import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppPlantillasRepository } from './whatsapp-plantillas.repository';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, WhatsAppPlantillasRepository],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
