import {
  ConflictException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';

import { KeycloakService } from '../auth/keycloak/keycloak.service';
import { UsuariosRepository } from '../modules/usuarios/repository/usuarios.repository';

@Injectable()
export class BootstrapService implements OnModuleInit {
  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly usuariosRepository: UsuariosRepository,
  ) {}

  async onModuleInit() {
    await this.sincronizarSuperadmin();
  }

  private async sincronizarSuperadmin() {
    const superadmins =
      await this.keycloakService.obtenerUsuariosPorRol(
        'SUPERADMIN',
      );

    if (superadmins.length === 0) {
      throw new ConflictException(
        'No existe ningún SUPERADMIN en Keycloak',
      );
    }

    if (superadmins.length > 1) {
      throw new ConflictException(
        'Existe más de un SUPERADMIN en Keycloak',
      );
    }

    const superadmin = superadmins[0];

    const usuarioExistente =
      await this.usuariosRepository.obtenerUsuarioPorKeycloakId(
        superadmin.id,
      );

    if (usuarioExistente) {
      console.log(
        'SUPERADMIN ya existe en la base de datos',
      );
      return;
    }

    await this.usuariosRepository.crearUsuario({
      keycloakId: superadmin.id,
      email: superadmin.email,
      nombre: superadmin.firstName ?? '',
      apellido: superadmin.lastName ?? '',
      rol: 'SUPERADMIN',
    });

    console.log(
      'SUPERADMIN sincronizado correctamente en la base de datos',
    );
  }
}