import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { ReservationStatus, WeekDay } from '../../../../generated/prisma/enums';

export const MENSAJE_HORARIO_NO_DISPONIBLE =
  'El horario seleccionado no está disponible';

/**
 * Persistencia de reservas (HE-04, subconjunto aprobado).
 *
 * Solo cubre lo que el puerto `ProveedorReservasActivas` de HE-08 necesita
 * (saber si una franja está ocupada) más las primitivas de escritura que
 * consumirá la capa de aplicación: crear (con bloqueo), leer y cancelar.
 *
 * No contiene lógica de disponibilidad ni de negocio de reservas: eso vive en
 * `DisponibilidadService` (HE-08) y en la futura fachada de HE-04.
 */

/**
 * Política de ocupación compartida con HE-08: ocupan la franja todos los
 * estados no cancelados. Se declara como lista explícita (en vez de
 * `!= CANCELLED`) para que un estado futuro no ocupe agenda por accidente.
 */
export const ESTADOS_QUE_OCUPAN_AGENDA: readonly ReservationStatus[] = [
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
  ReservationStatus.IN_PROGRESS,
  ReservationStatus.COMPLETED,
];

/**
 * Selección compartida por las consultas del cliente (HU-06/HU-07): la reserva
 * con el nombre del servicio y el nombre del usuario del barbero. Se excluye
 * `slotActivo` (detalle interno de concurrencia) y los datos sensibles del
 * barbero (teléfono, comisión, estado).
 */
const SELECCION_RESERVA_CON_RELACIONES = {
  id: true,
  barberoId: true,
  servicioId: true,
  clienteId: true,
  date: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  status: true,
  precioReservado: true,
  createdAt: true,
  updatedAt: true,
  servicio: { select: { id: true, nombre: true, precio: true } },
  barbero: {
    select: { id: true, usuario: { select: { nombre: true, apellido: true } } },
  },
} as const;

/**
 * Representación de una reserva desacoplada del modelo Prisma. `slotActivo` es
 * de solo lectura: lo calcula la base de datos (columna generada, ver
 * `prisma/migrations/*_agregar_reservations/migration.sql`).
 */
export interface ReservaRegistro {
  id: number;
  barberoId: number;
  servicioId: number;
  clienteId: number;
  date: Date;
  dayOfWeek: WeekDay;
  startTime: string;
  endTime: string;
  status: ReservationStatus;
  precioReservado: Prisma.Decimal | null;
  gestionTokenHash: string | null;
  slotActivo: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Reserva con las relaciones que necesitan las consultas del cliente
 * (HU-06/HU-07): servicio (nombre) y barbero (nombre del usuario asociado).
 */
export interface ReservaConRelaciones {
  id: number;
  barberoId: number;
  servicioId: number;
  clienteId: number;
  date: Date;
  dayOfWeek: WeekDay;
  startTime: string;
  endTime: string;
  status: ReservationStatus;
  precioReservado: Prisma.Decimal | null;
  createdAt: Date;
  updatedAt: Date;
  servicio: { id: number; nombre: string; precio: Prisma.Decimal };
  barbero: { id: number; usuario: { nombre: string; apellido: string } };
}

/**
 * Selección para la agenda operativa del barbero. Incluye datos de contacto del
 * cliente y detalles del servicio (duración y precio). No expone tokens ni googleId.
 */
const SELECCION_RESERVA_AGENDA_BARBERO = {
  id: true,
  barberoId: true,
  servicioId: true,
  clienteId: true,
  date: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  status: true,
  precioReservado: true,
  createdAt: true,
  updatedAt: true,
  cliente: {
    select: {
      nombre: true,
      apellido: true,
      telefono: true,
    },
  },
  servicio: {
    select: {
      id: true,
      nombre: true,
      duracionMinutos: true,
      precio: true,
    },
  },
} as const;

/**
 * Registro de reserva con los campos requeridos para la vista de agenda del barbero.
 */
export interface ReservaAgendaRegistro {
  id: number;
  barberoId: number;
  servicioId: number;
  clienteId: number;
  date: Date;
  dayOfWeek: WeekDay;
  startTime: string;
  endTime: string;
  status: ReservationStatus;
  precioReservado: Prisma.Decimal | null;
  createdAt: Date;
  updatedAt: Date;
  cliente: {
    nombre: string;
    apellido: string | null;
    telefono: string | null;
  };
  servicio: {
    id: number;
    nombre: string;
    duracionMinutos: number;
    precio: Prisma.Decimal;
  };
}

export interface ConsultaOcupacionPorFecha {
  barberoId: number;
  fecha: Date;
  startTime: string;
  endTime: string;
  excluirReservaId?: number;
}

export interface ConsultaOcupacionPorDiaSemana {
  barberoId: number;
  dayOfWeek: WeekDay;
  startTime: string;
  endTime: string;
}

export interface ConsultaDuplicadoCliente {
  clienteId: number;
  barberoId: number;
  fecha: Date;
  startTime: string;
}

/**
 * Datos de contacto para dar de alta un `Cliente`. Se usan tanto para el
 * invitado (sin `usuarioId`) como para el cliente autenticado (con `usuarioId`,
 * y sin teléfono si Google no lo aporta). El alta y la reserva ocurren en la
 * misma transacción: si la reserva falla, el cliente no queda huérfano.
 */
export interface CrearClienteDatos {
  nombre: string;
  apellido?: string | null;
  telefono?: string | null;
  usuarioId?: number | null;
}

/**
 * El cliente de una reserva ya existe (`clienteId`) o debe crearse dentro de la
 * misma transacción (`crear`). Esto permite reutilizar un único flujo de
 * creación para el invitado y para el cliente autenticado.
 */
export type ClienteDeReserva =
  { clienteId: number } | { crear: CrearClienteDatos };

export interface CrearReservaDatos {
  barberoId: number;
  servicioId: number;
  date: Date;
  dayOfWeek: WeekDay;
  startTime: string;
  endTime: string;
  status?: ReservationStatus;
  precioReservado?: number | null;
  gestionTokenHash?: string | null;
  cliente: ClienteDeReserva;
}

export interface ModificarReservaDatos {
  id: number;
  barberoId: number;
  date: Date;
  dayOfWeek: WeekDay;
  startTime: string;
  endTime: string;
  precioReservado?: number | null;
}

/** Códigos/errores que pueden reintentarse (deadlock o contención de locks). */
const MAX_REINTENTOS_TRANSACCION = 3;

/**
 * Detecta errores transitorios de concurrencia de MariaDB/MySQL y de Prisma.
 * - `P2034`: conflicto de escritura / deadlock reportado por Prisma.
 * - `1213`: deadlock en el motor InnoDB.
 * - `1205`: lock wait timeout.
 * Un `P2002` (violación de unicidad) NO es reintentable: es una carrera perdida
 * que debe traducirse a 409.
 */
export function esErrorReintentableTransaccion(error: unknown): boolean {
  const codigo = (error as { code?: unknown } | null)?.code;
  if (codigo === 'P2034') {
    return true;
  }

  const errno = (error as { errno?: unknown } | null)?.errno;
  return errno === 1213 || errno === 1205;
}

@Injectable()
export class ReservasRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Indica si la franja `[startTime, endTime)` de un barbero en una fecha
   * contiene una reserva que ocupa agenda. Usa solape de intervalos
   * (`startTime < endTime` y `endTime > startTime`); la comparación de `HH:mm`
   * como texto es cronológicamente correcta por el relleno con ceros.
   */
  async existeReservaQueOcupaEnFranja(
    consulta: ConsultaOcupacionPorFecha,
  ): Promise<boolean> {
    const reserva = await this.prisma.reservation.findFirst({
      where: {
        barberoId: consulta.barberoId,
        date: consulta.fecha,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
        startTime: { lt: consulta.endTime },
        endTime: { gt: consulta.startTime },
        ...(consulta.excluirReservaId !== undefined
          ? { id: { not: consulta.excluirReservaId } }
          : {}),
      },
      select: { id: true },
    });

    return reserva !== null;
  }

  /**
   * Indica si existe alguna reserva que ocupa agenda, en cualquier fecha, sobre
   * la franja semanal (`dayOfWeek` + rango). Se usa al reemplazar el horario
   * semanal para no invalidar reservas futuras sin enumerar fechas.
   */
  async existeReservaQueOcupaEnFranjaSemanal(
    consulta: ConsultaOcupacionPorDiaSemana,
  ): Promise<boolean> {
    const reserva = await this.prisma.reservation.findFirst({
      where: {
        barberoId: consulta.barberoId,
        dayOfWeek: consulta.dayOfWeek,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
        startTime: { lt: consulta.endTime },
        endTime: { gt: consulta.startTime },
      },
      select: { id: true },
    });

    return reserva !== null;
  }

  /**
   * Indica si el cliente ya tiene una reserva que ocupa agenda en la misma
   * franja (mismo barbero, fecha y hora de inicio). Se usa para distinguir el
   * duplicado del propio cliente (HU-04-CA-04) de una franja ocupada por otro
   * (HU-04-CA-03). NO se apoya en coincidencias de nombre/teléfono entre
   * clientes distintos (D-01): solo compara el `clienteId` ya resuelto.
   */
  async existeReservaActivaDeClienteEnFranja(
    consulta: ConsultaDuplicadoCliente,
  ): Promise<boolean> {
    const reserva = await this.prisma.reservation.findFirst({
      where: {
        clienteId: consulta.clienteId,
        barberoId: consulta.barberoId,
        date: consulta.fecha,
        startTime: consulta.startTime,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
      },
      select: { id: true },
    });

    return reserva !== null;
  }

  async obtenerPorId(id: number): Promise<ReservaRegistro | null> {
    return this.prisma.reservation.findUnique({ where: { id } });
  }

  /**
   * Reservas de un cliente con su servicio y barbero, ordenadas cronológicamente
   * ascendente. La capa de servicio aplica el criterio "próximas primero"
   * combinando fecha y hora con el instante actual de Bogotá.
   */
  async listarReservasDeCliente(
    clienteId: number,
  ): Promise<ReservaConRelaciones[]> {
    return this.prisma.reservation.findMany({
      where: { clienteId },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: SELECCION_RESERVA_CON_RELACIONES,
    });
  }

  /**
   * Reserva concreta de un cliente (filtra por `clienteId`, no solo por id):
   * devuelve `null` tanto si la reserva no existe como si pertenece a otro
   * cliente, para no revelar la existencia de reservas ajenas (HU-07).
   */
  async obtenerReservaDeCliente(
    clienteId: number,
    reservaId: number,
  ): Promise<ReservaConRelaciones | null> {
    return this.prisma.reservation.findFirst({
      where: { id: reservaId, clienteId },
      select: SELECCION_RESERVA_CON_RELACIONES,
    });
  }

  /**
   * Obtiene la reserva con sus relaciones y el hash del token de gestión,
   * para validar peticiones de modificación o cancelación de invitados.
   */
  async obtenerReservaParaGestionInvitado(
    reservaId: number,
  ): Promise<(ReservaConRelaciones & { gestionTokenHash: string | null }) | null> {
    return this.prisma.reservation.findUnique({
      where: { id: reservaId },
      select: {
        ...SELECCION_RESERVA_CON_RELACIONES,
        gestionTokenHash: true,
      },
    });
  }

  /**
   * Lista las reservas activas (no canceladas) de un barbero para una fecha dada,
   * ordenadas cronológicamente por hora de inicio.
   */
  async listarReservasDeBarberoEnFecha(
    barberoId: number,
    fecha: Date,
  ): Promise<ReservaAgendaRegistro[]> {
    return this.prisma.reservation.findMany({
      where: {
        barberoId,
        date: fecha,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
      },
      orderBy: { startTime: 'asc' },
      select: SELECCION_RESERVA_AGENDA_BARBERO,
    });
  }

  /**
   * Lista las reservas activas (no canceladas) de un barbero para un rango de fechas [desde, hasta],
   * ordenadas cronológicamente por fecha ascendente y hora de inicio ascendente.
   */
  async listarReservasDeBarberoEnRango(
    barberoId: number,
    desde: Date,
    hasta: Date,
  ): Promise<ReservaAgendaRegistro[]> {
    return this.prisma.reservation.findMany({
      where: {
        barberoId,
        date: {
          gte: desde,
          lte: hasta,
        },
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: SELECCION_RESERVA_AGENDA_BARBERO,
    });
  }

  /**
   * Crea una reserva serializando la escritura por barbero con un
   * `SELECT ... FOR UPDATE` sobre la fila de `Barbero`, dentro de una
   * transacción. La transacción por sí sola NO evita el doble booking: la
   * garantía real es el índice UNIQUE
   * `(barberoId, date, startTime, slotActivo)`, que permite varias reservas
   * `CANCELLED` (slotActivo NULL) y a lo sumo una activa por franja. La
   * violación del índice se propaga como error de Prisma (`P2002`) para que la
   * capa de aplicación lo traduzca a 409.
   *
   * Si el cliente debe crearse (`cliente.crear`), se crea DENTRO de la misma
   * transacción: un fallo posterior (unicidad, deadlock) revierte también el
   * alta del cliente y no deja registros incompletos (HU-13-CA-08).
   *
   * Los deadlocks/timeouts transitorios (`P2034`/`1213`/`1205`) se reintentan
   * de forma acotada con backoff; un `P2002` nunca se reintenta.
   */
  async crearConBloqueo(datos: CrearReservaDatos): Promise<ReservaRegistro> {
    return this.conReintentos(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Barbero WHERE id = ${datos.barberoId} FOR UPDATE`;

        let clienteId: number;
        if ('clienteId' in datos.cliente) {
          clienteId = datos.cliente.clienteId;
        } else {
          const cliente = await tx.cliente.create({
            data: {
              nombre: datos.cliente.crear.nombre,
              apellido: datos.cliente.crear.apellido ?? null,
              telefono: datos.cliente.crear.telefono ?? null,
              usuarioId: datos.cliente.crear.usuarioId ?? null,
            },
          });
          clienteId = cliente.id;
        }

        return tx.reservation.create({
          data: {
            barberoId: datos.barberoId,
            servicioId: datos.servicioId,
            clienteId,
            date: datos.date,
            dayOfWeek: datos.dayOfWeek,
            startTime: datos.startTime,
            endTime: datos.endTime,
            status: datos.status ?? ReservationStatus.PENDING,
            precioReservado: datos.precioReservado ?? null,
            gestionTokenHash: datos.gestionTokenHash ?? null,
          },
        });
      }),
    );
  }

  private async conReintentos<T>(operacion: () => Promise<T>): Promise<T> {
    let intento = 0;

    for (;;) {
      try {
        return await operacion();
      } catch (error) {
        intento += 1;
        if (
          intento >= MAX_REINTENTOS_TRANSACCION ||
          !esErrorReintentableTransaccion(error)
        ) {
          throw error;
        }
        await this.esperar(intento);
      }
    }
  }

  private esperar(intento: number): Promise<void> {
    const milisegundos = 25 * intento;
    return new Promise((resolve) => setTimeout(resolve, milisegundos));
  }

  /**
   * Modifica una reserva serializando la escritura por barbero con un
   * `SELECT ... FOR UPDATE` sobre la fila de `Barbero`, dentro de una
   * transacción. Revalida que no exista otra reserva activa que ocupe
   * la franja de destino (excluyendo la reserva que se está modificando).
   * La unicidad a nivel de motor (D-17) y la transacción garantizan
   * que no haya dobles reservas.
   */
  async modificarConBloqueo(
    datos: ModificarReservaDatos,
  ): Promise<ReservaConRelaciones> {
    return this.conReintentos(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Barbero WHERE id = ${datos.barberoId} FOR UPDATE`;

        const conflicto = await tx.reservation.findFirst({
          where: {
            id: { not: datos.id },
            barberoId: datos.barberoId,
            date: datos.date,
            status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
            startTime: { lt: datos.endTime },
            endTime: { gt: datos.startTime },
          },
          select: { id: true },
        });

        if (conflicto) {
          throw new ConflictException(MENSAJE_HORARIO_NO_DISPONIBLE);
        }

        return tx.reservation.update({
          where: { id: datos.id },
          data: {
            barberoId: datos.barberoId,
            date: datos.date,
            dayOfWeek: datos.dayOfWeek,
            startTime: datos.startTime,
            endTime: datos.endTime,
            ...(datos.precioReservado !== undefined
              ? { precioReservado: datos.precioReservado }
              : {}),
          },
          select: SELECCION_RESERVA_CON_RELACIONES,
        });
      }),
    );
  }

  /**
   * Cancela una reserva sin borrarla. Al pasar a `CANCELLED`, la columna
   * generada `slotActivo` queda en NULL y libera la franja para una nueva
   * reserva (re-reserva), conservando el historial.
   */
  async cancelar(id: number): Promise<ReservaRegistro> {
    return this.prisma.reservation.update({
      where: { id },
      data: { status: ReservationStatus.CANCELLED },
    });
  }
}
