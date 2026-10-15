/**
 * Consulta resuelta que recibe la fachada de disponibilidad (`DisponibilidadService`).
 *
 * Es la entrada única y estable del cálculo de disponibilidad: los controllers
 * solo la construyen a partir de la ruta y el query, y HE-04 la consumirá como
 * fuente de verdad sin reimplementar reglas.
 */
export interface ConsultaDisponibilidad {
  /** `Barbero.id` (no el `Usuario.id`): coherente con horarios y bloqueos. */
  barberoId: number;
  /** Servicio opcional. Si se informa, se valida que exista, esté ACTIVO y esté asignado. */
  servicioId?: number;
  /** Fecha de calendario `YYYY-MM-DD` del día de agenda. */
  fecha: string;
}
