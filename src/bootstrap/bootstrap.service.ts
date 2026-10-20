import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { UsuariosRepository } from '../modules/usuarios/repository/usuarios.repository';
import { NegociosRepository } from '../modules/negocios/repository/negocios.repository';
import { ConfiguracionService } from '../modules/configuracion/service/configuracion.service';

/**
 * Servicio de Arranque (Bootstrap)
 *
 * Este servicio utiliza el ciclo de vida `OnModuleInit` de NestJS.
 * Se ejecuta automáticamente UNA SOLA VEZ cada vez que el servidor backend se enciende.
 *
 * Su propósito principal es garantizar que siempre existan los superadministradores fundadores
 * en la base de datos MySQL local para que el sistema esté listo para operar con Google OAuth.
 *
 * Además, asegura que cada negocio tenga SU configuración operativa (Fase 5):
 * sin ella, un negocio nuevo heredaría el valor global de plataforma. La
 * operación es IDEMPOTENTE: solo crea las claves que faltan y nunca
 * sobrescribe un valor que un administrador haya personalizado.
 */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly usuariosRepository: UsuariosRepository,
    private readonly negociosRepository: NegociosRepository,
    private readonly configuracionService: ConfiguracionService,
  ) {}

  async onModuleInit() {
    await this.asegurarSuperadminsFundadores();
    await this.asegurarConfiguracionesOperativas();
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

  /**
   * Asegura que cada negocio tenga sus configuraciones operativas.
   *
   * Es idempotente: si la clave ya existe, se conserva su valor (puede estar
   * personalizado). Un fallo aquí NO detiene el arranque: la lectura de un
   * parámetro ausente degrada al valor global o al valor por defecto.
   */
  async asegurarConfiguracionesOperativas() {
    try {
      const negocios = await this.negociosRepository.listar();

      for (const negocio of negocios) {
        try {
          const resultado =
            await this.configuracionService.inicializarValoresOperativos(
              negocio.id,
            );

          if (resultado.creadas.length > 0) {
            this.logger.log(
              `Configuración operativa inicializada para '${negocio.slug}': ${resultado.creadas.join(', ')}`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `No se pudo inicializar la configuración operativa de '${negocio.slug}': ${(error as Error)?.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `No se pudieron inicializar las configuraciones operativas: ${(error as Error)?.message}`,
      );
    }
  }
}
