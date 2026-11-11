import { TipoDescuento, WeekDay } from '../../../../generated/prisma/enums';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { DescuentoService } from '../service/descuento.service';
import { DescuentosFacade } from './descuentos.facade';

describe('DescuentosFacade', () => {
  const descuentoService = { crear: jest.fn() };
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
  });

  it('exige contexto de negocio y delega la creación en el servicio', async () => {
    await expect(facade.crear(dto)).resolves.toEqual({
      mensaje: 'Descuento creado correctamente',
      descuento,
    });

    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(descuentoService.crear).toHaveBeenCalledWith(dto);
  });

  it('propaga el error del servicio sin ocultarlo', async () => {
    const error = new Error('conflicto');
    descuentoService.crear.mockRejectedValue(error);

    await expect(facade.crear(dto)).rejects.toBe(error);
  });
});
