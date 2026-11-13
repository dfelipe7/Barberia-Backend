import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EstadoProducto } from '../../../../generated/prisma/enums';
import { DescuentosFacade } from '../../descuentos/facade/descuentos.facade';
import {
  MENSAJE_NOMBRE_DUPLICADO,
  MENSAJE_PRODUCTO_INACTIVO_DUPLICADO,
} from '../productos.constants';
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
    listarCatalogo: jest.fn(),
    obtenerDisponiblePorId: jest.fn(),
    obtenerPorId: jest.fn(),
    actualizarEstadoSiDifiere: jest.fn(),
  };
  const descuentosFacade = {
    evaluarBatch: jest.fn(),
    evaluarDescuentoProducto: jest.fn(),
  };
  const service = new ProductoService(
    repository as unknown as ProductoRepository,
    descuentosFacade as unknown as DescuentosFacade,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repository.buscarPorNombre.mockResolvedValue(null);
    descuentosFacade.evaluarBatch.mockResolvedValue({
      productos: [],
      servicios: [],
    });
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

    it('rechaza un nombre duplicado activo en el negocio con mensaje estándar', async () => {
      repository.buscarPorNombre.mockResolvedValue({
        id: 1,
        estado: EstadoProducto.ACTIVO,
      });

      await expect(
        service.validarRegistro({ nombre: 'Cera', precio: 10 }),
      ).rejects.toThrow(new ConflictException(MENSAJE_NOMBRE_DUPLICADO));
    });

    it('rechaza un nombre duplicado inactivo en el negocio con mensaje específico (P7)', async () => {
      repository.buscarPorNombre.mockResolvedValue({
        id: 1,
        estado: EstadoProducto.INACTIVO,
      });

      await expect(
        service.validarRegistro({ nombre: 'Cera', precio: 10 }),
      ).rejects.toThrow(
        new ConflictException(MENSAJE_PRODUCTO_INACTIVO_DUPLICADO),
      );
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

    it('lista activos e inactivos y los mapea enriqueciendo con descuentos (P1)', async () => {
      repository.listar.mockResolvedValue([activo, inactivo]);
      descuentosFacade.evaluarBatch.mockResolvedValue({
        productos: [
          {
            tipo: 'PRODUCTO',
            elementoId: 1,
            nombreElemento: 'Cera',
            estado: 'APLICADO',
            aplica: true,
            precioOriginal: 35000.5,
            precioFinal: 31500.45,
            descuento: {
              id: 1,
              activo: true,
              porcentaje: 10,
              diasSemana: ['MONDAY'],
            },
          },
          {
            tipo: 'PRODUCTO',
            elementoId: 2,
            nombreElemento: 'Gel',
            estado: 'INACTIVO',
            aplica: false,
            precioOriginal: 20000,
            precioFinal: 20000,
            descuento: null,
          },
        ],
        servicios: [],
      });

      await expect(service.listar()).resolves.toEqual({
        productos: [
          expect.objectContaining({
            id: 1,
            estado: 'ACTIVO',
            precioOriginal: 35000.5,
            precioFinal: 31500.45,
            descuentoAplicable: expect.objectContaining({ estado: 'APLICADO' }),
          }),
          expect.objectContaining({
            id: 2,
            estado: 'INACTIVO',
            precioOriginal: 35000.5,
            precioFinal: 35000.5,
            descuentoAplicable: expect.objectContaining({ estado: 'INACTIVO' }),
          }),
        ],
      });
      expect(descuentosFacade.evaluarBatch).toHaveBeenCalledWith({
        productoIds: [1, 2],
      });
    });

    it('devuelve colección vacía y mensaje cuando no hay productos', async () => {
      repository.listar.mockResolvedValue([]);

      await expect(service.listar()).resolves.toEqual({
        mensaje: 'No existen productos registrados',
        productos: [],
      });
    });

    it('devuelve el detalle completo del producto enriquecido con descuento (P1)', async () => {
      repository.obtenerPorId.mockResolvedValue(activo);
      descuentosFacade.evaluarDescuentoProducto.mockResolvedValue({
        tipo: 'PRODUCTO',
        elementoId: 1,
        nombreElemento: 'Cera',
        estado: 'APLICADO',
        aplica: true,
        precioOriginal: 35000.5,
        precioFinal: 31500.45,
        descuento: {
          id: 1,
          activo: true,
          porcentaje: 10,
          diasSemana: ['MONDAY'],
        },
      });

      await expect(service.obtenerPorId(1)).resolves.toMatchObject({
        id: 1,
        nombre: 'Cera',
        descripcion: 'Mate',
        precio: 35000.5,
        precioOriginal: 35000.5,
        precioFinal: 31500.45,
        descuentoAplicable: expect.objectContaining({ estado: 'APLICADO' }),
        imagenUrl: '/uploads/negocios/7/productos/cera.png',
        estado: 'ACTIVO',
      });
      expect(descuentosFacade.evaluarDescuentoProducto).toHaveBeenCalledWith(
        1,
        true,
      );
    });

    it('oculta como 404 un producto inexistente o de otro negocio', async () => {
      repository.obtenerPorId.mockResolvedValue(null);

      await expect(service.obtenerPorId(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('catálogo público', () => {
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

    it('devuelve solo los datos comerciales del catálogo', async () => {
      repository.listarCatalogo.mockResolvedValue([activo]);
      descuentosFacade.evaluarBatch.mockResolvedValue({
        productos: [
          {
            tipo: 'PRODUCTO',
            elementoId: 1,
            nombreElemento: 'Cera',
            estado: 'SIN_DESCUENTO',
            aplica: false,
            precioOriginal: 35000.5,
            precioFinal: 35000.5,
            descuento: null,
          },
        ],
        servicios: [],
      });

      const respuesta = await service.listarCatalogo();

      expect(respuesta.productos).toEqual([
        {
          id: 1,
          nombre: 'Cera',
          descripcion: 'Mate',
          precio: 35000.5,
          precioOriginal: 35000.5,
          precioFinal: 35000.5,
          descuentoAplicable: null,
          imagenUrl: '/uploads/negocios/7/productos/cera.png',
        },
      ]);
      expect(respuesta.productos[0]).not.toHaveProperty('estado');
      expect(respuesta.productos[0]).not.toHaveProperty('creadoEn');
    });

    it('catálogo con 3 productos (1 con descuento APLICADO, 1 INACTIVO, 1 SIN_DESCUENTO) devuelve precioFinal correcto (P1)', async () => {
      const p1 = {
        id: 1,
        nombre: 'Cera',
        descripcion: null,
        precio: 100,
        imagenUrl: null,
        estado: 'ACTIVO',
      };
      const p2 = {
        id: 2,
        nombre: 'Gel',
        descripcion: null,
        precio: 50,
        imagenUrl: null,
        estado: 'ACTIVO',
      };
      const p3 = {
        id: 3,
        nombre: 'Peine',
        descripcion: null,
        precio: 30,
        imagenUrl: null,
        estado: 'ACTIVO',
      };

      repository.listarCatalogo.mockResolvedValue([p1, p2, p3]);
      descuentosFacade.evaluarBatch.mockResolvedValue({
        productos: [
          {
            tipo: 'PRODUCTO',
            elementoId: 1,
            nombreElemento: 'Cera',
            estado: 'APLICADO',
            aplica: true,
            precioOriginal: 100,
            precioFinal: 90,
            descuento: {
              id: 10,
              activo: true,
              porcentaje: 10,
              diasSemana: ['MONDAY'],
            },
          },
          {
            tipo: 'PRODUCTO',
            elementoId: 2,
            nombreElemento: 'Gel',
            estado: 'INACTIVO',
            aplica: false,
            precioOriginal: 50,
            precioFinal: 50,
            descuento: {
              id: 11,
              activo: false,
              porcentaje: 20,
              diasSemana: ['MONDAY'],
            },
          },
          {
            tipo: 'PRODUCTO',
            elementoId: 3,
            nombreElemento: 'Peine',
            estado: 'SIN_DESCUENTO',
            aplica: false,
            precioOriginal: 30,
            precioFinal: 30,
            descuento: null,
          },
        ],
        servicios: [],
      });

      const respuesta = await service.listarCatalogo();

      expect(descuentosFacade.evaluarBatch).toHaveBeenCalledWith({
        productoIds: [1, 2, 3],
      });
      expect(respuesta.productos).toHaveLength(3);

      // Producto 1: APLICADO -> precioFinal: 90
      expect(respuesta.productos[0].id).toBe(1);
      expect(respuesta.productos[0].precioOriginal).toBe(100);
      expect(respuesta.productos[0].precioFinal).toBe(90);
      expect(respuesta.productos[0].descuentoAplicable?.estado).toBe(
        'APLICADO',
      );

      // Producto 2: INACTIVO -> precioFinal: 50 (precioOriginal)
      expect(respuesta.productos[1].id).toBe(2);
      expect(respuesta.productos[1].precioOriginal).toBe(50);
      expect(respuesta.productos[1].precioFinal).toBe(50);
      expect(respuesta.productos[1].descuentoAplicable?.estado).toBe(
        'INACTIVO',
      );

      // Producto 3: SIN_DESCUENTO -> precioFinal: 30, descuentoAplicable: null
      expect(respuesta.productos[2].id).toBe(3);
      expect(respuesta.productos[2].precioOriginal).toBe(30);
      expect(respuesta.productos[2].precioFinal).toBe(30);
      expect(respuesta.productos[2].descuentoAplicable).toBeNull();
    });

    it('responde colección vacía con mensaje si no hay productos activos', async () => {
      repository.listarCatalogo.mockResolvedValue([]);

      await expect(service.listarCatalogo()).resolves.toEqual({
        mensaje: 'No hay productos disponibles en este momento',
        productos: [],
      });
    });

    it('devuelve el detalle público de un producto activo enriquecido con descuento (P1)', async () => {
      repository.obtenerDisponiblePorId.mockResolvedValue(activo);
      descuentosFacade.evaluarDescuentoProducto.mockResolvedValue({
        tipo: 'PRODUCTO',
        elementoId: 1,
        nombreElemento: 'Cera',
        estado: 'APLICADO',
        aplica: true,
        precioOriginal: 35000.5,
        precioFinal: 31500.45,
        descuento: {
          id: 1,
          activo: true,
          porcentaje: 10,
          diasSemana: ['MONDAY'],
        },
      });

      await expect(service.obtenerCatalogoPorId(1)).resolves.toEqual({
        id: 1,
        nombre: 'Cera',
        descripcion: 'Mate',
        precio: 35000.5,
        precioOriginal: 35000.5,
        precioFinal: 31500.45,
        descuentoAplicable: expect.objectContaining({ estado: 'APLICADO' }),
        imagenUrl: '/uploads/negocios/7/productos/cera.png',
      });
      expect(descuentosFacade.evaluarDescuentoProducto).toHaveBeenCalledWith(1);
    });

    it('oculta como 404 un producto inactivo, inexistente o ajeno', async () => {
      repository.obtenerDisponiblePorId.mockResolvedValue(null);

      await expect(service.obtenerCatalogoPorId(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cambiarEstadoProducto', () => {
    const actual = {
      id: 1,
      nombre: 'Cera',
      descripcion: null,
      precio: 10000,
      imagenUrl: null,
      estado: 'ACTIVO',
      creadoEn: new Date('2026-11-04T12:00:00Z'),
      actualizadoEn: new Date('2026-11-04T12:00:00Z'),
    };

    it('cambia el estado y responde con el producto actualizado', async () => {
      const inactivo = { ...actual, estado: 'INACTIVO' };
      repository.actualizarEstadoSiDifiere.mockResolvedValue({ count: 1 });
      repository.obtenerPorId.mockResolvedValue(inactivo);

      await expect(
        service.cambiarEstadoProducto(1, { estado: 'INACTIVO' }),
      ).resolves.toMatchObject({
        mensaje: 'Estado del producto actualizado correctamente',
        producto: { id: 1, estado: 'INACTIVO' },
      });
      expect(repository.actualizarEstadoSiDifiere).toHaveBeenCalledWith(
        1,
        'INACTIVO',
      );
    });

    it('repetir el mismo estado no reescribe la fila', async () => {
      repository.actualizarEstadoSiDifiere.mockResolvedValue({ count: 0 });
      repository.obtenerPorId.mockResolvedValue(actual);

      await expect(
        service.cambiarEstadoProducto(1, { estado: 'ACTIVO' }),
      ).resolves.toMatchObject({
        producto: { id: 1, estado: 'ACTIVO' },
      });
      expect(repository.actualizarEstadoSiDifiere).toHaveBeenCalledWith(
        1,
        'ACTIVO',
      );
    });

    it('oculta como 404 un producto inexistente o de otro negocio', async () => {
      repository.actualizarEstadoSiDifiere.mockResolvedValue({ count: 0 });
      repository.obtenerPorId.mockResolvedValue(null);

      await expect(
        service.cambiarEstadoProducto(99, { estado: 'INACTIVO' }),
      ).rejects.toBeInstanceOf(NotFoundException);
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

  describe('validarActualizacion', () => {
    const actual = {
      id: 1,
      nombre: 'Cera',
      descripcion: 'Mate',
      precio: 35000,
      imagenUrl: '/uploads/negocios/7/productos/cera.png',
    };

    beforeEach(() => {
      repository.obtenerPorId.mockResolvedValue(actual);
    });

    it('rechaza una edición sin campos ni imagen', async () => {
      await expect(
        service.validarActualizacion(1, {}, false),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('oculta como 404 un producto inexistente o de otro negocio', async () => {
      repository.obtenerPorId.mockResolvedValue(null);

      await expect(
        service.validarActualizacion(99, { nombre: 'Otra' }, false),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('devuelve solo los campos enviados y limpia la descripción vacía', async () => {
      const resultado = await service.validarActualizacion(
        1,
        { descripcion: '   ', precio: 10.5 },
        false,
      );

      expect(resultado.actual).toBe(actual);
      expect(resultado.cambios).toEqual({
        descripcion: null,
        precio: 10.5,
      });
    });

    it('acepta null para limpiar la descripción', async () => {
      const resultado = await service.validarActualizacion(
        1,
        { descripcion: null },
        false,
      );

      expect(resultado.cambios).toEqual({ descripcion: null });
    });

    it('no incluye el nombre si no cambió', async () => {
      const resultado = await service.validarActualizacion(
        1,
        { nombre: '  Cera  ' },
        false,
      );

      expect(resultado.cambios).toEqual({});
    });

    it('no agrega cambios cuando nombre, descripción y precio son iguales al producto actual', async () => {
      const resultado = await service.validarActualizacion(
        1,
        { nombre: '  Cera  ', descripcion: '  Mate  ', precio: 35000 },
        false,
      );

      expect(resultado.cambios).toEqual({});
    });

    it('no agrega descripción cuando solo difiere en whitespace', async () => {
      const resultado = await service.validarActualizacion(
        1,
        { descripcion: '  Mate  ' },
        false,
      );

      expect(resultado.cambios).toEqual({});
    });

    it('no agrega precio cuando el valor numérico es igual, aunque llegue como string', async () => {
      const resultado = await service.validarActualizacion(
        1,
        { precio: '35000' as unknown as number },
        false,
      );

      expect(resultado.cambios).toEqual({});
    });

    it('no agrega descripción cuando null se compara con null', async () => {
      repository.obtenerPorId.mockResolvedValue({
        ...actual,
        descripcion: null,
      });

      const resultado = await service.validarActualizacion(
        1,
        { descripcion: null },
        false,
      );

      expect(resultado.cambios).toEqual({});
    });

    it.each(['', '   '])(
      'no agrega descripción cuando %p se compara con null',
      async (descripcion) => {
        repository.obtenerPorId.mockResolvedValue({
          ...actual,
          descripcion: null,
        });

        const resultado = await service.validarActualizacion(
          1,
          { descripcion },
          false,
        );

        expect(resultado.cambios).toEqual({});
      },
    );

    it('sí agrega descripción cuando el valor normalizado difiere', async () => {
      const resultado = await service.validarActualizacion(
        1,
        { descripcion: '  Brillante  ' },
        false,
      );

      expect(resultado.cambios).toEqual({ descripcion: 'Brillante' });
    });

    it('sí agrega precio cuando el valor numérico difiere', async () => {
      const resultado = await service.validarActualizacion(
        1,
        { precio: 35000.5 },
        false,
      );

      expect(resultado.cambios).toEqual({ precio: 35000.5 });
    });

    it('rechaza un nombre duplicado activo de otro producto con mensaje estándar', async () => {
      repository.buscarPorNombre.mockResolvedValue({
        id: 2,
        estado: EstadoProducto.ACTIVO,
      });

      await expect(
        service.validarActualizacion(1, { nombre: 'Aceite' }, false),
      ).rejects.toThrow(new ConflictException(MENSAJE_NOMBRE_DUPLICADO));
    });

    it('rechaza un nombre duplicado inactivo de otro producto con mensaje específico (P7)', async () => {
      repository.buscarPorNombre.mockResolvedValue({
        id: 2,
        estado: EstadoProducto.INACTIVO,
      });

      await expect(
        service.validarActualizacion(1, { nombre: 'Aceite' }, false),
      ).rejects.toThrow(
        new ConflictException(MENSAJE_PRODUCTO_INACTIVO_DUPLICADO),
      );
    });

    it('rechaza nombre vacío y precio inválido', async () => {
      await expect(
        service.validarActualizacion(1, { nombre: '   ' }, false),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.validarActualizacion(1, { precio: 0 }, false),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
