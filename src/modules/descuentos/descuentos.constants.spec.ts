import { WeekDay } from '../../../generated/prisma/enums';
import { normalizarDiasSemana } from './descuentos.constants';

describe('descuentos.constants — normalizarDiasSemana', () => {
  it('devuelve arreglo vacío cuando recibe un arreglo vacío ([] -> [])', () => {
    expect(normalizarDiasSemana([])).toEqual([]);
  });

  it('ordena canónicamente de lunes a domingo independientemente del orden de entrada', () => {
    const entrada = [
      WeekDay.FRIDAY,
      WeekDay.SUNDAY,
      WeekDay.MONDAY,
      WeekDay.WEDNESDAY,
    ];
    const esperado = [
      WeekDay.MONDAY,
      WeekDay.WEDNESDAY,
      WeekDay.FRIDAY,
      WeekDay.SUNDAY,
    ];
    expect(normalizarDiasSemana(entrada)).toEqual(esperado);
  });

  it('filtra elementos inválidos y elimina duplicados', () => {
    const entrada = [
      'INVALID_DAY',
      WeekDay.TUESDAY,
      WeekDay.TUESDAY,
      null,
      123,
      WeekDay.SATURDAY,
    ];
    expect(normalizarDiasSemana(entrada)).toEqual([
      WeekDay.TUESDAY,
      WeekDay.SATURDAY,
    ]);
  });

  it('devuelve arreglo vacío cuando el valor no es un arreglo (no-array -> [])', () => {
    expect(normalizarDiasSemana(null)).toEqual([]);
    expect(normalizarDiasSemana(undefined)).toEqual([]);
    expect(normalizarDiasSemana('MONDAY')).toEqual([]);
    expect(normalizarDiasSemana(12345)).toEqual([]);
    expect(normalizarDiasSemana({ dias: [WeekDay.MONDAY] })).toEqual([]);
  });
});
