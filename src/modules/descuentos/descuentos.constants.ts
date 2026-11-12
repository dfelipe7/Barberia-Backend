import { WeekDay } from '../../../generated/prisma/enums';

export const PORCENTAJE_MINIMO_DESCUENTO = 1;
export const PORCENTAJE_MAXIMO_DESCUENTO = 99;

export const MENSAJE_DESCUENTO_CREADO = 'Descuento creado correctamente';
export const MENSAJE_DESCUENTO_ACTUALIZADO =
  'Descuento actualizado correctamente';
export const MENSAJE_DESCUENTO_ACTIVADO = 'Descuento activado correctamente';
export const MENSAJE_DESCUENTO_DESACTIVADO =
  'Descuento desactivado correctamente';
export const MENSAJE_CONFIGURACION_INVALIDA_ACTIVACION =
  'No se puede activar un descuento con configuración inválida';
export const MENSAJE_DESCUENTO_NO_ENCONTRADO =
  'El descuento no se encuentra disponible';
export const MENSAJE_SIN_CAMBIOS_DESCUENTO =
  'Debe indicar al menos un campo para actualizar (porcentaje o días)';
export const MENSAJE_DESCUENTO_DUPLICADO =
  'Ya existe un descuento configurado para este elemento. Modifique el descuento existente.';
export const MENSAJE_ELEMENTO_NO_DISPONIBLE =
  'El producto o servicio no está disponible en este negocio';
export const MENSAJE_PRODUCTO_NO_DISPONIBLE =
  'El producto no se encuentra disponible en este negocio';
export const MENSAJE_SERVICIO_NO_DISPONIBLE =
  'El servicio no se encuentra disponible en este negocio';
export const MENSAJE_PORCENTAJE_INVALIDO =
  'El porcentaje debe ser un número entre 1 y 99 con máximo dos decimales';
export const MENSAJE_DIAS_REQUERIDOS =
  'Debe seleccionar al menos un día de la semana válido';

export const MENSAJE_DESCUENTOS_LISTADOS =
  'Descuentos consultados correctamente';
export const MENSAJE_SIN_DESCUENTOS =
  'No hay descuentos configurados para este negocio';

// Constantes de evaluación de descuentos aplicables (HE-10-HU-05)
export const MENSAJE_DESCUENTO_APLICABLE =
  'Descuento aplicable para el día evaluado';
export const MENSAJE_DESCUENTO_NO_APLICABLE_DIA =
  'El descuento no aplica para el día seleccionado';
export const MENSAJE_DESCUENTO_INACTIVO = 'El descuento no se encuentra activo';
export const MENSAJE_SIN_DESCUENTO_CONFIGURADO =
  'No hay descuento configurado para este elemento';
export const MENSAJE_SERVICIO_FECHA_REQUERIDA =
  'Indique la fecha de la cita para calcular el precio con descuento';
export const MENSAJE_FORMATO_FECHA_INVALIDO =
  'El formato de fecha debe ser YYYY-MM-DD y corresponder a una fecha válida';

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
