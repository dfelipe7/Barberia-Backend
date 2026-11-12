import { TipoDescuento, WeekDay } from '../../../../generated/prisma/enums';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { DescuentoService } from '../service/descuento.service';
import { DescuentosFacade } from './descuentos.facade';

describe('DescuentosFacade', () => {
  const descuentoService = {
    crear: jest.fn(),
    obtenerPorId: jest.fn(),
    actualizar: jest.fn(),
  };
  const aislamiento = { negocioIdRequerido: jest.fn() };
  const facade = new DescuentosFacade(
    descuentoService as unknown as DescuentoService,
    aislamiento as unknown as NegocioAislamientoService,
  );

  const dto = {
    tipo: TipoDescuento.PRODUCTO,
    elementoId: 10,
    porcentaje: 10.25,
    diasSemana: [WeekDay.MONDAY],
  };
  const descuento = { id: 1, activo: false };

  beforeEach(() => {
    jest.clearAllMocks();
    aislamiento.negocioIdRequerido.mockReturnValue(7);
    descuentoService.crear.mockResolvedValue(descuento);
    descuentoService.obtenerPorId.mockResolvedValue(descuento);
    descuentoService.actualizar.mockResolvedValue(descuento);
  });

  it('exige contexto de negocio y delega la creación en el servicio', async () => {
    await expect(facade.crear(dto)).resolves.toEqual({
      mensaje: 'Descuento creado correctamente',
      descuento,
    });

    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(descuentoService.crear).toHaveBeenCalledWith(dto);
  });

  it('HE-10-HU-03-CA-01: exige contexto de negocio y delega la consulta por id', async () => {
    await expect(facade.obtenerPorId(1)).resolves.toEqual(descuento);

    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(descuentoService.obtenerPorId).toHaveBeenCalledWith(1);
  });

  it('HE-10-HU-03-CA-02: exige contexto de negocio y delega la actualización', async () => {
    const cambios = { porcentaje: 20 };
    await expect(facade.actualizar(1, cambios)).resolves.toEqual({
      mensaje: 'Descuento actualizado correctamente',
      descuento,
    });

    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(descuentoService.actualizar).toHaveBeenCalledWith(1, cambios);
  });

  it('propaga el error del servicio sin ocultarlo', async () => {
    const error = new Error('conflicto');
    descuentoService.crear.mockRejectedValue(error);

    await expect(facade.crear(dto)).rejects.toBe(error);
  });
});
