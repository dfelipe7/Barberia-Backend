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

  async onModuleInit() {
    await this.esperarYSincronizarSuperadmin();
  }

  /**
   * Reintenta la conexión con Keycloak periódicamente.
   * Esto previene que el backend se caiga si Keycloak tarda 20-30 segundos en 
   * inicializar su base de datos e importar el realm durante el primer docker compose up.
   */
  private async esperarYSincronizarSuperadmin(intentos = 20, esperaMs = 3000) {
    for (let i = 1; i <= intentos; i++) { // NOSONAR
      try {
        console.log(`[Bootstrap] Conectando con Keycloak para sincronizar SUPERADMIN (Intento ${i}/${intentos})...`);
        await this.sincronizarSuperadmin();
        console.log(`[Bootstrap] Sincronización con Keycloak completada exitosamente.`);
        return;
      } catch (error: any) {
        if (i === intentos) {
          console.error('[Bootstrap] Error definitivo conectando con Keycloak tras varios intentos:', error?.message || error);
          throw error;
        }
        console.warn(`[Bootstrap] Keycloak aún no está listo (${error?.message || 'iniciando'}). Reintentando en ${esperaMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, esperaMs));
      }
    }
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
    await Promise.all(
      superadmins.map(async (superadmin) => {
        const usuarioExistente = await this.usuariosRepository.obtenerUsuarioPorKeycloakId(superadmin.id);

        if (usuarioExistente) {
          console.log(`SUPERADMIN ${superadmin.email} ya existe en la base de datos (No se requiere acción)`);
          return;
        }

        await this.usuariosRepository.crearUsuario({
          keycloakId: superadmin.id,
          email: superadmin.email,
          nombre: superadmin.firstName ?? '',
          apellido: superadmin.lastName ?? '',
          rol: 'SUPERADMIN',
        });

        console.log(`SUPERADMIN ${superadmin.email} creado y sincronizado correctamente por primera vez`);
      })
    );
  }
}