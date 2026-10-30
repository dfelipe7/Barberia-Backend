import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';

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
 * Ficha de cliente expuesta al listado administrativo.
 *
 * Se define un subconjunto DELIBERADAMENTE acotado: la búsqueda
 * administrativa solo necesita identificar al cliente y localizarlo para
 * asociarlo a una reserva. `googleId` (identidad de Google) y `usuarioId`
 * (vínculo con la cuenta global) NO se devuelven: no son necesarios para
 * esa operación y son datos que la interfaz autorizada no necesita ver.
 */
export interface ClienteBusquedaAdmin {
  id: number;
  nombre: string;
  apellido: string | null;
  telefono: string | null;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  /**
   * Devuelve el `Cliente` vinculado a un `Usuario` (vínculo heredado) en el
   * negocio ACTIVO, o `null` si el usuario no tiene registro de cliente allí.
   * No se usa en la ruta de clientes autenticados con Google; se mantiene por
   * compatibilidad.
   */
  async buscarPorUsuarioId(usuarioId: number) {
    return this.prisma.cliente.findFirst({
      where: this.aislamiento.filtroLectura({ usuarioId }),
    });
  }

  /** Devuelve el `Cliente` por su identificador, o `null` si no existe. */
  async obtenerPorId(id: number) {
    return this.prisma.cliente.findUnique({
      where: this.aislamiento.filtroEscritura({ id }),
    });
  }

  /**
   * Devuelve el `Cliente` con la identidad de Google indicada en el negocio
   * ACTIVO, o `null`.
   *
   * `googleId` ya no es único global: la misma cuenta de Google puede tener
   * una ficha en cada barbería, así que la búsqueda se acota al negocio.
   */
  async buscarPorGoogleId(googleId: string) {
    return this.prisma.cliente.findFirst({
      where: this.aislamiento.filtroLectura({ googleId }),
    });
  }

  /**
   * Alta idempotente (upsert) del cliente autenticado con Google.
   *
   * - Si ya existe un `Cliente` con ese `googleId`, lo reutiliza y refresca los
   *   datos de perfil que aporta Google (`nombre`, `apellido`, `email`).
   * - Si no existe, lo crea.
   *
   * La unicidad de `(negocioId, googleId)` la garantiza el índice UNIQUE de la
   * base. Si dos inicios de sesión concurrentes intentan crear el mismo
   * `googleId` en el mismo negocio, la segunda escritura produce `P2002`; se
   * reintenta la lectura y se devuelve el registro ya creado por la otra
   * petición.
   */
  async buscarOcrearPorGoogle(datos: DatosClienteGoogle) {
    const existente = await this.buscarPorGoogleId(datos.googleId);

    if (existente) {
      return this.prisma.cliente.update({
        where: this.aislamiento.filtroEscritura({ id: existente.id }),
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
          negocioId: this.aislamiento.negocioIdRequerido(),
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
   * Busca clientes por nombre, apellido, teléfono o email para asociar a una
   * reserva (HU-13-CA-02).
   *
   * La búsqueda está RESTRINGIDA al negocio activo: solo devuelve clientes de
   * la barbería activa. Además devuelve un subconjunto acotado de campos
   * (`ClienteBusquedaAdmin`): ni `googleId` ni `usuarioId` se exponen, porque
   * la operación de asociar una reserva no los necesita y son identificadores
   * de identidad que la interfaz administrativa no debe recibir.
   */
  async buscarClientes(termino: string): Promise<ClienteBusquedaAdmin[]> {
    const t = termino.trim();
    if (!t) return [];

    return this.prisma.cliente.findMany({
      where: this.aislamiento.filtroLectura({
        OR: [
          { nombre: { contains: t } },
          { apellido: { contains: t } },
          { telefono: { contains: t } },
          { email: { contains: t } },
        ],
      }),
      take: 20,
      orderBy: { nombre: 'asc' },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        telefono: true,
      },
    });
  }
  /**
   * Actualiza los datos de contacto o perfil de un cliente del negocio activo.
   */
  async actualizarPerfil(
    id: number,
    datos: { telefono?: string | null; nombre?: string; apellido?: string | null },
  ) {
    return this.prisma.cliente.update({
      where: this.aislamiento.filtroEscritura({ id }),
      data: datos,
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        telefono: true,
      },
    });
  }
}
