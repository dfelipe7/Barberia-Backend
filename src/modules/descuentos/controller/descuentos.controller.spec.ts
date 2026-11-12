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
    evaluarDescuentoProducto: jest.fn(),
    evaluarDescuentoServicio: jest.fn(),
  };
  const controller = new DescuentosController(
    facade as unknown as DescuentosFacade,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('HE-10-HU-05 — evaluación de descuentos aplicables', () => {
    it('evaluarProducto: delega en la fachada y devuelve el resultado', async () => {
      const respuesta = {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: 10,
        nombreElemento: 'Cera',
        aplica: true,
        diaEvaluado: WeekDay.MONDAY,
        zonaHoraria: 'America/Bogota',
        porcentajeAplicado: 10,
        precioOriginal: 100,
        precioFinal: 90,
        descuento: null,
        mensaje: 'Descuento aplicable para el día evaluado',
      };
      facade.evaluarDescuentoProducto.mockResolvedValue(respuesta);

      await expect(controller.evaluarProducto(10)).resolves.toBe(respuesta);
      expect(facade.evaluarDescuentoProducto).toHaveBeenCalledWith(10);
    });

    it('evaluarProducto: rechaza id menor o igual a 0 con BadRequestException', () => {
      expect(() => controller.evaluarProducto(0)).toThrow(BadRequestException);
      expect(facade.evaluarDescuentoProducto).not.toHaveBeenCalled();
    });

    it('evaluarServicio: delega en la fachada con o sin fecha', async () => {
      const respuesta = {
        tipo: TipoDescuento.SERVICIO,
        elementoId: 20,
        nombreElemento: 'Corte',
        aplica: false,
        diaEvaluado: null,
        zonaHoraria: 'America/Bogota',
        porcentajeAplicado: null,
        precioOriginal: 25000,
        precioFinal: null,
        descuento: null,
        mensaje: 'Indique la fecha de la cita para calcular el precio',
      };
      facade.evaluarDescuentoServicio.mockResolvedValue(respuesta);

      await expect(controller.evaluarServicio(20, '2026-11-13')).resolves.toBe(
        respuesta,
      );
      expect(facade.evaluarDescuentoServicio).toHaveBeenCalledWith(
        20,
        '2026-11-13',
      );
    });

    it('evaluarServicio: rechaza id menor o igual a 0 con BadRequestException', () => {
      expect(() => controller.evaluarServicio(-1)).toThrow(BadRequestException);
      expect(facade.evaluarDescuentoServicio).not.toHaveBeenCalled();
    });
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
