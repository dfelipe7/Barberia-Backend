import { TipoDescuento, WeekDay } from '../../../../generated/prisma/enums';
import { DescuentosController } from './descuentos.controller';
import { DescuentosFacade } from '../facade/descuentos.facade';

describe('DescuentosController', () => {
  const facade = { crear: jest.fn() };
  const controller = new DescuentosController(
    facade as unknown as DescuentosFacade,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delega la creación en la fachada sin reglas de negocio', async () => {
    const dto = {
      tipo: TipoDescuento.PRODUCTO,
      elementoId: 10,
      porcentaje: 10.25,
      diasSemana: [WeekDay.MONDAY],
    };
    const respuesta = { mensaje: 'Descuento creado correctamente' };
    facade.crear.mockResolvedValue(respuesta);

    await expect(controller.crear(dto)).resolves.toBe(respuesta);
    expect(facade.crear).toHaveBeenCalledWith(dto);
  });
});
