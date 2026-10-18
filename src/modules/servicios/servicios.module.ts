import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ServiciosRepository } from './repository/servicios.repository';
import { ServiciosService } from './service/servicios.service';
import { ServiciosController } from './controller/servicios.controller';

@Module({
  imports: [AuthModule],
  controllers: [ServiciosController],
  providers: [ServiciosRepository, ServiciosService],
  exports: [ServiciosService, ServiciosRepository],
})
export class ServiciosModule {}
