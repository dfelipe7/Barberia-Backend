import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Datos de alta/actualización de un cliente que inicia sesión con Google.
 * `googleId` es la identidad estable (el `sub` del ID Token); `email` es un dato
 * de contacto, no una clave de identidad.
 */
export interface DatosClienteGoogle {
  googleId: string;
  email: string | null;
  nombre: string;
  apellido: string | null;
}

/**
 * Acceso a `Cliente` para HE-04.
 *
 * Cubre dos usos:
 * - Identidad del cliente autenticado con Google (Modalidad B): alta idempotente
 *   por `googleId` y lectura por id para las consultas propias (HU-06/HU-07).
 * - Vínculo heredado opcional y único `Cliente`↔`Usuario` (D-01/D-02), que se
 *   conserva por compatibilidad con el historial; la autenticación de clientes
 *   ya NO depende de él.
 *
 * El alta del cliente invitado ocurre dentro de la transacción de creación de la
 * reserva (`ReservasRepository.crearConBloqueo`) para no dejar clientes huérfanos
 * si la reserva falla.
 */
@Injectable()
export class ClientesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Devuelve el `Cliente` vinculado a un `Usuario` (vínculo heredado), o `null`
   * si el usuario no tiene registro de cliente. No se usa en la ruta de clientes
   * autenticados con Google; se mantiene por compatibilidad.
   */
  async buscarPorUsuarioId(usuarioId: number) {
    return this.prisma.cliente.findUnique({ where: { usuarioId } });
  }

  /** Devuelve el `Cliente` por su identificador, o `null` si no existe. */
  async obtenerPorId(id: number) {
    return this.prisma.cliente.findUnique({ where: { id } });
  }

  /** Devuelve el `Cliente` con la identidad de Google indicada, o `null`. */
  async buscarPorGoogleId(googleId: string) {
    return this.prisma.cliente.findUnique({ where: { googleId } });
  }

  /**
   * Alta idempotente (upsert) del cliente autenticado con Google.
   *
   * - Si ya existe un `Cliente` con ese `googleId`, lo reutiliza y refresca los
   *   datos de perfil que aporta Google (`nombre`, `apellido`, `email`).
   * - Si no existe, lo crea.
   *
   * La unicidad de `googleId` la garantiza el índice UNIQUE de la base. Si dos
   * inicios de sesión concurrentes intentan crear el mismo `googleId`, la
   * segunda escritura produce `P2002`; se reintenta la lectura y se devuelve el
   * registro ya creado por la otra petición.
   */
  async buscarOcrearPorGoogle(datos: DatosClienteGoogle) {
    const existente = await this.buscarPorGoogleId(datos.googleId);

    if (existente) {
      return this.prisma.cliente.update({
        where: { id: existente.id },
        data: {
          nombre: datos.nombre,
          apellido: datos.apellido,
          email: datos.email,
        },
      });
    }

    try {
      return await this.prisma.cliente.create({
        data: {
          googleId: datos.googleId,
          email: datos.email,
          nombre: datos.nombre,
          apellido: datos.apellido,
        },
      });
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'P2002') {
        const creado = await this.buscarPorGoogleId(datos.googleId);
        if (creado) {
          return creado;
        }
      }
      throw error;
    }
  }

  /**
   * Busca clientes por nombre, apellido, teléfono o email para asociar a una reserva (HU-13-CA-02).
   */
  async buscarClientes(termino: string) {
    const t = termino.trim();
    if (!t) return [];

    return this.prisma.cliente.findMany({
      where: {
        OR: [
          { nombre: { contains: t } },
          { apellido: { contains: t } },
          { telefono: { contains: t } },
          { email: { contains: t } },
        ],
      },
      take: 20,
      orderBy: { nombre: 'asc' },
    });
  }
}
