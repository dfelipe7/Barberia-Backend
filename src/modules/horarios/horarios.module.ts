import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { HorarioSemanalController } from './controller/horario-semanal.controller';
import { BloqueosHorarioController } from './controller/bloqueos-horario.controller';
import { HorarioSemanalService } from './service/horario-semanal.service';
import { BloqueosHorarioService } from './service/bloqueos-horario.service';
import { HorariosRepository } from './repository/horarios.repository';
import { BloqueosHorarioRepository } from './repository/bloqueos-horario.repository';
import { CierresGeneralesRepository } from './repository/cierres-generales.repository';
import { FranjaFactory } from './factory/franja.factory';
import { FechaBogotaService } from './common/fecha-bogota.service';
import {
  PROVEEDOR_RESERVAS_ACTIVAS,
  ProveedorReservasActivasNoDisponible,
} from './ports/proveedor-reservas-activas.port';

@Module({
  imports: [AuthModule, UsuariosModule],
  controllers: [HorarioSemanalController, BloqueosHorarioController],
  providers: [
    HorariosRepository,
    HorarioSemanalService,
    FranjaFactory,
    FechaBogotaService,
    BloqueosHorarioRepository,
    CierresGeneralesRepository,
    BloqueosHorarioService,
    {
      provide: PROVEEDOR_RESERVAS_ACTIVAS,
      useClass: ProveedorReservasActivasNoDisponible,
    },
  ],
  exports: [
    HorarioSemanalService,
    HorariosRepository,
    FranjaFactory,
    BloqueosHorarioService,
    BloqueosHorarioRepository,
    CierresGeneralesRepository,
  ],
})
export class HorariosModule {}
