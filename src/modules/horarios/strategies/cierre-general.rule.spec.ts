import { CierreGeneralRule } from './cierre-general.rule';
import { FranjaFactory } from '../factory/franja.factory';
import { EstadoFranja } from '../common/estado-franja';
import type { ContextoDisponibilidad } from './regla-disponibilidad.strategy';
import type { FranjaHorario } from '../factory/franja.factory';

describe('CierreGeneralRule', () => {
  const rule = new CierreGeneralRule(new FranjaFactory());
  const franja: FranjaHorario = { startTime: '09:00', endTime: '10:00' };

  const crearContexto = (
    overrides: Partial<ContextoDisponibilidad> = {},
  ): ContextoDisponibilidad => ({
    barberoId: 7,
    fecha: '2026-10-20',
    diaSemana: 'TUESDAY',
    franjasHorario: [{ startTime: '09:00' }],
    bloqueosActivos: [],
    cierresActivos: [],
    ...overrides,
  });

  it('debe tener la segunda prioridad', () => {
    expect(rule.orden).toBe(20);
  });

  it('devuelve null cuando no hay cierres', () => {
    expect(rule.evaluar(franja, crearContexto())).toBeNull();
  });

  it('devuelve GENERAL_CLOSURE con un cierre de día completo', () => {
    const estado = rule.evaluar(
      franja,
      crearContexto({
        cierresActivos: [{ allDay: true, startTime: null, endTime: null }],
      }),
    );

    expect(estado).toBe(EstadoFranja.GENERAL_CLOSURE);
  });

  it('devuelve GENERAL_CLOSURE con un cierre parcial que solapa la franja', () => {
    const estado = rule.evaluar(
      franja,
      crearContexto({
        cierresActivos: [
          { allDay: false, startTime: '09:30', endTime: '11:00' },
        ],
      }),
    );

    expect(estado).toBe(EstadoFranja.GENERAL_CLOSURE);
  });

  it('devuelve null cuando el cierre parcial no alcanza la franja', () => {
    const estado = rule.evaluar(
      franja,
      crearContexto({
        cierresActivos: [
          { allDay: false, startTime: '11:00', endTime: '12:00' },
        ],
      }),
    );

    expect(estado).toBeNull();
  });

  it('ignora un cierre parcial sin horas', () => {
    const estado = rule.evaluar(
      franja,
      crearContexto({
        cierresActivos: [{ allDay: false, startTime: null, endTime: null }],
      }),
    );

    expect(estado).toBeNull();
  });
});
