import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { HorariosModule } from '../horarios/horarios.module';
import { ServiciosModule } from '../servicios/servicios.module';
import { ReservasInfraModule } from './reservas-infra.module';
import { ClientesAuthModule } from '../../auth/clientes/clientes-auth.module';
import { ReservasController } from './controller/reservas.controller';
import { ReservasService } from './service/reservas.service';

import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { RecordatoriosCron } from './cron/recordatorios.cron';

/**
 * Módulo HTTP y de orquestación de HE-04 (creación y consulta de reservas).
 *
 * Grafo acíclico:
 *   ReservasModule ──▶ HorariosModule    (DisponibilidadService) ──▶ ReservasInfraModule
 *   ReservasModule ──▶ ServiciosModule   (ServiciosRepository)
 *   ReservasModule ──▶ ReservasInfraModule (ReservasRepository, ClientesRepository)
 *   ReservasModule ──▶ ClientesAuthModule  (guards de cliente de HE-04)
 *   ReservasModule ──▶ UsuariosModule      (BarberosRepository para agenda del barbero)
 *   ReservasModule ──▶ AuthModule          (guards de personal JWT/Roles)
 *   ReservasModule ──▶ WhatsAppModule      (WhatsAppService para confirmaciones y recordatorios)
 *
 * No duplica lógica de disponibilidad: consume `DisponibilidadService` (HE-08).
 * La identidad/autenticación de clientes vive en `ClientesAuthModule`.
 */
@Module({
  imports: [
    AuthModule,
    UsuariosModule,
    HorariosModule,
    ServiciosModule,
    ReservasInfraModule,
    ClientesAuthModule,
    WhatsAppModule,
  ],
  controllers: [ReservasController],
  providers: [ReservasService, RecordatoriosCron],
  exports: [ReservasService],
})
export class ReservasModule {}
