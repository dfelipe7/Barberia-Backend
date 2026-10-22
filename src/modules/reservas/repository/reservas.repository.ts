import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { Prisma } from '../../../../generated/prisma/client';
import { ReservationStatus, WeekDay } from '../../../../generated/prisma/enums';
import {
  CODIGOS_CONFLICTO,
  DomainConflictException,
} from '../../../common/exceptions/domain-conflict.exception';

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
  ReservationStatus.NO_SHOW,
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
  /**
   * Copia CIFRADA del token de gestión.
   *
   * Permite que un reintento idempotente reproduzca EXACTAMENTE la respuesta
   * original (mismo token) sin rotar nada: la idempotencia no puede invalidar
   * una credencial que el cliente ya tiene.
   */
  gestionTokenCifrado: string | null;
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

/**
 * Selección para marcar una reserva como completada: incluye la identidad del
 * barbero (para verificar propiedad), los datos de contacto del cliente y el
 * nombre del servicio (para la notificación por WhatsApp).
 */
export const SELECCION_RESERVA_PARA_COMPLETAR = {
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
    },
  },
  barbero: {
    select: {
      id: true,
      usuario: {
        select: {
          nombre: true,
          apellido: true,
        },
      },
    },
  },
} as const;

export interface ReservaCompletarRegistro {
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
  };
  barbero: {
    id: number;
    usuario: {
      nombre: string;
      apellido: string;
    };
  };
}

export interface ConsultaOcupacionPorFecha {
  barberoId: number;
  fecha: Date;
  startTime: string;
  endTime: string;
  excluirReservaId?: number;
}

export const SELECCION_RESERVA_ADMIN = {
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
      id: true,
      nombre: true,
      apellido: true,
      telefono: true,
      email: true,
      usuarioId: true,
      googleId: true,
    },
  },
  servicio: {
    select: {
      id: true,
      nombre: true,
      precio: true,
      duracionMinutos: true,
    },
  },
  barbero: {
    select: {
      id: true,
      usuario: {
        select: {
          id: true,
          nombre: true,
          apellido: true,
        },
      },
    },
  },
} as const;

export interface ReservaAdminRegistro {
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
    id: number;
    nombre: string;
    apellido: string | null;
    telefono: string | null;
    email: string | null;
    usuarioId: number | null;
    googleId: string | null;
  };
  servicio: {
    id: number;
    nombre: string;
    precio: Prisma.Decimal;
    duracionMinutos: number;
  };
  barbero: {
    id: number;
    usuario: {
      id: number;
      nombre: string;
      apellido: string;
    };
  };
}

export interface FiltroReservasAdminRepo {
  fecha?: Date;
  desde?: Date;
  hasta?: Date;
  barberoId?: number;
  estado?: ReservationStatus;
  clienteId?: number;
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
  /**
   * Clave de idempotencia del intento en curso.
   *
   * La reserva que la lleva es ESTE MISMO intento: no cuenta como duplicado.
   * Sin esta salvedad, un reintento concurrente con la misma clave se
   * rechazaría como duplicado en lugar de recuperar la reserva original.
   */
  excluirIdempotencyKey?: string;
}

/**
 * Selección de la reserva recuperada por clave de idempotencia.
 *
 * Es la MISMA que devuelve `crearConBloqueo` para que la respuesta del
 * reintento sea idéntica a la de la creación original.
 */
const SELECCION_RESERVA_PARA_IDEMPOTENCIA = {
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
  gestionTokenHash: true,
  gestionTokenCifrado: true,
  slotActivo: true,
  createdAt: true,
  updatedAt: true,
} as const;

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
  email?: string | null;
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
  /**
   * Copia CIFRADA del token de gestión.
   *
   * Se guarda para que un reintento idempotente devuelva EXACTAMENTE la
   * respuesta original (mismo token) sin invalidar nada.
   */
  gestionTokenCifrado?: string | null;
  cliente: ClienteDeReserva;
  /**
   * Clave de idempotencia del intento (cabecera `Idempotency-Key`).
   *
   * Es OPCIONAL: sin ella, cada POST crea una reserva nueva (comportamiento
   * histórico). Con ella, reintentar el mismo intento recupera la reserva
   * original en lugar de crear otra.
   */
  idempotencyKey?: string | null;
}

/**
 * Firma MATERIAL de un intento de reserva.
 *
 * Es lo que compara dos intentos que comparten clave de idempotencia: si solo
 * cambia la clave de idempotencia, es el mismo intento; si cambia el
 * contenido, es un intento DISTINTO y la clave se considera reutilizada con
 * una petición incompatible.
 */
export interface FirmaReserva {
  barberoId: number;
  servicioId: number;
  fecha: Date;
  startTime: string;
  endTime: string;
  clienteId: number | null;
}

/**
 * Firma MATERIAL de un intento de reserva.
 *
 * Es lo que distingue "el mismo intento" de "otro intento" cuando comparten
 * clave de idempotencia.
 *
 * `clienteId` es `null` cuando el intento CREA al cliente (invitado): en ese
 * caso cada intento genera su propio cliente y no se puede comparar.
 */
export interface FirmaIntentoReserva {
  barberoId: number;
  servicioId: number;
  date: Date;
  startTime: string;
  clienteId: number | null;
}

/**
 * Compara dos intentos de reserva por su contenido MATERIAL.
 *
 * Dos intentos con la misma clave de idempotencia son "el mismo" si piden lo
 * mismo: mismo barbero, mismo servicio, misma fecha, misma hora de inicio y
 * mismo cliente (cuando se conoce).
 *
 * La hora de FIN no se compara: el catálogo de franjas es fijo, de modo que
 * la hora de inicio ya la determina.
 */
export function mismaFirmaReserva(
  previa: {
    barberoId: number;
    servicioId: number;
    date: Date;
    startTime: string;
    clienteId: number;
  },
  firma: FirmaIntentoReserva,
): boolean {
  return (
    previa.barberoId === firma.barberoId &&
    previa.servicioId === firma.servicioId &&
    previa.date.getTime() === firma.date.getTime() &&
    previa.startTime === firma.startTime &&
    (firma.clienteId === null || previa.clienteId === firma.clienteId)
  );
}

/**
 * Opciones de la creación transaccional de una reserva.
 */
export interface OpcionesCrearConBloqueo {
  /**
   * Revalidación que se ejecuta DENTRO de la transacción, con el cliente de
   * la propia transacción.
   *
   * Es el punto donde se vuelven a comprobar las reglas que dependen del
   * estado (servicio activo, barbero activo, asignación vigente, horario
   * semanal, bloqueos, cierres y ocupación). La comprobación previa de
   * disponibilidad, hecha antes de la transacción, puede quedarse obsoleta
   * entre la consulta y la confirmación.
   */
  revalidar?: (
    tx: Prisma.TransactionClient,
    negocioId: number,
  ) => Promise<void>;
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

/**
 * Número máximo de REINTENTOS ante un error transitorio de concurrencia.
 *
 * El primer intento no cuenta: son tres reintentos (cuatro intentos en total),
 * con esperas de 50 ms, 100 ms y 200 ms.
 */
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
  private readonly logger = new Logger(ReservasRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aislamiento: NegocioAislamientoService,
  ) {}

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
      where: this.aislamiento.filtroLectura({
        barberoId: consulta.barberoId,
        date: consulta.fecha,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
        startTime: { lt: consulta.endTime },
        endTime: { gt: consulta.startTime },
        ...(consulta.excluirReservaId !== undefined
          ? { id: { not: consulta.excluirReservaId } }
          : {}),
      }),
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
      where: this.aislamiento.filtroLectura({
        barberoId: consulta.barberoId,
        dayOfWeek: consulta.dayOfWeek,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
        startTime: { lt: consulta.endTime },
        endTime: { gt: consulta.startTime },
      }),
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
      where: this.aislamiento.filtroLectura({
        clienteId: consulta.clienteId,
        barberoId: consulta.barberoId,
        date: consulta.fecha,
        startTime: consulta.startTime,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
        ...(consulta.excluirIdempotencyKey !== undefined
          ? { idempotencyKey: { not: consulta.excluirIdempotencyKey } }
          : {}),
      }),
      select: { id: true },
    });

    return reserva !== null;
  }

  /**
   * Reserva por id, restringida al negocio activo.
   *
   * `findUnique` acepta en Prisma 7 un filtro adicional junto a la clave
   * única: si la reserva pertenece a otro negocio, el motor no la devuelve.
   * El resultado es `null` (no un error) para no revelar la existencia de
   * reservas de otros negocios.
   */
  async obtenerPorId(id: number): Promise<ReservaRegistro | null> {
    return this.prisma.reservation.findUnique({
      where: this.aislamiento.filtroEscritura({ id }),
    });
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
      where: this.aislamiento.filtroLectura({ clienteId }),
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: SELECCION_RESERVA_CON_RELACIONES,
    });
  }

  /**
   * Reserva concreta de un cliente (filtra por `clienteId` y por negocio, no
   * solo por id): devuelve `null` tanto si la reserva no existe como si
   * pertenece a otro cliente o a otro negocio, para no revelar la existencia
   * de reservas ajenas (HU-07).
   */
  async obtenerReservaDeCliente(
    clienteId: number,
    reservaId: number,
  ): Promise<ReservaConRelaciones | null> {
    return this.prisma.reservation.findFirst({
      where: this.aislamiento.filtroLectura({ id: reservaId, clienteId }),
      select: SELECCION_RESERVA_CON_RELACIONES,
    });
  }

  /**
   * Obtiene la reserva con sus relaciones, el hash del token de gestión y su
   * copia cifrada, para validar peticiones de modificación o cancelación de
   * invitados y para reproducir la respuesta original en un reintento.
   *
   * Restringida al negocio activo: una reserva de otro negocio se comporta
   * como inexistente.
   */
  async obtenerReservaParaGestionInvitado(reservaId: number): Promise<
    | (ReservaConRelaciones & {
        gestionTokenHash: string | null;
        gestionTokenCifrado: string | null;
      })
    | null
  > {
    return this.prisma.reservation.findUnique({
      where: this.aislamiento.filtroEscritura({ id: reservaId }),
      select: {
        ...SELECCION_RESERVA_CON_RELACIONES,
        gestionTokenHash: true,
        gestionTokenCifrado: true,
      },
    });
  }

  /**
   * Obtiene la reserva con sus relaciones básicas (barbero y servicio) por ID, para uso administrativo.
   */
  async obtenerReservaConRelaciones(
    id: number,
  ): Promise<ReservaConRelaciones | null> {
    return this.prisma.reservation.findUnique({
      where: this.aislamiento.filtroEscritura({ id }),
      select: SELECCION_RESERVA_CON_RELACIONES,
    });
  }

  /**
   * Obtiene la reserva con datos de cliente, servicio y barbero para la
   * transición a `COMPLETED` (verificación de propiedad y notificación).
   */
  async obtenerReservaParaCompletar(
    id: number,
  ): Promise<ReservaCompletarRegistro | null> {
    return this.obtenerReservaParaTransicionFinal(id);
  }

  /**
   * Obtiene la reserva con datos de cliente, servicio y barbero para la
   * transición a `NO_SHOW` (verificación de propiedad). Reutiliza la misma
   * selección que `COMPLETED`: ambos son estados finales con la misma
   * información expuesta.
   */
  async obtenerReservaParaNoShow(
    id: number,
  ): Promise<ReservaCompletarRegistro | null> {
    return this.obtenerReservaParaTransicionFinal(id);
  }

  /**
   * Consulta compartida para las transiciones a estados finales (`COMPLETED`
   * y `NO_SHOW`), que exponen la misma selección de relaciones.
   */
  private obtenerReservaParaTransicionFinal(
    id: number,
  ): Promise<ReservaCompletarRegistro | null> {
    return this.prisma.reservation.findUnique({
      where: { id },
      select: SELECCION_RESERVA_PARA_COMPLETAR,
    });
  }

  /**
   * Marca la reserva como `COMPLETED` únicamente si su estado lo permite
   * (`PENDING`/`CONFIRMED`/`IN_PROGRESS`). El `updateMany` condicional evita
   * dobles efectos ante peticiones concurrentes y permite detectar la
   * transición real (cuenta de filas afectadas).
   */
  async completar(id: number): Promise<boolean> {
    return this.transicionarEstadoFinal(id, ReservationStatus.COMPLETED);
  }

  /**
   * Marca la reserva como `NO_SHOW` únicamente si su estado lo permite
   * (`PENDING`/`CONFIRMED`/`IN_PROGRESS`). El `updateMany` condicional evita
   * dobles efectos ante peticiones concurrentes y permite detectar la
   * transición real (cuenta de filas afectadas). `NO_SHOW` ocupa la franja
   * (no es `CANCELLED`), por lo que no altera `slotActivo`.
   */
  async marcarNoShow(id: number): Promise<boolean> {
    return this.transicionarEstadoFinal(id, ReservationStatus.NO_SHOW);
  }

  /**
   * Aplica una transición condicional a un estado final solo si el estado
   * actual está entre los permitidos. Compartida por `COMPLETED` y `NO_SHOW`.
   */
  private async transicionarEstadoFinal(
    id: number,
    status: ReservationStatus,
  ): Promise<boolean> {
    const resultado = await this.prisma.reservation.updateMany({
      where: this.aislamiento.filtroEscritura({
        id,
        status: {
          in: [
            ReservationStatus.PENDING,
            ReservationStatus.CONFIRMED,
            ReservationStatus.IN_PROGRESS,
          ],
        },
      }),
      data: { status },
    });

    return resultado.count > 0;
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
      where: this.aislamiento.filtroLectura({
        barberoId,
        date: fecha,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
      }),
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
      where: this.aislamiento.filtroLectura({
        barberoId,
        date: {
          gte: desde,
          lte: hasta,
        },
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
      }),
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
   * REVALIDACIÓN (`opciones.revalidar`): antes de insertar, y DENTRO de la
   * transacción, se vuelven a comprobar las reglas que dependen del estado
   * (servicio y barbero activos, asignación vigente, horario semanal,
   * bloqueos, cierres y ocupación). La disponibilidad consultada antes de la
   * transacción puede quedarse obsoleta: sin esta revalidación, un servicio
   * desactivado o un horario retirado entre la consulta y la confirmación
   * se colarían en la reserva.
   *
   * IDEMPOTENCIA: con `datos.idempotencyKey`, antes de insertar se busca la
   * reserva de ESE negocio con esa clave. Si existe y el intento es materialmente
   * el mismo, se devuelve la reserva original (reintento); si el intento es
   * distinto, es un conflicto. La protección frente a dos peticiones
   * SIMULTÁNEAS con la misma clave es el índice único
   * `(negocioId, idempotencyKey)`: la perdedora recibe `P2002` y la capa de
   * aplicación recupera la reserva original.
   *
   * Los deadlocks/timeouts transitorios (`P2034`/`1213`/`1205`) se reintentan
   * de forma acotada con backoff; un `P2002` nunca se reintenta.
   */
  async crearConBloqueo(
    datos: CrearReservaDatos,
    opciones: OpcionesCrearConBloqueo = {},
  ): Promise<ReservaRegistro> {
    const negocioId = this.aislamiento.negocioIdRequerido();

    return this.conReintentos(() =>
      this.prisma.$transaction(async (tx) => {
        // El bloqueo de fila se mantiene sobre `Barbero` (misma estrategia de
        // concurrencia), añadiendo el filtro de negocio: si el barbero
        // pertenece a otro negocio, la fila NO se bloquea, de modo que la
        // creación no puede enlazar un barbero ajeno.
        await tx.$queryRaw`
          SELECT id FROM Barbero
           WHERE id = ${datos.barberoId}
             AND negocioId = ${negocioId}
           FOR UPDATE`;

        // IDEMPOTENCIA (antes que la revalidación): si esta reserva ES
        // nuestro propio intento concurrente, hay que devolverla en lugar de
        // comprobar el estado y rechazar por conflicto de franja.
        if (datos.idempotencyKey) {
          const previa = await tx.reservation.findFirst({
            where: {
              negocioId,
              idempotencyKey: datos.idempotencyKey,
            },
            select: SELECCION_RESERVA_PARA_IDEMPOTENCIA,
          });

          if (previa) {
            if (!this.mismaFirmaReserva(previa, datos)) {
              throw new DomainConflictException(
                'La clave de idempotencia ya se usó para una reserva distinta.',
                CODIGOS_CONFLICTO.IDEMPOTENCY_KEY_CONFLICT,
              );
            }

            return previa;
          }
        }

        // Revalidación transaccional: el estado se lee dentro de la
        // transacción, con los mismos datos que usará la inserción.
        if (opciones.revalidar) {
          await opciones.revalidar(tx, negocioId);
        }

        let clienteId: number;
        if ('clienteId' in datos.cliente) {
          clienteId = datos.cliente.clienteId;
        } else {
          const cliente = await tx.cliente.create({
            data: {
              nombre: datos.cliente.crear.nombre,
              apellido: datos.cliente.crear.apellido ?? null,
              telefono: datos.cliente.crear.telefono ?? null,
              ...(datos.cliente.crear.email !== undefined
                ? { email: datos.cliente.crear.email }
                : {}),
              usuarioId: datos.cliente.crear.usuarioId ?? null,
              negocioId,
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
            gestionTokenCifrado: datos.gestionTokenCifrado ?? null,
            idempotencyKey: datos.idempotencyKey ?? null,
            negocioId,
          },
        });
      }),
    );
  }

  /**
   * Reserva de un negocio por su clave de idempotencia.
   *
   * Es la vía para recuperar la reserva original cuando dos peticiones
   * simultáneas con la misma clave compiten: la perdedora recibe `P2002` y
   * recupera aquí la reserva que ganó.
   *
   * Acotada al negocio indicado: una clave NUNCA permite leer la reserva de
   * otra barbería.
   */
  async obtenerPorClaveDeIdempotencia(
    idempotencyKey: string,
  ): Promise<ReservaRegistro | null> {
    const negocioId = this.aislamiento.negocioIdRequerido();

    return this.prisma.reservation.findFirst({
      where: { negocioId, idempotencyKey },
      select: SELECCION_RESERVA_PARA_IDEMPOTENCIA,
    });
  }

  /**
   * Compara dos intentos de reserva por su contenido MATERIAL.
   *
   * Dos intentos con la misma clave de idempotencia son "el mismo" si piden lo
   * mismo: mismo barbero, mismo servicio, misma fecha, misma hora y mismo
   * cliente (cuando se conoce). El `clienteId` se ignora cuando el intento
   * crea al cliente (invitado): en ese caso cada intento genera su propio
   * cliente y no se puede comparar.
   */
  private mismaFirmaReserva(
    previa: {
      barberoId: number;
      servicioId: number;
      date: Date;
      startTime: string;
      endTime: string;
      clienteId: number;
    },
    datos: CrearReservaDatos,
  ): boolean {
    return mismaFirmaReserva(previa, this.firmaDeIntento(datos));
  }

  /** Firma material del intento, con la misma forma que usa el servicio. */
  private firmaDeIntento(datos: CrearReservaDatos): FirmaIntentoReserva {
    return {
      barberoId: datos.barberoId,
      servicioId: datos.servicioId,
      date: datos.date,
      startTime: datos.startTime,
      clienteId: 'clienteId' in datos.cliente ? datos.cliente.clienteId : null,
    };
  }

  private async conReintentos<T>(operacion: () => Promise<T>): Promise<T> {
    let reintento = 0;

    // Reintentos secuenciales con backoff: cada intento y su espera dependen
    // del resultado (error) del intento anterior, por lo que no es paralelizable.
    for (;;) {
      try {
        return await operacion(); // NOSONAR reintento secuencial intencional (depende del intento previo)
      } catch (error) {
        if (
          reintento >= MAX_REINTENTOS_TRANSACCION ||
          !esErrorReintentableTransaccion(error)
        ) {
          throw error;
        }

        reintento += 1;

        await this.esperar(reintento); // NOSONAR backoff secuencial intencional (depende del intento previo)
      }
    }
  }

  private esperar(intento: number): Promise<void> {
    // Backoff exponencial acotado: 50 ms, 100 ms y 200 ms.
    const milisegundos = 50 * 2 ** (intento - 1);
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
    const negocioId = this.aislamiento.negocioIdRequerido();

    return this.conReintentos(() =>
      this.prisma.$transaction(async (tx) => {
        // Mismo bloqueo de fila que antes, ahora acotado al negocio: un
        // barbero de otro negocio no se bloquea ni se enlaza.
        await tx.$queryRaw`
          SELECT id FROM Barbero
           WHERE id = ${datos.barberoId}
             AND negocioId = ${negocioId}
           FOR UPDATE`;

        const conflicto = await tx.reservation.findFirst({
          where: this.aislamiento.filtroLectura({
            id: { not: datos.id },
            barberoId: datos.barberoId,
            date: datos.date,
            status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
            startTime: { lt: datos.endTime },
            endTime: { gt: datos.startTime },
          }),
          select: { id: true },
        });

        if (conflicto) {
          throw new ConflictException(MENSAJE_HORARIO_NO_DISPONIBLE);
        }

        return tx.reservation.update({
          where: this.aislamiento.filtroEscritura({ id: datos.id }),
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
      where: this.aislamiento.filtroEscritura({ id }),
      data: { status: ReservationStatus.CANCELLED },
    });
  }

  /**
   * Obtiene las reservas de una fecha con estado PENDING o CONFIRMED
   * que aún no han recibido el recordatorio automático por WhatsApp.
   *
   * ⚠️ AISLAMIENDO POR NEGOCIO (HU-11) ⚠️
   *
   * Esta consulta la consume el cron de recordatorios
   * (`src/modules/reservas/cron/recordatorios.cron.ts`).
   *
   * El cron establece el contexto de negocio ANTES de llamar a este método
   * (`NegocioContextoService.ejecutarEnContexto`), de modo que la consulta
   * está acotada al negocio que se está procesando. El repositorio NO recorre
   * los negocios por su cuenta: el aislamiento es responsabilidad del
   * proceso que fija el contexto, y la extensión de Prisma lo verifica.
   *
   * Sin contexto de negocio, la llamada FALLA (el filtro exige un negocio
   * autorizado): nunca devuelve citas de todos los negocios.
   *
   * El `await` se hace DENTRO del contexto (y no fuera): Prisma devuelve una
   * promesa perezosa y la consulta se ejecuta cuando se espera. Esperarla
   * fuera del contexto ejecutaría la consulta ya fuera del ámbito.
   */
  async obtenerCitasPendientesRecordatorio(fecha: Date) {
    return this.prisma.reservation.findMany({
      where: this.aislamiento.filtroLectura({
        date: fecha,
        status: {
          in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED],
        },
        recordatorioEnviado: false,
      }),
      select: {
        id: true,
        startTime: true,
        endTime: true,
        precioReservado: true,
        date: true,
        cliente: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            telefono: true,
          },
        },
        barbero: {
          select: {
            id: true,
            usuario: {
              select: {
                nombre: true,
                apellido: true,
              },
            },
          },
        },
        servicio: {
          select: {
            id: true,
            nombre: true,
            precio: true,
          },
        },
      },
    });
  }

  /**
   * Marca el recordatorio de una reserva como enviado para no retransmitirlo.
   *
   * Lo invoca el cron de recordatorios, que ya ha establecido el contexto del
   * negocio que está procesando.
   *
   * AISLAMIENTO: la escritura usa el negocio del CONTEXTO, no el de la fila
   * leída. De este modo, marcar un recordatorio de OTRO negocio es imposible:
   * la actualización se acota al negocio del contexto y, si la reserva no
   * pertenece a él, no afecta a ninguna fila.
   *
   * Sin contexto de negocio, la llamada FALLA (`negocioIdRequerido`): no
   * degrada a una marca global.
   */
  async marcarRecordatorioEnviado(id: number): Promise<void> {
    const actualizadas = await this.prisma.reservation.updateMany({
      where: this.aislamiento.filtroEscritura({ id }),
      data: { recordatorioEnviado: true },
    });

    if (actualizadas.count === 0) {
      this.logger.warn(
        `No se marcó el recordatorio de la reserva ${id}: no pertenece al negocio del contexto.`,
      );
    }
  }

  /**
   * Obtiene una reserva detallada con sus relaciones completas para la vista de SUPERADMIN.
   */
  async obtenerReservaAdminPorId(
    id: number,
  ): Promise<ReservaAdminRegistro | null> {
    return this.prisma.reservation.findUnique({
      where: this.aislamiento.filtroEscritura({ id }),
      select: SELECCION_RESERVA_ADMIN,
    });
  }

  /**
   * Lista reservas de la barbería aplicando filtros directos en base de datos (fecha, rango, barbero, estado, cliente).
   *
   * El filtro de negocio se integra en el `where`: la consulta solo puede
   * devolver reservas del negocio activo, nunca de los demás.
   */
  async listarReservasAdmin(
    filtro: FiltroReservasAdminRepo,
  ): Promise<ReservaAdminRegistro[]> {
    const where: Prisma.ReservationWhereInput = {};

    if (filtro.fecha) {
      where.date = filtro.fecha;
    } else if (filtro.desde || filtro.hasta) {
      where.date = {
        ...(filtro.desde ? { gte: filtro.desde } : {}),
        ...(filtro.hasta ? { lte: filtro.hasta } : {}),
      };
    }

    if (filtro.barberoId) {
      where.barberoId = filtro.barberoId;
    }

    if (filtro.estado) {
      where.status = filtro.estado;
    }

    if (filtro.clienteId) {
      where.clienteId = filtro.clienteId;
    }

    return this.prisma.reservation.findMany({
      where: this.aislamiento.filtroLectura(where),
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
      select: SELECCION_RESERVA_ADMIN,
    });
  }
}
