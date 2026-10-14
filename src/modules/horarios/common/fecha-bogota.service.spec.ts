import {
  FechaBogotaService,
  ZONA_HORARIA_BOGOTA,
} from './fecha-bogota.service';

describe('FechaBogotaService', () => {
  let service: FechaBogotaService;

  beforeEach(() => {
    service = new FechaBogotaService();
  });

  describe('zona horaria', () => {
    it('expone la zona horaria oficial America/Bogota', () => {
      expect(ZONA_HORARIA_BOGOTA).toBe('America/Bogota');
    });
  });

  describe('esFechaCalendarioValida', () => {
    it('acepta fechas de calendario YYYY-MM-DD válidas', () => {
      expect(service.esFechaCalendarioValida('2026-10-20')).toBe(true);
      expect(service.esFechaCalendarioValida('2024-02-29')).toBe(true);
      expect(service.esFechaCalendarioValida('2026-01-01')).toBe(true);
    });

    it('rechaza formatos que no son YYYY-MM-DD', () => {
      const formatosInvalidos = [
        '2026/10/20',
        '20-10-2026',
        '2026-1-1',
        '20261020',
        '2026-10-20T00:00:00Z',
        ' 2026-10-20',
        '2026-10-20 ',
        '',
        'texto',
      ];

      formatosInvalidos.forEach((fecha) => {
        expect(service.esFechaCalendarioValida(fecha)).toBe(false);
      });
    });

    it('rechaza valores no string', () => {
      expect(service.esFechaCalendarioValida(null as unknown as string)).toBe(
        false,
      );
      expect(
        service.esFechaCalendarioValida(undefined as unknown as string),
      ).toBe(false);
      expect(
        service.esFechaCalendarioValida(20261020 as unknown as string),
      ).toBe(false);
    });

    it('rechaza fechas con día, mes o año fuera de rango', () => {
      expect(service.esFechaCalendarioValida('2026-13-01')).toBe(false);
      expect(service.esFechaCalendarioValida('2026-00-10')).toBe(false);
      expect(service.esFechaCalendarioValida('2026-02-30')).toBe(false);
      expect(service.esFechaCalendarioValida('2026-04-31')).toBe(false);
      expect(service.esFechaCalendarioValida('2023-02-29')).toBe(false);
      expect(service.esFechaCalendarioValida('2026-10-00')).toBe(false);
    });
  });

  describe('obtenerDiaSemana', () => {
    it('devuelve el día de la semana correcto para una fecha de calendario', () => {
      expect(service.obtenerDiaSemana('2026-10-19')).toBe('MONDAY');
      expect(service.obtenerDiaSemana('2026-10-20')).toBe('TUESDAY');
      expect(service.obtenerDiaSemana('2026-10-25')).toBe('SUNDAY');
    });

    it('no se ve afectado por la zona horaria del sistema (fecha de calendario pura)', () => {
      const esperado = new Date(Date.UTC(2026, 9, 20)).getUTCDay();
      const dias = [
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
      ];
      expect(service.obtenerDiaSemana('2026-10-20')).toBe(dias[esperado]);
    });

    it('lanza RangeError con una fecha de calendario inválida', () => {
      expect(() => service.obtenerDiaSemana('2026-02-30')).toThrow(RangeError);
      expect(() => service.obtenerDiaSemana('20/10/2026')).toThrow(RangeError);
      expect(() => service.obtenerDiaSemana('')).toThrow(RangeError);
    });
  });

  describe('obtenerComponentesBogota', () => {
    it('convierte un instante UTC a la fecha y hora de Bogotá sin desplazar el día', () => {
      // 2026-10-20 02:00 UTC === 2026-10-19 21:00 en Bogotá (UTC-5)
      const componentes = service.obtenerComponentesBogota(
        new Date('2026-10-20T02:00:00.000Z'),
      );

      expect(componentes.fecha).toBe('2026-10-19');
      expect(componentes.hora).toBe('21:00');
      expect(componentes.anio).toBe(2026);
      expect(componentes.mes).toBe(10);
      expect(componentes.dia).toBe(19);
      expect(componentes.hora24).toBe(21);
      expect(componentes.minuto).toBe(0);
      expect(componentes.diaSemana).toBe('MONDAY');
    });

    it('maneja correctamente el límite de medianoche de Bogotá', () => {
      // 04:59 UTC aún corresponde al día anterior en Bogotá
      expect(
        service.obtenerFechaBogota(new Date('2026-10-20T04:59:00.000Z')),
      ).toBe('2026-10-19');
      // 05:00 UTC ya es medianoche del 20 en Bogotá
      expect(
        service.obtenerFechaBogota(new Date('2026-10-20T05:00:00.000Z')),
      ).toBe('2026-10-20');
      expect(
        service.obtenerHoraBogota(new Date('2026-10-20T05:00:00.000Z')),
      ).toBe('00:00');
    });

    it('rellena con ceros los componentes de fecha y hora', () => {
      const componentes = service.obtenerComponentesBogota(
        new Date('2026-01-05T13:07:00.000Z'), // 08:07 Bogotá
      );

      expect(componentes.fecha).toBe('2026-01-05');
      expect(componentes.hora).toBe('08:07');
      expect(componentes.hora24).toBe(8);
      expect(componentes.minuto).toBe(7);
    });

    it('lanza RangeError con un instante inválido', () => {
      expect(() =>
        service.obtenerComponentesBogota(new Date('fecha-invalida')),
      ).toThrow(RangeError);
      expect(() =>
        service.obtenerComponentesBogota(undefined as unknown as Date),
      ).toThrow(RangeError);
      expect(() =>
        service.obtenerComponentesBogota('2026-10-20' as unknown as Date),
      ).toThrow(RangeError);
    });
  });

  describe('obtenerFechaBogota y obtenerHoraBogota', () => {
    it('devuelven la fecha y hora de Bogotá derivadas del mismo instante', () => {
      const instante = new Date('2026-12-31T23:30:00.000Z'); // 18:30 Bogotá del mismo día
      expect(service.obtenerFechaBogota(instante)).toBe('2026-12-31');
      expect(service.obtenerHoraBogota(instante)).toBe('18:30');
    });

    it('propagan el error cuando el instante es inválido', () => {
      expect(() => service.obtenerFechaBogota(new Date('nope'))).toThrow(
        RangeError,
      );
      expect(() => service.obtenerHoraBogota(new Date('nope'))).toThrow(
        RangeError,
      );
    });
  });
});
