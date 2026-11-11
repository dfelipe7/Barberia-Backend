import { WeekDay } from '../../../generated/prisma/enums';

export const PORCENTAJE_MINIMO_DESCUENTO = 1;
export const PORCENTAJE_MAXIMO_DESCUENTO = 99;

export const MENSAJE_DESCUENTO_CREADO = 'Descuento creado correctamente';
export const MENSAJE_DESCUENTO_DUPLICADO =
  'Ya existe un descuento configurado para este elemento. Modifique el descuento existente.';
export const MENSAJE_ELEMENTO_NO_DISPONIBLE =
  'El producto o servicio no está disponible en este negocio';
export const MENSAJE_PORCENTAJE_INVALIDO =
  'El porcentaje debe ser un número entre 1 y 99 con máximo dos decimales';
export const MENSAJE_DIAS_REQUERIDOS =
  'Debe seleccionar al menos un día de la semana válido';

/** Orden canónico para normalizar `diasSemana` en las respuestas. */
export const DIAS_SEMANA_ORDEN: WeekDay[] = [
  WeekDay.MONDAY,
  WeekDay.TUESDAY,
  WeekDay.WEDNESDAY,
  WeekDay.THURSDAY,
  WeekDay.FRIDAY,
  WeekDay.SATURDAY,
  WeekDay.SUNDAY,
];
