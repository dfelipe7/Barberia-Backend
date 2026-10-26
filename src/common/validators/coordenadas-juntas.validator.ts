import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Valida que las coordenadas de un objeto vayan SIEMPRE JUNTAS.
 *
 * Una latitud sin longitud (o al revés) es un dato INCOMPLETO: guardarlo
 * daría una ubicación que no se puede situar y una URL de mapa derivada que
 * apuntaría a un sitio arbitrario. Por eso se rechazan las coordenadas
 * parciales en lugar de completarlas con un valor por defecto inventado.
 *
 * Se aplica a AMBOS campos (`latitud` y `longitud`) del DTO: cada propiedad
 * ejecuta la comprobación sobre el objeto completo (`args.object`). Así el
 * error se detecta tanto si falta la longitud como si falta la latitud.
 *
 * Cuando el campo sobre el que se declara la restricción no viene informado,
 * `class-validator` omite sus validadores; por eso la restricción se declara
 * en los DOS campos y no solo en uno.
 */
@ValidatorConstraint({ name: 'coordenadasJuntas', async: false })
export class CoordenadasJuntasConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const objeto = args.object as
      { latitud?: number | null; longitud?: number | null } | undefined;

    const tieneLatitud =
      objeto?.latitud !== undefined && objeto?.latitud !== null;
    const tieneLongitud =
      objeto?.longitud !== undefined && objeto?.longitud !== null;

    return tieneLatitud === tieneLongitud;
  }

  defaultMessage(): string {
    return 'latitud y longitud deben informarse juntas: no se admiten coordenadas parciales.';
  }
}
