import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { ServiciosModule } from '../servicios/servicios.module';
import { ReservasInfraModule } from '../reservas/reservas-infra.module';
import { HorarioSemanalController } from './controller/horario-semanal.controller';
import { BloqueosHorarioController } from './controller/bloqueos-horario.controller';
import { DisponibilidadController } from './controller/disponibilidad.controller';
import { DisponibilidadBarberoController } from './controller/disponibilidad-barbero.controller';
import { HorarioSemanalService } from './service/horario-semanal.service';
import { BloqueosHorarioService } from './service/bloqueos-horario.service';
import { DisponibilidadService } from './service/disponibilidad.service';
import { HorariosRepository } from './repository/horarios.repository';
import { BloqueosHorarioRepository } from './repository/bloqueos-horario.repository';
import { CierresGeneralesRepository } from './repository/cierres-generales.repository';
import { FranjaFactory } from './factory/franja.factory';
import { FechaBogotaService } from './common/fecha-bogota.service';
import { DisponibilidadMapper } from './mappers/disponibilidad.mapper';
import { HorarioSemanalRule } from './strategies/horario-semanal.rule';
import { CierreGeneralRule } from './strategies/cierre-general.rule';
import { BloqueoActivoRule } from './strategies/bloqueo-activo.rule';
import { ReservaActivaRule } from './strategies/reserva-activa.rule';
import { REGLAS_DISPONIBILIDAD } from './strategies/regla-disponibilidad.strategy';

@Module({
  imports: [AuthModule, UsuariosModule, ServiciosModule, ReservasInfraModule],
  controllers: [
    HorarioSemanalController,
    BloqueosHorarioController,
    DisponibilidadController,
    DisponibilidadBarberoController,
  ],
  providers: [
    HorariosRepository,
    HorarioSemanalService,
    FranjaFactory,
    FechaBogotaService,
    BloqueosHorarioRepository,
    CierresGeneralesRepository,
    BloqueosHorarioService,
    HorarioSemanalRule,
    CierreGeneralRule,
    BloqueoActivoRule,
    ReservaActivaRule,
    {
      provide: REGLAS_DISPONIBILIDAD,
      useFactory: (
        horarioSemanal: HorarioSemanalRule,
        cierreGeneral: CierreGeneralRule,
        bloqueoActivo: BloqueoActivoRule,
        reservaActiva: ReservaActivaRule,
      ) => [horarioSemanal, cierreGeneral, bloqueoActivo, reservaActiva],
      inject: [
        HorarioSemanalRule,
        CierreGeneralRule,
        BloqueoActivoRule,
        ReservaActivaRule,
      ],
    },
    DisponibilidadMapper,
    DisponibilidadService,
  ],
  exports: [
    HorarioSemanalService,
    HorariosRepository,
    FranjaFactory,
    BloqueosHorarioService,
    BloqueosHorarioRepository,
    CierresGeneralesRepository,
    DisponibilidadService,
    DisponibilidadMapper,
    REGLAS_DISPONIBILIDAD,
  ],
})
export class HorariosModule {}
