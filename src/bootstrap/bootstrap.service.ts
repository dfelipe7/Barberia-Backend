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
    try {
      await this.esperarYSincronizarSuperadmin(1, 100);
    } catch (error: any) {
      console.warn('[Bootstrap] Keycloak no está disponible o no se está utilizando. Asegurando superadministradores fundadores en la base de datos MySQL...');
      await this.asegurarSuperadminsFundadores();
    }
  }

  /**
   * Asegura que los 4 superadministradores fundadores existan en MySQL
   * al momento de arrancar la aplicación.
   */
  async asegurarSuperadminsFundadores() {
    const superadmins = [
      {
        email: 'armeroduvan8@gmail.com',
        nombre: 'Felipe',
        apellido: 'Armero',
      },
      {
        email: 'csbalcazar@unicauca.edu.co',
        nombre: 'Santiago',
        apellido: 'Balcazar',
      },
      {
        email: 'javieraceron@unicauca.edu.co',
        nombre: 'Javier Alexis',
        apellido: 'Anacona',
      },
      {
        email: 'rromero@unicauca.edu.co',
        nombre: 'Rubeiro',
        apellido: 'Romero',
      },
    ];

    for (const admin of superadmins) {
      try {
        const usuarioExistente = await this.usuariosRepository.obtenerUsuarioPorEmail(admin.email);
        if (usuarioExistente) {
          // Opción A: Conservar los cambios realizados desde la app (rol, estado, nombre)
          console.log(`[Bootstrap] Usuario fundador verificado: ${usuarioExistente.nombre} (${admin.email}) - Rol actual: ${usuarioExistente.rol}, Estado: ${usuarioExistente.estado} (Cambios conservados)`);
        } else {
          // Si no existe, se crea por primera vez como SUPERADMIN y ACTIVO
          await this.usuariosRepository.crearUsuario({
            email: admin.email,
            nombre: admin.nombre,
            apellido: admin.apellido,
            rol: 'SUPERADMIN',
          });
          console.log(`[Bootstrap] Superadmin creado por primera vez: ${admin.nombre} (${admin.email})`);
        }
      } catch (err: any) {
        console.error(`[Bootstrap] Error asegurando superadmin ${admin.email}:`, err?.message || err);
      }
    }
  }

  /**
   * Reintenta la conexión con Keycloak periódicamente.
   */
  private async esperarYSincronizarSuperadmin(intentos = 1, esperaMs = 100) {
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