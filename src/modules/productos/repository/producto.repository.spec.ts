import { ConflictException } from '@nestjs/common';
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
    },
  };
  const aislamiento = {
    filtroLectura: jest.fn((where: object) => ({ negocioId: 7, ...where })),
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
});
