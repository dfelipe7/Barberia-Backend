import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { HorarioSemanalController } from './controller/horario-semanal.controller';
import { HorarioSemanalService } from './service/horario-semanal.service';
import { HorariosRepository } from './repository/horarios.repository';
import { FranjaFactory } from './factory/franja.factory';

@Module({
  imports: [AuthModule, UsuariosModule],
  controllers: [HorarioSemanalController],
  providers: [HorariosRepository, HorarioSemanalService, FranjaFactory],
  exports: [HorarioSemanalService, HorariosRepository, FranjaFactory],
})
export class HorariosModule {}
