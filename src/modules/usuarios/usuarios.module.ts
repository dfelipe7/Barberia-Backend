import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';

import { UsuariosService } from './service/usuarios.service';
import { AdministradoresService } from './service/administradores.service';
import { BarberosService } from './service/barberos.service';
import { UsuariosAuthorizationService } from './service/usuarios-authorization.service';

import { UsuariosController } from './controller/usuarios.controller';
import { AdministradoresController } from './controller/administradores.controller';
import { BarberosController } from './controller/barberos.controller';

import { UsuariosRepository } from './repository/usuarios.repository';
import { AdministradoresRepository } from './repository/administradores.repository';
import { BarberosRepository } from './repository/barberos.repository';

@Module({
  imports: [AuthModule],
  providers: [
    UsuariosService,
    AdministradoresService,
    BarberosService,
    UsuariosAuthorizationService,
    UsuariosRepository,
    AdministradoresRepository,
    BarberosRepository,
  ],
  controllers: [
    AdministradoresController,
    BarberosController,
    UsuariosController,
  ],
  exports: [UsuariosRepository, AdministradoresRepository, BarberosRepository],
})
export class UsuariosModule {}
