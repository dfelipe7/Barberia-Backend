import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import {
  EstadoServicio,
  EstadoUsuario,
} from '../../../../generated/prisma/enums';

/**
 * Fragmento reutilizable para incluir únicamente los barberos ACTIVOS asignados al servicio,
 * junto con los datos personales de su usuario (nombre, apellido, email).
 *
 * El filtro `where` de la relación anidada incluye el `negocioId`: un barbero
 * de otra barbería no se incluye aunque exista la fila en `BarberoServicio`.
 */
const incluirBarberos = (negocioId: number) => ({
  barberos: {
    where: {
      negocioId,
      barbero: {
        estado: EstadoUsuario.ACTIVO,
        usuario: {
          estado: EstadoUsuario.ACTIVO,
        },
      },
    },
    include: {
      barbero: {
        include: {
          usuario: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
            },
          },
        },
      },
    },
  },
});

/**
 * Fragmento para incluir únicamente los barberos ACTIVOS que cuentan con al menos
 * una franja horaria configurada en su semana laboral (weeklySlots.some(active: true)).
 */
const INCLUDE_BARBEROS_CATALOGO = {
  barberos: {
    where: {
      barbero: {
        estado: EstadoUsuario.ACTIVO,
        usuario: {
          estado: EstadoUsuario.ACTIVO,
        },
        weeklySlots: {
          some: {
            active: true,
          },
        },
      },
    },
    include: {
      barbero: {
        include: {
          usuario: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
            },
          },
        },
      },
    },
  },
};

@Injectable()
export class ServiciosRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

  /**
   * Consulta los barberos que existen y se encuentran en estado ACTIVO (tanto el rol como la cuenta global).
   * Utilizado para validar que no se asocien barberos inactivos o inexistentes a un servicio.
   *
   * Los identificadores son `Barbero.id` (NO `Usuario.id`): es la clave que
   * consumen el resto de rutas públicas (disponibilidad, reservas) y la que
   * devuelve el catálogo.
   *
   * Restringido al negocio activo: no se pueden vincular barberos de otra
   * barbería al servicio.
   */
  /**
   * Consulta los barberos que existen y se encuentran en estado ACTIVO.
   *
   * Multitenant: Soporta búsqueda flexible por Barbero.id O por Usuario.id.
   * Esto permite resolver el desfase de IDs entre los datos de usuario y las
   * fichas de barbero de esta barbería, devolviendo ambos IDs para su normalización.
   */
  async obtenerBarberosActivosPorIds(ids: number[]) {
    return this.prisma.barbero.findMany({
      where: this.aislamiento.filtroLectura({
        OR: [{ id: { in: ids } }, { usuarioId: { in: ids } }],
        estado: EstadoUsuario.ACTIVO,
        usuario: {
          estado: EstadoUsuario.ACTIVO,
        },
      }),
      select: {
        id: true,
        usuarioId: true,
      },
    });
  }

  /**
   * Busca un servicio por su nombre exacto (utilizado para evitar duplicados).
   */
  obtenerServicioPorNombre(nombre: string) {
    return this.prisma.servicio.findFirst({
      where: this.aislamiento.filtroLectura({ nombre }),
    });
  }

  /**
   * Obtiene el detalle de un servicio por su ID, incluyendo sus barberos.
   */
  obtenerServicioPorId(id: number) {
    return this.prisma.servicio.findUnique({
      where: this.aislamiento.filtroEscritura({ id }),
      include: incluirBarberos(this.aislamiento.negocioIdRequerido()),
    });
  }

  /**
   * Obtiene un servicio por su ID solo si está ACTIVO. Se usa para validar la
   * consulta pública de disponibilidad sin exponer servicios inactivos.
   */
  async obtenerServicioActivoPorId(id: number) {
    return this.prisma.servicio.findFirst({
      where: this.aislamiento.filtroLectura({
        id,
        estado: EstadoServicio.ACTIVO,
      }),
    });
  }

  /**
   * Indica si un barbero está asignado a un servicio mediante la tabla
   * intermedia `BarberoServicio` (clave compuesta barberoId + servicioId).
   * La disponibilidad pública solo es válida si el barbero ofrece el servicio.
   *
   * La asignación se comprueba DENTRO del negocio activo: un barbero de otra
   * barbería no cuenta como asignado aunque exista la fila.
   */
  async existeAsignacionBarbero(barberoId: number, servicioId: number) {
    const asignacion = await this.prisma.barberoServicio.findFirst({
      where: this.aislamiento.filtroLectura({ barberoId, servicioId }),
      select: { barberoId: true },
    });
    return asignacion !== null;
  }

  /**
   * Comprueba si el perfil de barbero (`Barbero.id`) pertenece al negocio
   * activo y está ACTIVO.
   *
   * Se usa para validar las rutas públicas que reciben un `barberoId`: un
   * barbero de otra barbería no existe para efectos de esta barbería.
   */
  async obtenerBarberoActivoEnNegocio(barberoId: number) {
    return this.prisma.barbero.findFirst({
      where: this.aislamiento.filtroLectura({
        id: barberoId,
        estado: EstadoUsuario.ACTIVO,
        usuario: {
          estado: EstadoUsuario.ACTIVO,
        },
      }),
      select: { id: true },
    });
  }

  /**
   * Catálogo público: Lista únicamente los servicios que están ACTIVOS con opción de filtro por nombre.
   * Ordenados alfabéticamente para facilitar la selección al cliente en la reserva.
   */
  listarServiciosCatalogo(filtro?: { nombre?: string }) {
    const whereCondition: any = {
      estado: EstadoServicio.ACTIVO,
      barberos: {
        some: {
          barbero: {
            estado: EstadoUsuario.ACTIVO,
            usuario: {
              estado: EstadoUsuario.ACTIVO,
            },
            weeklySlots: {
              some: {
                active: true,
              },
            },
          },
        },
      },
    };

    if (filtro?.nombre) {
      whereCondition.OR = [
        { nombre: { contains: filtro.nombre } },
        { descripcion: { contains: filtro.nombre } },
      ];
    }

    return this.prisma.servicio.findMany({
      where: this.aislamiento.filtroLectura(whereCondition),
      include: incluirBarberos(this.aislamiento.negocioIdRequerido()),
      orderBy: {
        nombre: 'asc',
      },
    });
  }

  /**
   * Vista de gestión administrativa: Lista TODOS los servicios (activos e inactivos) con soporte de filtros.
   * Permite al Superadmin y Administrador ver el catálogo completo para editar o reactivar.
   */
  async listarServiciosGestion(filtro?: {
    nombre?: string;
    estado?: EstadoServicio;
  }) {
    const whereCondition: any = {};

    if (filtro?.estado) {
      whereCondition.estado = filtro.estado;
    }

    if (filtro?.nombre) {
      whereCondition.OR = [
        { nombre: { contains: filtro.nombre } },
        { descripcion: { contains: filtro.nombre } },
      ];
    }

    return await this.prisma.servicio.findMany({
      where: this.aislamiento.filtroLectura(whereCondition),
      include: incluirBarberos(this.aislamiento.negocioIdRequerido()),
      orderBy: {
        id: 'desc',
      },
    });
  }

  /**
   * Consulta inversa: Retorna los servicios ACTIVOS asociados a un barbero
   * específico.
   *
   * El identificador es `Barbero.id` (NO `Usuario.id`): es la misma clave que
   * consumen la disponibilidad y la reserva. El filtro acota además el barbero
   * al negocio activo, de modo que un barbero de otra barbería no devuelve
   * servicios.
   */
  async listarServiciosPorBarbero(barberoId: number) {
    return await this.prisma.servicio.findMany({
      where: this.aislamiento.filtroLectura({
        estado: EstadoServicio.ACTIVO,
        barberos: {
          some: {
            barberoId,
            barbero: {
              negocioId: this.aislamiento.negocioIdRequerido(),
            },
          },
        },
      }),
      include: incluirBarberos(this.aislamiento.negocioIdRequerido()),
      orderBy: {
        nombre: 'asc',
      },
    });
  }

  /**
   * Consulta directa: Retorna los barberos ACTIVOS (rol y cuenta) asignados a
   * un servicio ACTIVO a través de la tabla intermedia `BarberoServicio`.
   * Usado por HE-04-HU-02 para listar quién puede prestar el servicio elegido.
   *
   * Devuelve el `Barbero.id` (no el `Usuario.id`) porque es la clave que
   * consume el endpoint público de disponibilidad.
   */
  async listarBarberosActivosPorServicio(servicioId: number) {
    const asignaciones = await this.prisma.barberoServicio.findMany({
      where: this.aislamiento.filtroLectura({
        servicioId,
        barbero: {
          negocioId: this.aislamiento.negocioIdRequerido(),
          estado: EstadoUsuario.ACTIVO,
          usuario: {
            estado: EstadoUsuario.ACTIVO,
          },
          weeklySlots: {
            some: {
              active: true,
            },
          },
        },
      }),
      select: {
        barbero: {
          select: {
            id: true,
            fotoUrl: true,
            usuario: {
              select: {
                id: true,
                nombre: true,
                apellido: true,
              },
            },
          },
        },
      },
      orderBy: { barberoId: 'asc' },
    });

    return asignaciones.map((asignacion) => asignacion.barbero);
  }

  /**
   * Crea un nuevo servicio y, si se especificaron barberos,
   * los vincula de forma atómica en la tabla intermedia BarberoServicio.
   *
   * `barberoIds` contiene `Barbero.id` (NO `Usuario.id`): se conecta por la
   * clave del perfil de barbero, que es la que usa el resto de la API.
   */
  async crearServicio(data: {
    nombre: string;
    descripcion?: string;
    precio: number;
    duracionMinutos: number;
    fotoUrl?: string;
    barberoIds?: number[];
  }) {
    const negocioId = this.aislamiento.negocioIdRequerido();

    return await this.prisma.servicio.create({
      data: {
        nombre: data.nombre,
        descripcion: data.descripcion,
        precio: data.precio,
        duracionMinutos: data.duracionMinutos,
        fotoUrl: data.fotoUrl,
        negocioId,
        barberos:
          data.barberoIds && data.barberoIds.length > 0
            ? {
                // Relación COMPUESTA: la base de datos exige que el barbero y
                // el servicio pertenezcan al MISMO negocio que el vínculo (FK
                // compuesta). Aquí se escriben los escalares; la integridad la
                // garantiza el motor.
                // En la creación anidada (nested create), Prisma infiere y propaga automáticamente
                // el negocioId desde el servicio padre a BarberoServicio debido a la clave compuesta.
                // BarberoServicioUncheckedCreateWithoutServicioInput solo acepta barberoId.
                create: data.barberoIds.map((barberoId) => ({
                  barberoId,
                })),
              }
            : undefined,
      },
      include: incluirBarberos(this.aislamiento.negocioIdRequerido()),
    });
  }

  /**
   * Actualiza los datos de un servicio. Si se provee la lista de barberoIds,
   * sincroniza las asignaciones en la tabla intermedia eliminando las anteriores
   * e insertando las nuevas en una sola transacción segura.
   *
   * `barberoIds` contiene `Barbero.id` (NO `Usuario.id`).
   */
  async actualizarServicio(
    id: number,
    data: {
      nombre?: string;
      descripcion?: string;
      precio?: number;
      duracionMinutos?: number;
      fotoUrl?: string | null;
      barberoIds?: number[];
    },
  ) {
    const negocioId = this.aislamiento.negocioIdRequerido();

    return await this.prisma.servicio.update({
      where: this.aislamiento.filtroEscritura({ id }),
      data: {
        nombre: data.nombre,
        descripcion: data.descripcion,
        precio: data.precio,
        duracionMinutos: data.duracionMinutos,
        fotoUrl: data.fotoUrl,
        barberos:
          data.barberoIds !== undefined
            ? {
                deleteMany: {},
                // Relación COMPUESTA: la integridad la garantiza el motor
                // (FK compuesta barbero-servicio-negocio).
                // En la creación anidada (nested create), Prisma infiere y propaga automáticamente
                // el negocioId desde el servicio padre a BarberoServicio debido a la clave compuesta.
                // BarberoServicioUncheckedCreateWithoutServicioInput solo acepta barberoId.
                create: data.barberoIds.map((barberoId) => ({
                  barberoId,
                })),
              }
            : undefined,
      },
      include: incluirBarberos(this.aislamiento.negocioIdRequerido()),
    });
  }

  /**
   * Cambia el estado (ACTIVO / INACTIVO) de un servicio (borrado lógico).
   */
  async cambiarEstado(id: number, estado: EstadoServicio) {
    return await this.prisma.servicio.update({
      where: this.aislamiento.filtroEscritura({ id }),
      data: { estado },
      include: incluirBarberos(this.aislamiento.negocioIdRequerido()),
    });
  }
}
