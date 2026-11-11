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
});
