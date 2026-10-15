import { HorarioSemanalRule } from './horario-semanal.rule';
import { EstadoFranja } from '../common/estado-franja';
import type { ContextoDisponibilidad } from './regla-disponibilidad.strategy';
import type { FranjaHorario } from '../factory/franja.factory';

describe('HorarioSemanalRule', () => {
  const rule = new HorarioSemanalRule();
  const franja: FranjaHorario = { startTime: '09:00', endTime: '10:00' };

  const crearContexto = (
    overrides: Partial<ContextoDisponibilidad> = {},
  ): ContextoDisponibilidad => ({
    barberoId: 7,
    fecha: '2026-10-20',
    diaSemana: 'TUESDAY',
    franjasHorario: [],
    bloqueosActivos: [],
    cierresActivos: [],
    ...overrides,
  });

  it('debe tener la prioridad más alta', () => {
    expect(rule.orden).toBe(10);
  });

  it('devuelve OUTSIDE_SCHEDULE cuando la franja no está en el horario del día', () => {
    const estado = rule.evaluar(franja, crearContexto());

    expect(estado).toBe(EstadoFranja.OUTSIDE_SCHEDULE);
  });

  it('devuelve null (cede el turno) cuando la franja está en el horario', () => {
    const estado = rule.evaluar(
      franja,
      crearContexto({ franjasHorario: [{ startTime: '09:00' }] }),
    );

    expect(estado).toBeNull();
  });
});
