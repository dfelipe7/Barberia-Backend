import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { HorariosModule } from '../horarios/horarios.module';
import { ServiciosModule } from '../servicios/servicios.module';
import { ReservasInfraModule } from './reservas-infra.module';
import { ReservasController } from './controller/reservas.controller';
import { ReservasService } from './service/reservas.service';
import { ClientesRepository } from './repository/clientes.repository';
import { OpcionalJwtAuthGuard } from './guards/opcional-jwt-auth.guard';

/**
 * Módulo HTTP y de orquestación de HE-04 (creación de reservas).
 *
 * Grafo acíclico:
 *   ReservasModule ──▶ HorariosModule (DisponibilidadService) ──▶ ReservasInfraModule
 *   ReservasModule ──▶ ReservasInfraModule (ReservasRepository)
 *   ReservasModule ──▶ ServiciosModule  (ServiciosRepository)
 *   ReservasModule ──▶ AuthModule       (JwtModule para el guard opcional)
 *
 * No duplica lógica de disponibilidad: consume `DisponibilidadService` (HE-08).
 */
@Module({
  imports: [
    AuthModule,
    HorariosModule,
    ServiciosModule,
    ReservasInfraModule,
  ],
  controllers: [ReservasController],
  providers: [ReservasService, ClientesRepository, OpcionalJwtAuthGuard],
  exports: [ReservasService],
})
export class ReservasModule {}
