import { BadRequestException } from '@nestjs/common';
import { TipoDescuento, WeekDay } from '../../../../generated/prisma/enums';
import { DescuentosController } from './descuentos.controller';
import { DescuentosFacade } from '../facade/descuentos.facade';

describe('DescuentosController', () => {
  const facade = {
    crear: jest.fn(),
    obtenerPorId: jest.fn(),
    actualizar: jest.fn(),
    cambiarEstado: jest.fn(),
    listar: jest.fn(),
  };
  const controller = new DescuentosController(
    facade as unknown as DescuentosFacade,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('HE-10-HU-01-CA-01: delega la consulta de lista en la fachada sin reglas de negocio', async () => {
    const respuesta = {
      mensaje: 'Descuentos consultados correctamente',
      descuentos: [],
      total: 0,
    };
    facade.listar.mockResolvedValue(respuesta);

    await expect(controller.listar()).resolves.toBe(respuesta);
    expect(facade.listar).toHaveBeenCalledWith();
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

  it('HE-10-HU-04-CA-03: delega el cambio de estado en la fachada', async () => {
    const dto = { activo: true };
    const respuesta = {
      mensaje: 'Descuento activado correctamente',
      descuento: { id: 5, activo: true },
    };
    facade.cambiarEstado.mockResolvedValue(respuesta);

    await expect(controller.cambiarEstado(5, dto)).resolves.toBe(respuesta);
    expect(facade.cambiarEstado).toHaveBeenCalledWith(5, dto);
  });

  it('HE-10-HU-04-CA-03: rechaza un id no positivo al cambiar estado', () => {
    expect(() => controller.cambiarEstado(0, { activo: true })).toThrow(
      BadRequestException,
    );
    expect(facade.cambiarEstado).not.toHaveBeenCalled();
  });
});
