import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProductoService } from './producto.service';
import { ProductoRepository } from '../repository/producto.repository';

const PNG_VALIDO = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
  Buffer.from('IHDR', 'latin1'),
  Buffer.from([0x00, 0x00, 0x00, 0x01]),
]);

const JPEG_VALIDO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00]);
const WEBP_VALIDO = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);

function archivo(contenido: Buffer): Express.Multer.File {
  return {
    buffer: contenido,
    size: contenido.length,
  } as Express.Multer.File;
}

describe('ProductoService', () => {
  const repository = {
    buscarPorNombre: jest.fn(),
    listar: jest.fn(),
    obtenerPorId: jest.fn(),
  };
  const service = new ProductoService(
    repository as unknown as ProductoRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repository.buscarPorNombre.mockResolvedValue(null);
  });

  describe('validarRegistro', () => {
    it('normaliza nombre y descripción y devuelve el precio numérico', async () => {
      await expect(
        service.validarRegistro({
          nombre: '  Cera mate  ',
          descripcion: '  Fijación fuerte  ',
          precio: 35000.5,
        }),
      ).resolves.toEqual({
        nombre: 'Cera mate',
        descripcion: 'Fijación fuerte',
        precio: 35000.5,
      });
    });

    it('convierte una descripción vacía en ausente', async () => {
      const datos = await service.validarRegistro({
        nombre: 'Cera',
        descripcion: '   ',
        precio: 1,
      });

      expect(datos.descripcion).toBeUndefined();
    });

    it('rechaza un nombre vacío', async () => {
      await expect(
        service.validarRegistro({ nombre: '   ', precio: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([0, -1, 100_000_000])(
      'rechaza el precio fuera de rango: %p',
      async (precio) => {
        await expect(
          service.validarRegistro({ nombre: 'Cera', precio }),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('rechaza más de dos decimales', async () => {
      await expect(
        service.validarRegistro({ nombre: 'Cera', precio: 10.999 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza un nombre duplicado en el negocio', async () => {
      repository.buscarPorNombre.mockResolvedValue({ id: 1 });

      await expect(
        service.validarRegistro({ nombre: 'Cera', precio: 10 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('validarImagen', () => {
    it('acepta ausencia de imagen devolviendo null', () => {
      expect(service.validarImagen(undefined)).toBeNull();
    });

    it('rechaza un archivo de imagen con buffer vacío', () => {
      expect(() => service.validarImagen(archivo(Buffer.alloc(0)))).toThrow(
        BadRequestException,
      );
    });

    it.each([
      ['png', PNG_VALIDO],
      ['jpeg', JPEG_VALIDO],
      ['webp', WEBP_VALIDO],
    ])('acepta %s y fija su extensión', (tipo, contenido) => {
      const imagen = service.validarImagen(archivo(contenido));

      expect(imagen).not.toBeNull();
      expect(imagen!.contenido).toEqual(contenido);
      expect(imagen!.extension).toBe(tipo === 'jpeg' ? 'jpg' : tipo);
    });

    it('rechaza un SVG, un HTML y un archivo que solo dice ser imagen', () => {
      expect(() =>
        service.validarImagen(
          archivo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
        ),
      ).toThrow(BadRequestException);

      expect(() =>
        service.validarImagen(
          archivo(Buffer.from('<html><script>alert(1)</script></html>')),
        ),
      ).toThrow(BadRequestException);
    });

    it('rechaza una imagen que supera el límite', () => {
      const grande = Buffer.concat([
        PNG_VALIDO,
        Buffer.alloc(5 * 1024 * 1024, 0x20),
      ]);

      expect(() => service.validarImagen(archivo(grande))).toThrow(
        BadRequestException,
      );
    });
  });

  describe('consultas administrativas', () => {
    const activo = {
      id: 1,
      nombre: 'Cera',
      descripcion: 'Mate',
      precio: 35000.5,
      imagenUrl: '/uploads/negocios/7/productos/cera.png',
      estado: 'ACTIVO',
      creadoEn: new Date('2026-11-04T12:00:00Z'),
      actualizadoEn: new Date('2026-11-04T12:00:00Z'),
    };
    const inactivo = {
      ...activo,
      id: 2,
      nombre: 'Aceite',
      descripcion: null,
      imagenUrl: null,
      estado: 'INACTIVO',
    };

    it('lista activos e inactivos y los mapea', async () => {
      repository.listar.mockResolvedValue([activo, inactivo]);

      await expect(service.listar()).resolves.toEqual({
        productos: [
          expect.objectContaining({ id: 1, estado: 'ACTIVO' }),
          expect.objectContaining({ id: 2, estado: 'INACTIVO' }),
        ],
      });
    });

    it('devuelve colección vacía y mensaje cuando no hay productos', async () => {
      repository.listar.mockResolvedValue([]);

      await expect(service.listar()).resolves.toEqual({
        mensaje: 'No existen productos registrados',
        productos: [],
      });
    });

    it('devuelve el detalle completo del producto', async () => {
      repository.obtenerPorId.mockResolvedValue(activo);

      await expect(service.obtenerPorId(1)).resolves.toMatchObject({
        id: 1,
        nombre: 'Cera',
        descripcion: 'Mate',
        precio: 35000.5,
        imagenUrl: '/uploads/negocios/7/productos/cera.png',
        estado: 'ACTIVO',
      });
    });

    it('oculta como 404 un producto inexistente o de otro negocio', async () => {
      repository.obtenerPorId.mockResolvedValue(null);

      await expect(service.obtenerPorId(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  it('mapea el producto y convierte el precio a número', () => {
    const producto = {
      id: 1,
      nombre: 'Cera',
      descripcion: null,
      precio: 35000.5,
      imagenUrl: '/uploads/negocios/1/productos/producto-1.png',
      estado: 'ACTIVO',
      creadoEn: new Date('2026-11-04T12:00:00Z'),
      actualizadoEn: new Date('2026-11-04T12:00:00Z'),
    };

    expect(service.mapear(producto as never)).toMatchObject({
      id: 1,
      precio: 35000.5,
      imagenUrl: '/uploads/negocios/1/productos/producto-1.png',
      estado: 'ACTIVO',
    });
  });
});
