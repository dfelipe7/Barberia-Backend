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
 * QUÉ HACE (y qué NO hace)
 * -----------------------
 * - ASEGURA la configuración operativa de cada negocio (Fase 5): operación
 *   idempotente que solo crea las claves que faltan y nunca sobrescribe un
 *   valor personalizado.
 *
 * - NO crea usuarios. NO promueve a nadie. NO concede el rol SUPERADMIN.
 *   Los miembros del equipo de cada barbería se configuran con el comando
 *   EXPLÍCITO `npm run multitenant:fundadores` (ver
 *   `prisma/multitenant/asignar-fundadores.ts`), que exige identificar a cada
 *   persona de forma inequívoca y verificar los negocios de destino.
 *
 *  Motivo: en este SaaS el SUPERADMIN es un rol de NEGOCIO (la membresía
 *   `Administrador.superadmin`). Crear personas o|nombrar superadministradores
 *   en el arranque sería una promoción implícita de privilegios, y con los
 *   correos canónicos del código se podrían duplicar identidades (por ejemplo,
 *   una cuenta con el correo corregido y otra con el histórico).
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
    await this.asegurarConfiguracionesOperativas();
  }

  /**
   * Asegura que cada negocio tenga SUS configuraciones operativas.
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
