import { BadRequestException } from '@nestjs/common';
import { TipoDescuento, WeekDay } from '../../../../generated/prisma/enums';
import { DescuentosController } from './descuentos.controller';
import { DescuentosFacade } from '../facade/descuentos.facade';

describe('DescuentosController', () => {
  const facade = {
    crear: jest.fn(),
    obtenerPorId: jest.fn(),
    actualizar: jest.fn(),
  };
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

  it('HE-10-HU-03-CA-01: delega la consulta por id en la fachada', async () => {
    const respuesta = { id: 5, porcentaje: 15 };
    facade.obtenerPorId.mockResolvedValue(respuesta);

    await expect(controller.obtenerPorId(5)).resolves.toBe(respuesta);
    expect(facade.obtenerPorId).toHaveBeenCalledWith(5);
  });

  it('rechaza un id no positivo al consultar', () => {
    expect(() => controller.obtenerPorId(0)).toThrow(BadRequestException);
    expect(facade.obtenerPorId).not.toHaveBeenCalled();
  });

  it('HE-10-HU-03-CA-02: delega la actualización en la fachada', async () => {
    const dto = { porcentaje: 20 };
    const respuesta = { mensaje: 'Descuento actualizado correctamente' };
    facade.actualizar.mockResolvedValue(respuesta);

    await expect(controller.actualizar(5, dto)).resolves.toBe(respuesta);
    expect(facade.actualizar).toHaveBeenCalledWith(5, dto);
  });

  it('rechaza un id no positivo al actualizar', () => {
    expect(() => controller.actualizar(-1, { porcentaje: 20 })).toThrow(
      BadRequestException,
    );
    expect(facade.actualizar).not.toHaveBeenCalled();
  });
});
