import { BloqueoActivoRule } from './bloqueo-activo.rule';
import { FranjaFactory } from '../factory/franja.factory';
import { EstadoFranja } from '../common/estado-franja';
import type { ContextoDisponibilidad } from './regla-disponibilidad.strategy';
import type { FranjaHorario } from '../factory/franja.factory';

describe('BloqueoActivoRule', () => {
  const rule = new BloqueoActivoRule(new FranjaFactory());
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

  it('debe tener la tercera prioridad', () => {
    expect(rule.orden).toBe(30);
  });

  it('devuelve null cuando no hay bloqueos', () => {
    expect(rule.evaluar(franja, crearContexto())).toBeNull();
  });

  it('devuelve BLOCKED cuando un bloqueo solapa la franja', () => {
    const estado = rule.evaluar(
      franja,
      crearContexto({
        bloqueosActivos: [{ startTime: '09:30', endTime: '10:30' }],
      }),
    );

    expect(estado).toBe(EstadoFranja.BLOCKED);
  });

  it('devuelve null cuando el bloqueo no solapa la franja', () => {
    const estado = rule.evaluar(
      franja,
      crearContexto({
        bloqueosActivos: [{ startTime: '10:00', endTime: '11:00' }],
      }),
    );

    expect(estado).toBeNull();
  });
});
