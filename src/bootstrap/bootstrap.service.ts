import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { UsuariosRepository } from '../modules/usuarios/repository/usuarios.repository';

/**
 * Servicio de Arranque (Bootstrap)
 *
 * Este servicio utiliza el ciclo de vida `OnModuleInit` de NestJS.
 * Se ejecuta automáticamente UNA SOLA VEZ cada vez que el servidor backend se enciende.
 *
 * Su propósito principal es garantizar que siempre existan los superadministradores fundadores
 * en la base de datos MySQL local para que el sistema esté listo para operar con Google OAuth.
 */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(private readonly usuariosRepository: UsuariosRepository) {}

  async onModuleInit() {
    await this.asegurarSuperadminsFundadores();
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

    await Promise.all(
      superadmins.map(async (admin) => {
        try {
          const usuarioExistente =
            await this.usuariosRepository.obtenerUsuarioPorEmail(admin.email);
          if (usuarioExistente) {
            // Conservar los cambios realizados desde la app (rol, estado, nombre)
            this.logger.log(
              `Usuario fundador verificado: ${usuarioExistente.nombre} (${admin.email}) - Rol actual: ${usuarioExistente.rol}, Estado: ${usuarioExistente.estado}`,
            );
          } else {
            // Si no existe, se crea por primera vez como SUPERADMIN y ACTIVO
            await this.usuariosRepository.crearUsuario({
              email: admin.email,
              nombre: admin.nombre,
              apellido: admin.apellido,
              rol: 'SUPERADMIN',
            });
            this.logger.log(
              `Superadmin fundador creado: ${admin.nombre} (${admin.email})`,
            );
          }
        } catch (err: any) {
          this.logger.error(
            `Error asegurando superadmin ${admin.email}: ${err?.message || err}`,
          );
        }
      }),
    );
  }
}
