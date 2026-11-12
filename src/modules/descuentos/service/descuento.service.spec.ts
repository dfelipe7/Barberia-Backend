import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Descuento } from '../../../../generated/prisma/client';
import { TipoDescuento, WeekDay } from '../../../../generated/prisma/enums';
import { ProductoRepository } from '../../productos/repository/producto.repository';
import { ServiciosRepository } from '../../servicios/repository/servicios.repository';
import { DescuentoRepository } from '../repository/descuento.repository';
import { DescuentoService } from './descuento.service';

const descuentoBase = {
  id: 1,
  negocioId: 7,
  tipo: TipoDescuento.PRODUCTO,
  productoId: 10,
  servicioId: null,
  porcentaje: 10.25,
  diasSemana: [WeekDay.MONDAY, WeekDay.FRIDAY],
  activo: false,
  creadoEn: new Date('2026-11-11T12:00:00.000Z'),
  actualizadoEn: new Date('2026-11-11T12:00:00.000Z'),
} as unknown as Descuento;

describe('DescuentoService', () => {
  const descuentoRepository = {
    buscarPorElemento: jest.fn(),
    crear: jest.fn(),
    obtenerPorId: jest.fn(),
    actualizar: jest.fn(),
    cambiarEstado: jest.fn(),
  };
  const productoRepository = { obtenerPorId: jest.fn() };
  const serviciosRepository = { obtenerServicioPorId: jest.fn() };
  const service = new DescuentoService(
    descuentoRepository as unknown as DescuentoRepository,
    productoRepository as unknown as ProductoRepository,
    serviciosRepository as unknown as ServiciosRepository,
  );

  const dtoProducto = {
    tipo: TipoDescuento.PRODUCTO,
    elementoId: 10,
    porcentaje: 10.25,
    diasSemana: [WeekDay.FRIDAY, WeekDay.MONDAY, WeekDay.FRIDAY],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    descuentoRepository.buscarPorElemento.mockResolvedValue(null);
    descuentoRepository.crear.mockResolvedValue(descuentoBase);
    productoRepository.obtenerPorId.mockResolvedValue({
      id: 10,
      nombre: 'Cera',
    });
    serviciosRepository.obtenerServicioPorId.mockResolvedValue({
      id: 20,
      nombre: 'Corte',
    });
  });

  it('HE-10-HU-02-CA-02: crea el descuento de un producto y lo deja inactivo', async () => {
    const respuesta = await service.crear(dtoProducto);

    expect(productoRepository.obtenerPorId).toHaveBeenCalledWith(10);
    expect(descuentoRepository.crear).toHaveBeenCalledWith({
      tipo: TipoDescuento.PRODUCTO,
      productoId: 10,
      servicioId: null,
      porcentaje: 10.25,
      diasSemana: [WeekDay.MONDAY, WeekDay.FRIDAY],
    });
    expect(respuesta.activo).toBe(false);
    expect(respuesta.elemento).toEqual({ id: 10, nombre: 'Cera' });
  });

  it('HE-10-HU-02-CA-02: crea el descuento de un servicio', async () => {
    descuentoRepository.crear.mockResolvedValue({
      ...descuentoBase,
      tipo: TipoDescuento.SERVICIO,
      productoId: null,
      servicioId: 20,
    });

    const respuesta = await service.crear({
      tipo: TipoDescuento.SERVICIO,
      elementoId: 20,
      porcentaje: 5,
      diasSemana: [WeekDay.TUESDAY],
    });

    expect(serviciosRepository.obtenerServicioPorId).toHaveBeenCalledWith(20);
    expect(descuentoRepository.crear).toHaveBeenCalledWith({
      tipo: TipoDescuento.SERVICIO,
      productoId: null,
      servicioId: 20,
      porcentaje: 5,
      diasSemana: [WeekDay.TUESDAY],
    });
    expect(respuesta.elemento).toEqual({ id: 20, nombre: 'Corte' });
  });

  it.each([0, 100, -1, 10.251, Number.NaN, Number.POSITIVE_INFINITY])(
    'HE-10-HU-02-CA-03/CA-08: rechaza el porcentaje inválido %p',
    async (porcentaje) => {
      await expect(
        service.crear({ ...dtoProducto, porcentaje }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(descuentoRepository.crear).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['sin días', []],
    ['con un día inválido', ['FUNDAY' as WeekDay]],
  ])('HE-10-HU-02-CA-04: rechaza la creación %s', async (_caso, diasSemana) => {
    await expect(
      service.crear({ ...dtoProducto, diasSemana }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(descuentoRepository.crear).not.toHaveBeenCalled();
  });

  it('HE-10-HU-02-CA-05/CA-09: rechaza un segundo descuento aunque el existente esté inactivo', async () => {
    descuentoRepository.buscarPorElemento.mockResolvedValue({
      ...descuentoBase,
      activo: false,
    });

    await expect(service.crear(dtoProducto)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(descuentoRepository.crear).not.toHaveBeenCalled();
  });

  it('HE-10-HU-02-CA-01: un producto inexistente o de otro negocio responde 404', async () => {
    productoRepository.obtenerPorId.mockResolvedValue(null);

    await expect(service.crear(dtoProducto)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(descuentoRepository.crear).not.toHaveBeenCalled();
  });

  it('HE-10-HU-02-CA-01: un servicio inexistente o de otro negocio responde 404', async () => {
    serviciosRepository.obtenerServicioPorId.mockResolvedValue(null);

    await expect(
      service.crear({
        tipo: TipoDescuento.SERVICIO,
        elementoId: 20,
        porcentaje: 5,
        diasSemana: [WeekDay.TUESDAY],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(descuentoRepository.crear).not.toHaveBeenCalled();
  });

  it('HE-10-HU-02-CA-08: acepta los límites 1 y 99 con dos decimales', async () => {
    await service.crear({ ...dtoProducto, porcentaje: 1 });
    await service.crear({ ...dtoProducto, porcentaje: 99 });

    expect(descuentoRepository.crear).toHaveBeenCalledTimes(2);
  });

  describe('HE-10-HU-03: Modificar descuento existente', () => {
    const descuentoConElemento = {
      ...descuentoBase,
      producto: { id: 10, nombre: 'Cera' },
      servicio: null,
    };

    it('HE-10-HU-03-CA-01: carga la configuración de un descuento existente', async () => {
      descuentoRepository.obtenerPorId.mockResolvedValue(descuentoConElemento);

      const resultado = await service.obtenerPorId(1);

      expect(descuentoRepository.obtenerPorId).toHaveBeenCalledWith(1);
      expect(resultado).toEqual({
        id: 1,
        tipo: TipoDescuento.PRODUCTO,
        elemento: { id: 10, nombre: 'Cera' },
        porcentaje: 10.25,
        diasSemana: [WeekDay.MONDAY, WeekDay.FRIDAY],
        activo: false,
        creadoEn: descuentoBase.creadoEn,
        actualizadoEn: descuentoBase.actualizadoEn,
      });
    });

    it('HE-10-HU-03-CA-01: responde 404 si el descuento no existe o no pertenece al negocio', async () => {
      descuentoRepository.obtenerPorId.mockResolvedValue(null);

      await expect(service.obtenerPorId(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('HE-10-HU-03-CA-02: modifica porcentaje y días válidos conservando el mismo ID', async () => {
      const actualizado = {
        ...descuentoConElemento,
        porcentaje: 25,
        diasSemana: [WeekDay.WEDNESDAY],
      };
      descuentoRepository.actualizar.mockResolvedValue(actualizado);

      const resultado = await service.actualizar(1, {
        porcentaje: 25,
        diasSemana: [WeekDay.WEDNESDAY],
      });

      expect(descuentoRepository.actualizar).toHaveBeenCalledWith(1, {
        porcentaje: 25,
        diasSemana: [WeekDay.WEDNESDAY],
      });
      expect(resultado.porcentaje).toBe(25);
      expect(resultado.diasSemana).toEqual([WeekDay.WEDNESDAY]);
      expect(resultado.id).toBe(1);
    });

    it('HE-10-HU-03-CA-03: rechaza actualizar si no se envía ningún campo', async () => {
      await expect(service.actualizar(1, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(descuentoRepository.actualizar).not.toHaveBeenCalled();
    });

    it('HE-10-HU-03-CA-03: rechaza porcentaje inválido y conserva la configuración sin tocar repositorio', async () => {
      await expect(
        service.actualizar(1, { porcentaje: 10.251 }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(descuentoRepository.actualizar).not.toHaveBeenCalled();
    });

    it('HE-10-HU-03-CA-03: rechaza días vacíos o inválidos sin tocar repositorio', async () => {
      await expect(
        service.actualizar(1, { diasSemana: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(descuentoRepository.actualizar).not.toHaveBeenCalled();
    });
  });

  describe('HE-10-HU-04: Activar o desactivar un descuento', () => {
    const descuentoConElemento = {
      ...descuentoBase,
      activo: false,
      producto: { id: 10, nombre: 'Cera Fijadora' },
      servicio: null,
    };

    it('HE-10-HU-04-CA-02: activa un descuento inactivo con configuración válida', async () => {
      descuentoRepository.obtenerPorId.mockResolvedValue(descuentoConElemento);
      descuentoRepository.cambiarEstado.mockResolvedValue({
        ...descuentoConElemento,
        activo: true,
      });

      const resultado = await service.cambiarEstado(1, true);

      expect(descuentoRepository.obtenerPorId).toHaveBeenCalledWith(1);
      expect(descuentoRepository.cambiarEstado).toHaveBeenCalledWith(1, true);
      expect(resultado.activo).toBe(true);
      expect(resultado.porcentaje).toBe(10.25);
    });

    it('HE-10-HU-04-CA-01: desactiva un descuento activo conservando parámetros', async () => {
      descuentoRepository.obtenerPorId.mockResolvedValue({
        ...descuentoConElemento,
        activo: true,
      });
      descuentoRepository.cambiarEstado.mockResolvedValue({
        ...descuentoConElemento,
        activo: false,
      });

      const resultado = await service.cambiarEstado(1, false);

      expect(descuentoRepository.obtenerPorId).toHaveBeenCalledWith(1);
      expect(descuentoRepository.cambiarEstado).toHaveBeenCalledWith(1, false);
      expect(resultado.activo).toBe(false);
      expect(resultado.porcentaje).toBe(10.25);
      expect(resultado.diasSemana).toEqual(descuentoBase.diasSemana);
    });

    it('HE-10-HU-04-CA-03: es idempotente si se solicita el mismo estado actual', async () => {
      descuentoRepository.obtenerPorId.mockResolvedValue({
        ...descuentoConElemento,
        activo: true,
      });

      const resultado = await service.cambiarEstado(1, true);

      expect(descuentoRepository.obtenerPorId).toHaveBeenCalledWith(1);
      expect(descuentoRepository.cambiarEstado).not.toHaveBeenCalled();
      expect(resultado.activo).toBe(true);
    });

    it('HE-10-HU-04-CA-02: rechaza activar un descuento con configuración inválida', async () => {
      descuentoRepository.obtenerPorId.mockResolvedValue({
        ...descuentoConElemento,
        porcentaje: 0,
      });

      await expect(service.cambiarEstado(1, true)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(descuentoRepository.cambiarEstado).not.toHaveBeenCalled();
    });

    it('HE-10-HU-04-CA-04: lanza NotFoundException si el descuento no existe', async () => {
      descuentoRepository.obtenerPorId.mockResolvedValue(null);

      await expect(service.cambiarEstado(999, true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(descuentoRepository.cambiarEstado).not.toHaveBeenCalled();
    });
  });
});
