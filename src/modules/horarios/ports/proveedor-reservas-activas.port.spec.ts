import {
  ProveedorReservasActivasNoDisponible,
  ReservasNoDisponiblesError,
} from './proveedor-reservas-activas.port';

describe('ProveedorReservasActivasNoDisponible', () => {
  it('debe fallar cerrado con ReservasNoDisponiblesError', async () => {
    const proveedor = new ProveedorReservasActivasNoDisponible();

    await expect(
      proveedor.existeReservaNoCanceladaEnFranja(),
    ).rejects.toBeInstanceOf(ReservasNoDisponiblesError);
  });
});
