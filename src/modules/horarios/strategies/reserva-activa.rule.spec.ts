import { ReservaActivaRule } from './reserva-activa.rule';
import { EstadoFranja } from '../common/estado-franja';
import { ReservasNoDisponiblesError } from '../ports/proveedor-reservas-activas.port';
import type { ContextoDisponibilidad } from './regla-disponibilidad.strategy';
import type { FranjaHorario } from '../factory/franja.factory';

describe('ReservaActivaRule', () => {
  const franja: FranjaHorario = { startTime: '09:00', endTime: '10:00' };

  const contexto: ContextoDisponibilidad = {
    barberoId: 7,
    fecha: '2026-10-20',
    diaSemana: 'TUESDAY',
    franjasHorario: [{ startTime: '09:00' }],
    bloqueosActivos: [],
    cierresActivos: [],
  };

  const crearRule = (existe: boolean | Error) => {
    const proveedor = {
      existeReservaNoCanceladaEnFranja: jest.fn(() =>
        existe instanceof Error
          ? Promise.reject(existe)
          : Promise.resolve(existe),
      ),
    };
    return { proveedor, rule: new ReservaActivaRule(proveedor) };
  };

  it('debe tener la última prioridad', () => {
    const { rule } = crearRule(false);
    expect(rule.orden).toBe(40);
  });

  it('devuelve RESERVED cuando la franja contiene una reserva no cancelada', async () => {
    const { rule, proveedor } = crearRule(true);

    const estado = await rule.evaluar(franja, contexto);

    expect(estado).toBe(EstadoFranja.RESERVED);
    expect(proveedor.existeReservaNoCanceladaEnFranja).toHaveBeenCalledWith({
      barberoId: 7,
      fecha: '2026-10-20',
      startTime: '09:00',
      endTime: '10:00',
    });
  });

  it('devuelve null cuando no hay reserva', async () => {
    const { rule } = crearRule(false);

    expect(await rule.evaluar(franja, contexto)).toBeNull();
  });

  it('propaga ReservasNoDisponiblesError sin capturarla (fail-closed)', async () => {
    const { rule } = crearRule(new ReservasNoDisponiblesError());

    await expect(rule.evaluar(franja, contexto)).rejects.toThrow(
      ReservasNoDisponiblesError,
    );
  });
});
