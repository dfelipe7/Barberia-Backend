import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { UsuariosService } from './service/usuarios.service';
import { UsuariosController } from './controller/usuarios.controller';
import { UsuariosRepository } from './repository/usuarios.repository';

@Module({
  imports: [AuthModule],
  providers: [
    UsuariosService,
    UsuariosRepository,
  ],
  controllers: [UsuariosController],
  exports: [
    UsuariosRepository,
  ],
})
export class UsuariosModule {}