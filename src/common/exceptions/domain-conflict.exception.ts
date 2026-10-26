import { ConflictException } from '@nestjs/common';

/**
 * Códigos de conflicto estables que forman parte del contrato de la API.
 *
 * Se exponen en el cuerpo del error (`code`) para que los clientes y HE-04
 * puedan reaccionar de forma programática sin depender del texto del mensaje.
 */
export const CODIGOS_CONFLICTO = {
  SCHEDULE_BLOCK_HAS_RESERVATIONS: 'SCHEDULE_BLOCK_HAS_RESERVATIONS',
  SCHEDULE_CHANGE_AFFECTS_RESERVATIONS: 'SCHEDULE_CHANGE_AFFECTS_RESERVATIONS',
  SLOT_ALREADY_RESERVED: 'SLOT_ALREADY_RESERVED',
  /** El servicio existe pero está INACTIVO en el momento de confirmar. */
  SERVICE_INACTIVE: 'SERVICE_INACTIVE',
  /** El barbero existe pero su perfil está INACTIVO. */
  BARBER_INACTIVE: 'BARBER_INACTIVE',
  /** El barbero no tiene franja semanal que cubra la hora solicitada. */
  BARBER_NO_SCHEDULE: 'BARBER_NO_SCHEDULE',
  /** El barbero ya no presta el servicio (asignación eliminada). */
  NO_BARBER_FOR_SERVICE: 'NO_BARBER_FOR_SERVICE',
  /** La franja está ocupada: la perdió otra reserva o un bloqueo/cierre. */
  SLOT_TAKEN: 'SLOT_TAKEN',
  /** El mismo cliente ya tiene una reserva activa en esa franja. */
  DUPLICATE_OWN_RESERVATION: 'DUPLICATE_OWN_RESERVATION',
  /** La misma clave de idempotencia se reutilizó con una petición distinta. */
  IDEMPOTENCY_KEY_CONFLICT: 'IDEMPOTENCY_KEY_CONFLICT',
} as const;

export type CodigoConflicto =
  (typeof CODIGOS_CONFLICTO)[keyof typeof CODIGOS_CONFLICTO];

/**
 * Conflicto de dominio (HTTP 409) con código estable.
 *
 * `AllExceptionsFilter` conserva el formato de error existente
 * (`statusCode`, `timestamp`, `path`, `message`) y añade `code` y, si aplica,
 * `details`. No usar cadenas de código sueltas en los servicios.
 */
export class DomainConflictException extends ConflictException {
  constructor(
    message: string,
    code: CodigoConflicto,
    details?: Record<string, unknown>,
  ) {
    super({
      statusCode: 409,
      message,
      code,
      ...(details === undefined ? {} : { details }),
    });
  }
}
