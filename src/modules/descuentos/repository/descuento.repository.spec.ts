import { ConflictException, NotFoundException } from '@nestjs/common';
import { TipoDescuento, WeekDay } from '../../../../generated/prisma/enums';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { DescuentoRepository } from './descuento.repository';

describe('DescuentoRepository', () => {
  const prisma = {
    descuento: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const aislamiento = {
    filtroLectura: jest.fn((where: object) => ({ negocioId: 7, ...where })),
    filtroEscritura: jest.fn((where: object) => ({ negocioId: 7, ...where })),
    negocioIdRequerido: jest.fn(() => 7),
  };
  const repository = new DescuentoRepository(
    prisma as unknown as PrismaService,
    aislamiento as unknown as NegocioAislamientoService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('HE-10-HU-03-CA-01: obtiene un descuento por id acotado al negocio con relaciones', async () => {
    prisma.descuento.findFirst.mockResolvedValue(null);

    await repository.obtenerPorId(12);

    expect(aislamiento.filtroLectura).toHaveBeenCalledWith({ id: 12 });
    expect(prisma.descuento.findFirst).toHaveBeenCalledWith({
      where: { negocioId: 7, id: 12 },
      include: {
        producto: { select: { id: true, nombre: true } },
        servicio: { select: { id: true, nombre: true } },
      },
    });
  });

  it('HE-10-HU-03-CA-02: actualiza porcentaje y días dentro del negocio', async () => {
    const actualizado = {
      id: 12,
      porcentaje: 15,
      diasSemana: [WeekDay.FRIDAY],
    };
    prisma.descuento.update.mockResolvedValue(actualizado);

    const resultado = await repository.actualizar(12, {
      porcentaje: 15,
      diasSemana: [WeekDay.FRIDAY],
    });

    expect(aislamiento.filtroEscritura).toHaveBeenCalledWith({ id: 12 });
    expect(prisma.descuento.update).toHaveBeenCalledWith({
      where: { negocioId: 7, id: 12 },
      data: { porcentaje: 15, diasSemana: [WeekDay.FRIDAY] },
      include: {
        producto: { select: { id: true, nombre: true } },
        servicio: { select: { id: true, nombre: true } },
      },
    });
    expect(resultado).toBe(actualizado);
  });

  it('HE-10-HU-03-CA-02: lanza NotFoundException si Prisma reporta P2025 al actualizar', async () => {
    prisma.descuento.update.mockRejectedValue({ code: 'P2025' });

    await expect(
      repository.actualizar(12, { porcentaje: 15 }),
    ).rejects.toBeInstanceOf(NotFoundException);
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
