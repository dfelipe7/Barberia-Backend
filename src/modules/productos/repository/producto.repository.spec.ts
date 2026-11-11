import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductoRepository } from './producto.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { EstadoProducto } from '../../../../generated/prisma/enums';

describe('ProductoRepository', () => {
  const prisma = {
    producto: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
  };
  const aislamiento = {
    filtroLectura: jest.fn((where: object) => ({ negocioId: 7, ...where })),
    filtroEscritura: jest.fn((where: object) => ({ negocioId: 7, ...where })),
    negocioIdRequerido: jest.fn(() => 7),
  };
  const repository = new ProductoRepository(
    prisma as unknown as PrismaService,
    aislamiento as unknown as NegocioAislamientoService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('busca el nombre dentro del negocio del contexto', async () => {
    prisma.producto.findFirst.mockResolvedValue(null);

    await repository.buscarPorNombre('Cera');

    expect(aislamiento.filtroLectura).toHaveBeenCalledWith({ nombre: 'Cera' });
    expect(prisma.producto.findFirst).toHaveBeenCalledWith({
      where: { negocioId: 7, nombre: 'Cera' },
    });
  });

  it('lista solo el negocio del contexto con orden estable', async () => {
    prisma.producto.findMany.mockResolvedValue([]);

    await repository.listar();

    expect(aislamiento.filtroLectura).toHaveBeenCalledWith();
    expect(prisma.producto.findMany).toHaveBeenCalledWith({
      where: { negocioId: 7 },
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
    });
  });

  it('lista el catálogo público solo con productos ACTIVO y orden estable', async () => {
    prisma.producto.findMany.mockResolvedValue([]);

    await repository.listarCatalogo();

    expect(aislamiento.filtroLectura).toHaveBeenCalledWith({
      estado: EstadoProducto.ACTIVO,
    });
    expect(prisma.producto.findMany).toHaveBeenCalledWith({
      where: { negocioId: 7, estado: EstadoProducto.ACTIVO },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
  });

  it('obtiene el detalle público solo si es ACTIVO y del negocio', async () => {
    prisma.producto.findFirst.mockResolvedValue(null);

    await repository.obtenerDisponiblePorId(3);

    expect(aislamiento.filtroLectura).toHaveBeenCalledWith({
      id: 3,
      estado: EstadoProducto.ACTIVO,
    });
    expect(prisma.producto.findFirst).toHaveBeenCalledWith({
      where: { negocioId: 7, id: 3, estado: EstadoProducto.ACTIVO },
    });
  });

  it('obtiene el detalle filtrando por id y negocio en la misma consulta', async () => {
    prisma.producto.findFirst.mockResolvedValue(null);

    await repository.obtenerPorId(3);

    expect(aislamiento.filtroLectura).toHaveBeenCalledWith({ id: 3 });
    expect(prisma.producto.findFirst).toHaveBeenCalledWith({
      where: { negocioId: 7, id: 3 },
    });
  });

  it('crea con el negocio del contexto y estado ACTIVO', async () => {
    prisma.producto.create.mockResolvedValue({ id: 1 });

    await repository.crear({
      nombre: 'Cera',
      descripcion: 'Mate',
      precio: 35000,
      imagenUrl: '/uploads/negocios/7/productos/producto-1.png',
    });

    expect(prisma.producto.create).toHaveBeenCalledWith({
      data: {
        nombre: 'Cera',
        descripcion: 'Mate',
        precio: 35000,
        imagenUrl: '/uploads/negocios/7/productos/producto-1.png',
        estado: EstadoProducto.ACTIVO,
        negocioId: 7,
      },
    });
  });

  it('traduce la violación de unicidad de la base de datos a 409', async () => {
    prisma.producto.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      repository.crear({
        nombre: 'Cera',
        precio: 1,
        imagenUrl: '/uploads/negocios/7/productos/producto-1.png',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('actualiza con el filtro de escritura del negocio', async () => {
    prisma.producto.update.mockResolvedValue({ id: 3 });

    await repository.actualizar(3, { nombre: 'Cera mate', precio: 10 });

    expect(aislamiento.filtroEscritura).toHaveBeenCalledWith({ id: 3 });
    expect(prisma.producto.update).toHaveBeenCalledWith({
      where: { negocioId: 7, id: 3 },
      data: { nombre: 'Cera mate', precio: 10 },
    });
  });

  it('traduce los errores de unicidad y de fila inexistente al actualizar', async () => {
    prisma.producto.update.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      repository.actualizar(3, { nombre: 'Cera' }),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.producto.update.mockRejectedValueOnce({ code: 'P2025' });
    await expect(
      repository.actualizar(3, { nombre: 'Cera' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('actualiza el estado solo si difiere y acota al negocio', async () => {
    prisma.producto.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      repository.actualizarEstadoSiDifiere(3, EstadoProducto.INACTIVO),
    ).resolves.toEqual({ count: 1 });

    expect(aislamiento.filtroEscritura).toHaveBeenCalledWith({
      id: 3,
      estado: { not: EstadoProducto.INACTIVO },
    });
    expect(prisma.producto.updateMany).toHaveBeenCalledWith({
      where: {
        id: 3,
        negocioId: 7,
        estado: { not: EstadoProducto.INACTIVO },
      },
      data: { estado: EstadoProducto.INACTIVO },
    });
  });

  it('devuelve count 0 cuando el estado ya coincide', async () => {
    prisma.producto.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.actualizarEstadoSiDifiere(3, EstadoProducto.INACTIVO),
    ).resolves.toEqual({ count: 0 });
  });

  it('detecta si otro producto del negocio comparte la imagen', async () => {
    prisma.producto.count.mockResolvedValue(1);

    await expect(
      repository.tieneOtraReferenciaAImagen(
        '/uploads/negocios/7/productos/cera.png',
        3,
      ),
    ).resolves.toBe(true);
    expect(prisma.producto.count).toHaveBeenCalledWith({
      where: {
        negocioId: 7,
        imagenUrl: '/uploads/negocios/7/productos/cera.png',
        id: { not: 3 },
      },
    });
  });
});
