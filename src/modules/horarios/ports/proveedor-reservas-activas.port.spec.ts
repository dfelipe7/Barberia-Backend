import {
  ProveedorReservasActivasNoDisponible,
  ReservasNoDisponiblesError,
} from './proveedor-reservas-activas.port';

describe('ProveedorReservasActivasNoDisponible', () => {
  it('debe fallar cerrado con ReservasNoDisponiblesError en una franja con fecha', async () => {
    const proveedor = new ProveedorReservasActivasNoDisponible();

    await expect(
      proveedor.existeReservaNoCanceladaEnFranja(),
    ).rejects.toBeInstanceOf(ReservasNoDisponiblesError);
  });

  it('debe fallar cerrado con ReservasNoDisponiblesError en una franja semanal', async () => {
    const proveedor = new ProveedorReservasActivasNoDisponible();

    await expect(
      proveedor.existeReservaNoCanceladaEnFranjaSemanal(),
    ).rejects.toBeInstanceOf(ReservasNoDisponiblesError);
  });
});
