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
