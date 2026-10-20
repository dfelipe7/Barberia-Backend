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
 *  - `SUPERADMIN` conserva significado GLOBAL de plataforma (identidad de
 *    plataforma, no de negocio). Se trata aparte, en el flujo de sesiones.
 *  - `ADMINISTRADOR` y `BARBERO` NO autorizan por sí solos: sin perfil
 *    operativo ACTIVO en el negocio, la persona no tiene ningún rol allí.
 *
 * LIMITACIÓN DEL ESQUEMA ACTUAL (se resuelve en la fase 8): `Administrador` y
 * `Barbero` tienen `usuarioId` ÚNICO, de modo que una persona solo puede
 * tener un perfil de administrador y uno de barbero en toda la plataforma.
 * Sí puede tener ambos a la vez (son tablas distintas) y puede estar en
 * negocios distintos: administrador en A y barbero en B. No puede, en cambio,
 * ser administrador de dos negocios, porque eso exigiría la clave compuesta
 * `(usuarioId, negocioId)`.
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
   * @param usuarioId Identificador global de la persona.
   * @param negocio Negocio evaluado (id + slug).
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
        select: { id: true },
      });

      if (administrador) {
        roles.push(ROL_ADMINISTRADOR);
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
   * `true` si la persona tiene algún perfil operativo activo en el negocio.
   *
   * Es la comprobación de PERTENENCIA que exigen el inicio de sesión y el
   * cambio de negocio.
   */
  async perteneceActivo(
    usuarioId: number,
    negocio: NegocioObjetivo,
  ): Promise<boolean> {
    const roles = await this.rolesEfectivos(usuarioId, negocio);

    return roles.length > 0;
  }
}
