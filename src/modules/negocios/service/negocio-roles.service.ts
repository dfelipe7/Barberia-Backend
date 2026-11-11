import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
import { NegocioAislamientoService } from '../negocio-aislamiento.service';
import {
  ROL_ADMINISTRADOR,
  ROL_BARBERO,
  ROL_SUPERADMIN,
} from '../negocios.constants';

export { ROL_ADMINISTRADOR, ROL_BARBERO, ROL_SUPERADMIN };

/**
 * Roles operativos EFECTIVOS de una persona dentro de un negocio.
 *
 * Un rol efectivo NO se deduce del campo global `Usuario.rol`: ese valor
 * (`ADMINISTRADOR` / `BARBERO`) es un residuo del modelo de negocio único y
 * no dice en qué barbería se puede operar. La fuente de verdad son los
 * PERFILES (`Administrador` y `Barbero`), que pertenecen a un negocio y tienen
 * su propio estado.
 *
 * Relación con `Usuario.rol`:
 *  - `SUPERADMIN` ya NO es una identidad global de plataforma: el carácter
 *    SUPERADMIN vive en la MEMBRESÍA (`Administrador.superadmin`) y su alcance
 *    es el negocio de esa fila. `Usuario.rol` no concede ningún privilegio.
 *  - `ADMINISTRADOR` y `BARBERO` NO autorizan por sí solos: sin perfil
 *    operativo ACTIVO en el negocio, la persona no tiene ningún rol allí.
 *
 * ALCANCE POR NEGOCIO
 * -------------------
 * `Administrador` y `Barbero` son MEMBRESÍAS: la misma persona puede ser
 * administradora de una barbería y no de otra. El único índice
 * `(negocioId, usuarioId)` y la clave foránea compuesta `(negocioId, id)`
 * garantizan que un perfil pertenece a un único negocio.
 */

/** Identificador de negocio con el que se puede trabajar (id + slug). */
export interface NegocioObjetivo {
  id: number;
  slug: string;
}

/** Perfil operativo de una persona dentro de un negocio. */
export interface PerfilOperativo {
  /** Roles efectivos: `ADMINISTRADOR` y/o `BARBERO`. */
  roles: string[];
  /** Foto del perfil de barbero de ESE negocio, si lo tiene. */
  fotoUrl: string | null;
}

/**
 * Cálculo de los roles efectivos por negocio.
 *
 * Todos los cálculos se ejecutan DENTRO del contexto del negocio evaluado
 * (`ejecutarEnNegocio`): así la extensión de Prisma acota la consulta a ese
 * negocio y ningún perfil de otra barbería puede colarse en el resultado.
 * Es lo que permite, por ejemplo, evaluar la pertenencia de una persona a un
 * negocio de destino distinto del que la petición tiene en contexto.
 */
@Injectable()
export class NegocioRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  /**
   * Perfil operativo (roles y foto) de `usuarioId` dentro de `negocio`.
   *
   * Devuelve roles vacíos cuando la persona no tiene ningún perfil operativo
   * ACTIVO en ese negocio. Los perfiles INACTIVOS no otorgan ningún rol.
   *
   * El carácter del rol administrativo sale de la MEMBRESÍA: una membresía
   * con `superadmin = true` otorga `SUPERADMIN` **de ese negocio**; con
   * `false`, otorga `ADMINISTRADOR`. `Usuario.rol` no interviene.
   *
   * @param usuarioId - Identificador global de la persona.
   * @param negocio - Negocio evaluado (id + slug).
   * @returns Perfil operativo con los roles calculados y la URL de la foto de perfil.
   */
  async perfilOperativo(
    usuarioId: number,
    negocio: NegocioObjetivo,
  ): Promise<PerfilOperativo> {
    return this.aislamiento.ejecutarEnNegocio(negocio, async () => {
      const roles: string[] = [];
      let fotoUrl: string | null = null;

      const administrador = await this.prisma.administrador.findFirst({
        where: { usuarioId, estado: EstadoUsuario.ACTIVO },
        select: { id: true, superadmin: true },
      });

      if (administrador) {
        // El carácter SUPERADMIN es de la MEMBRESÍA: el alcance es el
        // negocio que se está evaluando, nunca la plataforma.
        roles.push(
          administrador.superadmin ? ROL_SUPERADMIN : ROL_ADMINISTRADOR,
        );
      }

      const barbero = await this.prisma.barbero.findFirst({
        where: { usuarioId, estado: EstadoUsuario.ACTIVO },
        select: { id: true, fotoUrl: true },
      });

      if (barbero) {
        roles.push(ROL_BARBERO);
        fotoUrl = barbero.fotoUrl ?? null;
      }

      return { roles, fotoUrl };
    });
  }

  /**
   * Roles operativos efectivos de `usuarioId` dentro de `negocio`.
   *
   * @param usuarioId - Identificador del usuario.
   * @param negocio - Datos de la barbería evaluada.
   * @returns Lista de roles efectivos ('SUPERADMIN', 'ADMINISTRADOR', 'BARBERO').
   * @see perfilOperativo
   */
  async rolesEfectivos(
    usuarioId: number,
    negocio: NegocioObjetivo,
  ): Promise<string[]> {
    const { roles } = await this.perfilOperativo(usuarioId, negocio);

    return roles;
  }

  /**
   * Comprueba si la persona tiene algún perfil operativo activo en el negocio.
   *
   * @remarks
   * Es la comprobación de PERTENENCIA que exigen el inicio de sesión y el
   * cambio de negocio.
   *
   * @param usuarioId - Identificador único de usuario.
   * @param negocio - Barbería objetivo.
   * @returns `true` si la persona cuenta con al menos una membresía activa en la sede.
   */
  async perteneceActivo(
    usuarioId: number,
    negocio: NegocioObjetivo,
  ): Promise<boolean> {
    const roles = await this.rolesEfectivos(usuarioId, negocio);

    return roles.length > 0;
  }
}
