import { DisponibilidadMapper } from './disponibilidad.mapper';
import { EstadoFranja } from '../common/estado-franja';
import type { FranjaEvaluada } from '../common/estado-franja';

describe('DisponibilidadMapper', () => {
  const mapper = new DisponibilidadMapper();
  const consulta = { barberoId: 3, servicioId: 2, fecha: '2026-10-20' };

  const franjas: FranjaEvaluada[] = [
    { startTime: '09:00', endTime: '10:00', estado: EstadoFranja.AVAILABLE },
    { startTime: '10:00', endTime: '11:00', estado: EstadoFranja.RESERVED },
    { startTime: '11:00', endTime: '12:00', estado: EstadoFranja.BLOCKED },
    {
      startTime: '12:00',
      endTime: '13:00',
      estado: EstadoFranja.GENERAL_CLOSURE,
    },
    {
      startTime: '13:00',
      endTime: '14:00',
      estado: EstadoFranja.OUTSIDE_SCHEDULE,
    },
  ];

  describe('aPublica', () => {
    it('solo incluye franjas AVAILABLE y oculta cualquier motivo', () => {
      const resultado = mapper.aPublica(consulta, franjas);

      expect(resultado).toEqual({
        fecha: '2026-10-20',
        timeZone: 'America/Bogota',
        barberoId: 3,
        servicioId: 2,
        slots: [{ startTime: '09:00', endTime: '10:00', available: true }],
      });
      expect(JSON.stringify(resultado)).not.toContain('RESERVED');
      expect(JSON.stringify(resultado)).not.toContain('BLOCKED');
      expect(JSON.stringify(resultado)).not.toContain('GENERAL_CLOSURE');
      expect(JSON.stringify(resultado)).not.toContain('OUTSIDE_SCHEDULE');
    });

    it('devuelve servicioId null cuando no se informa', () => {
      const resultado = mapper.aPublica(
        { barberoId: 3, fecha: '2026-10-20' },
        franjas,
      );

      expect(resultado.servicioId).toBeNull();
    });

    it('devuelve una lista vacía cuando ninguna franja está disponible', () => {
      const resultado = mapper.aPublica(consulta, [
        { startTime: '10:00', endTime: '11:00', estado: EstadoFranja.RESERVED },
      ]);

      expect(resultado.slots).toEqual([]);
    });
  });

  describe('aDetallada', () => {
    it('expone el estado de cada franja', () => {
      const resultado = mapper.aDetallada(consulta, franjas);

      expect(resultado.timeZone).toBe('America/Bogota');
      expect(resultado.slots).toEqual([
        { startTime: '09:00', endTime: '10:00', status: 'AVAILABLE' },
        { startTime: '10:00', endTime: '11:00', status: 'RESERVED' },
        { startTime: '11:00', endTime: '12:00', status: 'BLOCKED' },
        { startTime: '12:00', endTime: '13:00', status: 'GENERAL_CLOSURE' },
        { startTime: '13:00', endTime: '14:00', status: 'OUTSIDE_SCHEDULE' },
      ]);
    });
  });
});
