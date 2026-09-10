import {
  ConflictException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';

import { KeycloakService } from '../auth/keycloak/keycloak.service';
import { UsuariosRepository } from '../modules/usuarios/repository/usuarios.repository';

/**
 * Servicio de Arranque (Bootstrap)
 * 
 * Este servicio utiliza el ciclo de vida `OnModuleInit` de NestJS.
 * Significa que su código se ejecutará automáticamente UNA SOLA VEZ
 * cada vez que el servidor backend se encienda.
 * 
 * Su propósito principal es "preparar el terreno". En este caso,
 * garantiza que siempre exista al menos un usuario fundador (Superadmin)
 * en la base de datos MySQL local para que el sistema no se quede bloqueado.
 */
@Injectable()
export class BootstrapService implements OnModuleInit {
  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly usuariosRepository: UsuariosRepository,
  ) {}

  // Este método se dispara automáticamente al iniciar NestJS
  async onModuleInit() {
    await this.sincronizarSuperadmin();
  }

  /**
   * Sincronizador Maestro:
   * 1. Va a Keycloak (la fuente de la verdad) y busca quién tiene el rol SUPERADMIN.
   * 2. Si no hay nadie en Keycloak, detiene el servidor (Error).
   * 3. Si lo encuentra, revisa si ya lo teníamos guardado en nuestro MySQL.
   * 4. Si es nuevo, lo guarda automáticamente en MySQL para que el sistema
   *    pueda empezar a operar.
   */
  private async sincronizarSuperadmin() {
    // Paso 1: Buscar en Keycloak
    const superadmins =
      await this.keycloakService.obtenerUsuariosPorRol(
        'SUPERADMIN',
      );

    // Paso 2: Validación de seguridad
    if (superadmins.length === 0) {
      throw new ConflictException(
        'No existe ningún SUPERADMIN en Keycloak',
      );
    }

    // Paso 3 y 4: Sincronización en la base de datos local
    for (const superadmin of superadmins) {
      const usuarioExistente =
        await this.usuariosRepository.obtenerUsuarioPorKeycloakId(
          superadmin.id,
        );

      if (usuarioExistente) {
        console.log(
          `SUPERADMIN ${superadmin.email} ya existe en la base de datos (No se requiere acción)`,
        );
        continue;
      }

      await this.usuariosRepository.crearUsuario({
        keycloakId: superadmin.id,
        email: superadmin.email,
        nombre: superadmin.firstName ?? '',
        apellido: superadmin.lastName ?? '',
        rol: 'SUPERADMIN',
      });

      console.log(
        `SUPERADMIN ${superadmin.email} creado y sincronizado correctamente por primera vez`,
      );
    }
  }
}