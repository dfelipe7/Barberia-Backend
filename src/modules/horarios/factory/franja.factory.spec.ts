import {
  FranjaFactory,
  HORA_APERTURA_JORNADA,
  HORA_CIERRE_JORNADA,
  DURACION_FRANJA_MINUTOS,
} from './franja.factory';

describe('FranjaFactory', () => {
  let factory: FranjaFactory;

  beforeEach(() => {
    factory = new FranjaFactory();
  });

  describe('constantes de la jornada', () => {
    it('expone la jornada oficial 09:00-20:00 con granularidad de 60 minutos', () => {
      expect(HORA_APERTURA_JORNADA).toBe('09:00');
      expect(HORA_CIERRE_JORNADA).toBe('20:00');
      expect(DURACION_FRANJA_MINUTOS).toBe(60);
    });
  });

  describe('conversión y validación de horas (centralizada)', () => {
    it('convierte HH:mm a minutos desde medianoche', () => {
      expect(factory.aMinutos('00:00')).toBe(0);
      expect(factory.aMinutos('09:00')).toBe(540);
      expect(factory.aMinutos('19:00')).toBe(1140);
      expect(factory.aMinutos('20:00')).toBe(1200);
      expect(factory.aMinutos('23:59')).toBe(1439);
    });

    it('convierte minutos a HH:mm rellenando con ceros', () => {
      expect(factory.aHora(0)).toBe('00:00');
      expect(factory.aHora(540)).toBe('09:00');
      expect(factory.aHora(1200)).toBe('20:00');
      expect(factory.aHora(605)).toBe('10:05');
    });

    it('es reversible (idempotente) para horas válidas', () => {
      ['00:00', '09:00', '13:45', '20:00', '23:59'].forEach((hora) => {
        expect(factory.aHora(factory.aMinutos(hora))).toBe(hora);
      });
    });

    it('lanza RangeError con formatos de hora inválidos', () => {
      const invalidos = [
        '9:00',
        '09:5',
        '24:00',
        '09:60',
        '09-00',
        '0900',
        'abc',
        '',
        ' 09:00',
        '09:00 ',
      ];
      invalidos.forEach((hora) => {
        expect(() => factory.aMinutos(hora)).toThrow(RangeError);
      });
      expect(() => factory.aMinutos(null as unknown as string)).toThrow(
        RangeError,
      );
      expect(() => factory.aMinutos(undefined as unknown as string)).toThrow(
        RangeError,
      );
    });

    it('lanza RangeError con minutos fuera de rango o no enteros', () => {
      expect(() => factory.aHora(-1)).toThrow(RangeError);
      expect(() => factory.aHora(1440)).toThrow(RangeError);
      expect(() => factory.aHora(90.5)).toThrow(RangeError);
    });
  });

  describe('generarCatalogoDelDia', () => {
    it('produce exactamente 11 franjas consecutivas de 60 minutos', () => {
      const franjas = factory.generarCatalogoDelDia();

      expect(franjas).toHaveLength(11);
      expect(franjas[0]).toEqual({ startTime: '09:00', endTime: '10:00' });
      expect(franjas[10]).toEqual({ startTime: '19:00', endTime: '20:00' });
    });

    it('cada franja dura exactamente 60 minutos y no hay huecos ni solapes', () => {
      const franjas = factory.generarCatalogoDelDia();

      franjas.forEach((franja, indice) => {
        const duracion =
          factory.aMinutos(franja.endTime) - factory.aMinutos(franja.startTime);
        expect(duracion).toBe(DURACION_FRANJA_MINUTOS);

        if (indice > 0) {
          expect(franja.startTime).toBe(franjas[indice - 1].endTime);
        }
      });
    });

    it('todas las franjas están dentro de la jornada 09:00-20:00', () => {
      const franjas = factory.generarCatalogoDelDia();
      const apertura = factory.aMinutos(HORA_APERTURA_JORNADA);
      const cierre = factory.aMinutos(HORA_CIERRE_JORNADA);

      franjas.forEach((franja) => {
        expect(factory.aMinutos(franja.startTime)).toBeGreaterThanOrEqual(
          apertura,
        );
        expect(factory.aMinutos(franja.endTime)).toBeLessThanOrEqual(cierre);
      });
    });
  });

  describe('generarFranjas con rangos arbitrarios válidos', () => {
    it('genera varias franjas para un rango de varias horas', () => {
      expect(factory.generarFranjas('09:00', '12:00')).toEqual([
        { startTime: '09:00', endTime: '10:00' },
        { startTime: '10:00', endTime: '11:00' },
        { startTime: '11:00', endTime: '12:00' },
      ]);
    });

    it('acepta el rango mínimo de una franja en el límite inferior (09:00-10:00)', () => {
      expect(factory.generarFranjas('09:00', '10:00')).toEqual([
        { startTime: '09:00', endTime: '10:00' },
      ]);
    });

    it('acepta el rango en el límite superior (19:00-20:00)', () => {
      expect(factory.generarFranjas('19:00', '20:00')).toEqual([
        { startTime: '19:00', endTime: '20:00' },
      ]);
    });

    it('genera franjas no contiguas en distintos momentos del día', () => {
      expect(factory.generarFranjas('14:00', '16:00')).toEqual([
        { startTime: '14:00', endTime: '15:00' },
        { startTime: '15:00', endTime: '16:00' },
      ]);
    });
  });

  describe('generarFranjas con entradas inválidas', () => {
    it('lanza RangeError con formato de hora inválido', () => {
      expect(() => factory.generarFranjas('9:00', '10:00')).toThrow(RangeError);
      expect(() => factory.generarFranjas('09:00', '25:00')).toThrow(
        RangeError,
      );
      expect(() => factory.generarFranjas('abc', '10:00')).toThrow(RangeError);
    });

    it('lanza RangeError si el fin es anterior al inicio', () => {
      expect(() => factory.generarFranjas('12:00', '11:00')).toThrow(
        RangeError,
      );
    });

    it('lanza RangeError si inicio y fin son iguales (duración cero, distinto a un día sin horario)', () => {
      expect(() => factory.generarFranjas('10:00', '10:00')).toThrow(
        RangeError,
      );
    });

    it('lanza RangeError si el rango se sale de la jornada', () => {
      expect(() => factory.generarFranjas('08:00', '10:00')).toThrow(
        RangeError,
      );
      expect(() => factory.generarFranjas('19:00', '21:00')).toThrow(
        RangeError,
      );
      expect(() => factory.generarFranjas('08:00', '09:00')).toThrow(
        RangeError,
      );
    });

    it('lanza RangeError si el rango no es múltiplo exacto de 60 minutos', () => {
      expect(() => factory.generarFranjas('09:00', '10:30')).toThrow(
        RangeError,
      );
      expect(() => factory.generarFranjas('09:00', '09:30')).toThrow(
        RangeError,
      );
    });

    it('lanza RangeError si la hora de inicio no está alineada a :00', () => {
      expect(() => factory.generarFranjas('09:30', '10:30')).toThrow(
        RangeError,
      );
    });

    it('no genera franjas que crucen medianoche', () => {
      expect(() => factory.generarFranjas('23:00', '00:00')).toThrow(
        RangeError,
      );
      expect(() => factory.generarFranjas('20:00', '00:00')).toThrow(
        RangeError,
      );
    });
  });
});
