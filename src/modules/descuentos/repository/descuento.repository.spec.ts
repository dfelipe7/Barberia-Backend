import { ConflictException } from '@nestjs/common';
import { TipoDescuento, WeekDay } from '../../../../generated/prisma/enums';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { DescuentoRepository } from './descuento.repository';

describe('DescuentoRepository', () => {
  const prisma = {
    descuento: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
  const aislamiento = {
    filtroLectura: jest.fn((where: object) => ({ negocioId: 7, ...where })),
    negocioIdRequerido: jest.fn(() => 7),
  };
  const repository = new DescuentoRepository(
    prisma as unknown as PrismaService,
    aislamiento as unknown as NegocioAislamientoService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('busca un descuento de producto dentro del negocio del contexto', async () => {
    prisma.descuento.findFirst.mockResolvedValue(null);

    await repository.buscarPorElemento(TipoDescuento.PRODUCTO, 10);

    expect(aislamiento.filtroLectura).toHaveBeenCalledWith({ productoId: 10 });
    expect(prisma.descuento.findFirst).toHaveBeenCalledWith({
      where: { negocioId: 7, productoId: 10 },
    });
  });

  it('busca un descuento de servicio dentro del negocio del contexto', async () => {
    prisma.descuento.findFirst.mockResolvedValue(null);

    await repository.buscarPorElemento(TipoDescuento.SERVICIO, 20);

    expect(aislamiento.filtroLectura).toHaveBeenCalledWith({ servicioId: 20 });
    expect(prisma.descuento.findFirst).toHaveBeenCalledWith({
      where: { negocioId: 7, servicioId: 20 },
    });
  });

  it('crea con el negocio del contexto y activo en false', async () => {
    prisma.descuento.create.mockResolvedValue({ id: 1 });

    await repository.crear({
      tipo: TipoDescuento.PRODUCTO,
      productoId: 10,
      servicioId: null,
      porcentaje: 10.25,
      diasSemana: [WeekDay.MONDAY],
    });

    expect(prisma.descuento.create).toHaveBeenCalledWith({
      data: {
        negocioId: 7,
        tipo: TipoDescuento.PRODUCTO,
        productoId: 10,
        servicioId: null,
        porcentaje: 10.25,
        diasSemana: [WeekDay.MONDAY],
        activo: false,
      },
    });
  });

  it('traduce la violación de unicidad de la base de datos a 409', async () => {
    prisma.descuento.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      repository.crear({
        tipo: TipoDescuento.PRODUCTO,
        productoId: 10,
        servicioId: null,
        porcentaje: 10.25,
        diasSemana: [WeekDay.MONDAY],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
