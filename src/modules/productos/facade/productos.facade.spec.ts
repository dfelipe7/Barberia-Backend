import { ProductosFacade } from './productos.facade';
import { ProductoService } from '../service/producto.service';
import { AlmacenamientoProductosService } from '../service/almacenamiento-productos.service';
import { ProductoRepository } from '../repository/producto.repository';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';

describe('ProductosFacade', () => {
  const productoService = {
    validarRegistro: jest.fn(),
    validarActualizacion: jest.fn(),
    validarImagen: jest.fn(),
    mapear: jest.fn(),
    listar: jest.fn(),
    listarCatalogo: jest.fn(),
    obtenerCatalogoPorId: jest.fn(),
    obtenerPorId: jest.fn(),
    cambiarEstadoProducto: jest.fn(),
  };
  const almacenamiento = {
    guardar: jest.fn(),
    eliminar: jest.fn(),
  };
  const repository = {
    crear: jest.fn(),
    actualizar: jest.fn(),
    tieneOtraReferenciaAImagen: jest.fn(),
  };
  const aislamiento = { negocioIdRequerido: jest.fn() };
  const facade = new ProductosFacade(
    productoService as unknown as ProductoService,
    almacenamiento as unknown as AlmacenamientoProductosService,
    repository as unknown as ProductoRepository,
    aislamiento as unknown as NegocioAislamientoService,
  );

  const dto = { nombre: 'Cera', precio: 35000 };
  const archivo = { buffer: Buffer.from('imagen') } as Express.Multer.File;
  const producto = { id: 1, nombre: 'Cera' };

  beforeEach(() => {
    jest.clearAllMocks();
    aislamiento.negocioIdRequerido.mockReturnValue(7);
    productoService.validarRegistro.mockResolvedValue({
      nombre: 'Cera',
      precio: 35000,
    });
    productoService.validarImagen.mockReturnValue({
      contenido: Buffer.from('imagen'),
      extension: 'png',
    });
    almacenamiento.guardar.mockResolvedValue(
      '/uploads/negocios/7/productos/producto-1.png',
    );
    repository.crear.mockResolvedValue(producto);
    repository.actualizar.mockResolvedValue(producto);
    repository.tieneOtraReferenciaAImagen.mockResolvedValue(false);
    productoService.mapear.mockReturnValue({ id: 1, nombre: 'Cera' });
  });

  it('lista los productos del contexto a través del servicio', async () => {
    productoService.listar.mockResolvedValue({
      mensaje: 'No existen productos registrados',
      productos: [],
    });

    await expect(facade.listar()).resolves.toEqual({
      mensaje: 'No existen productos registrados',
      productos: [],
    });
    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(productoService.listar).toHaveBeenCalled();
  });

  it('lista el catálogo público del contexto a través del servicio', async () => {
    productoService.listarCatalogo.mockResolvedValue({ productos: [] });

    await expect(facade.listarCatalogo()).resolves.toEqual({ productos: [] });
    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(productoService.listarCatalogo).toHaveBeenCalled();
  });

  it('delega el detalle público en el servicio con el id recibido', async () => {
    productoService.obtenerCatalogoPorId.mockResolvedValue({ id: 1 });

    await expect(facade.obtenerCatalogoPorId(1)).resolves.toEqual({ id: 1 });
    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(productoService.obtenerCatalogoPorId).toHaveBeenCalledWith(1);
  });

  it('delega el detalle en el servicio con el id recibido', async () => {
    productoService.obtenerPorId.mockResolvedValue({ id: 1 });

    await expect(facade.obtenerPorId(1)).resolves.toEqual({ id: 1 });
    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(productoService.obtenerPorId).toHaveBeenCalledWith(1);
  });

  it('delega el cambio de estado en el servicio con el id y el dto', async () => {
    productoService.cambiarEstadoProducto.mockResolvedValue({ mensaje: 'ok' });

    await expect(
      facade.cambiarEstado(1, { estado: 'INACTIVO' }),
    ).resolves.toEqual({ mensaje: 'ok' });
    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(productoService.cambiarEstadoProducto).toHaveBeenCalledWith(1, 7, {
      estado: 'INACTIVO',
    });
  });

  it('camino 1: con archivo × persistencia exitosa (guarda imagen y no compensa)', async () => {
    const respuesta = await facade.registrar(dto, archivo);

    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(productoService.validarImagen).toHaveBeenCalledWith(archivo);
    expect(almacenamiento.guardar).toHaveBeenCalledWith(
      7,
      expect.any(Buffer),
      'png',
    );
    expect(repository.crear).toHaveBeenCalledWith({
      nombre: 'Cera',
      precio: 35000,
      imagenUrl: '/uploads/negocios/7/productos/producto-1.png',
    });
    expect(almacenamiento.eliminar).not.toHaveBeenCalled();
    expect(respuesta).toEqual({
      mensaje: 'Producto registrado correctamente',
      producto: { id: 1, nombre: 'Cera' },
    });
  });

  it('camino 2: con archivo × persistencia fallida (compensa eliminando la imagen)', async () => {
    repository.crear.mockRejectedValue(new Error('BD caída'));

    await expect(facade.registrar(dto, archivo)).rejects.toThrow('BD caída');
    expect(almacenamiento.guardar).toHaveBeenCalledWith(
      7,
      expect.any(Buffer),
      'png',
    );
    expect(almacenamiento.eliminar).toHaveBeenCalledWith(
      7,
      '/uploads/negocios/7/productos/producto-1.png',
    );
  });

  it('camino 3: sin archivo × persistencia exitosa (persiste imagenUrl = null sin tocar disco)', async () => {
    productoService.validarImagen.mockReturnValue(null);

    const respuesta = await facade.registrar(dto, undefined);

    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(productoService.validarImagen).toHaveBeenCalledWith(undefined);
    expect(almacenamiento.guardar).not.toHaveBeenCalled();
    expect(repository.crear).toHaveBeenCalledWith({
      nombre: 'Cera',
      precio: 35000,
      imagenUrl: null,
    });
    expect(almacenamiento.eliminar).not.toHaveBeenCalled();
    expect(respuesta).toEqual({
      mensaje: 'Producto registrado correctamente',
      producto: { id: 1, nombre: 'Cera' },
    });
  });

  it('camino 4: sin archivo × persistencia fallida (no compensa archivo inexistente)', async () => {
    productoService.validarImagen.mockReturnValue(null);
    repository.crear.mockRejectedValue(new Error('Error de BD'));

    await expect(facade.registrar(dto, undefined)).rejects.toThrow(
      'Error de BD',
    );
    expect(almacenamiento.guardar).not.toHaveBeenCalled();
    expect(almacenamiento.eliminar).not.toHaveBeenCalled();
  });

  it('no escribe la imagen si la validación de datos falla', async () => {
    productoService.validarRegistro.mockRejectedValue(new Error('duplicado'));

    await expect(facade.registrar(dto, archivo)).rejects.toThrow('duplicado');
    expect(almacenamiento.guardar).not.toHaveBeenCalled();
  });

  describe('actualizar', () => {
    const actual = {
      id: 1,
      nombre: 'Cera',
      imagenUrl: '/uploads/negocios/7/productos/old.png',
    };

    beforeEach(() => {
      productoService.validarImagen.mockReturnValue(null);
      productoService.validarActualizacion.mockResolvedValue({
        actual,
        cambios: { nombre: 'Cera mate' },
      });
    });

    it('actualiza solo los campos enviados sin tocar el disco', async () => {
      const respuesta = await facade.actualizar(1, { nombre: 'Cera mate' });

      expect(productoService.validarActualizacion).toHaveBeenCalledWith(
        1,
        { nombre: 'Cera mate' },
        false,
      );
      expect(repository.actualizar).toHaveBeenCalledWith(1, {
        nombre: 'Cera mate',
      });
      expect(almacenamiento.guardar).not.toHaveBeenCalled();
      expect(almacenamiento.eliminar).not.toHaveBeenCalled();
      expect(respuesta).toEqual({
        mensaje: 'Producto actualizado correctamente',
        producto: { id: 1, nombre: 'Cera' },
      });
    });

    it('no llama a repository.actualizar cuando cambios está vacío y no hay archivo', async () => {
      productoService.validarActualizacion.mockResolvedValue({
        actual,
        cambios: {},
      });

      const respuesta = await facade.actualizar(1, {});

      expect(repository.actualizar).not.toHaveBeenCalled();
      expect(almacenamiento.guardar).not.toHaveBeenCalled();
      expect(productoService.mapear).toHaveBeenCalledWith(actual);
      expect(respuesta).toEqual({
        mensaje: 'Producto actualizado correctamente',
        producto: { id: 1, nombre: 'Cera' },
      });
    });

    it('llama a repository.actualizar cuando cambios está vacío pero hay archivo nuevo', async () => {
      productoService.validarActualizacion.mockResolvedValue({
        actual,
        cambios: {},
      });
      productoService.validarImagen.mockReturnValue({
        contenido: Buffer.from('nueva'),
        extension: 'png',
      });
      almacenamiento.guardar.mockResolvedValue(
        '/uploads/negocios/7/productos/new.png',
      );
      repository.actualizar.mockResolvedValue({
        ...actual,
        imagenUrl: '/uploads/negocios/7/productos/new.png',
      });

      await facade.actualizar(1, {}, archivo);

      expect(productoService.validarActualizacion).toHaveBeenCalledWith(
        1,
        {},
        true,
      );
      expect(repository.actualizar).toHaveBeenCalledWith(1, {
        imagenUrl: '/uploads/negocios/7/productos/new.png',
      });
      expect(repository.tieneOtraReferenciaAImagen).toHaveBeenCalledWith(
        '/uploads/negocios/7/productos/old.png',
        1,
      );
      expect(almacenamiento.eliminar).toHaveBeenCalledWith(
        7,
        '/uploads/negocios/7/productos/old.png',
      );
    });

    it('reemplaza la imagen y elimina la anterior si no está compartida', async () => {
      productoService.validarImagen.mockReturnValue({
        contenido: Buffer.from('nueva'),
        extension: 'png',
      });
      almacenamiento.guardar.mockResolvedValue(
        '/uploads/negocios/7/productos/new.png',
      );
      repository.actualizar.mockResolvedValue({
        ...actual,
        imagenUrl: '/uploads/negocios/7/productos/new.png',
      });

      await facade.actualizar(1, {}, archivo);

      expect(repository.actualizar).toHaveBeenCalledWith(1, {
        nombre: 'Cera mate',
        imagenUrl: '/uploads/negocios/7/productos/new.png',
      });
      expect(repository.tieneOtraReferenciaAImagen).toHaveBeenCalledWith(
        '/uploads/negocios/7/productos/old.png',
        1,
      );
      expect(almacenamiento.eliminar).toHaveBeenCalledWith(
        7,
        '/uploads/negocios/7/productos/old.png',
      );
    });

    it('conserva la imagen anterior si otro producto la comparte', async () => {
      productoService.validarImagen.mockReturnValue({
        contenido: Buffer.from('nueva'),
        extension: 'png',
      });
      almacenamiento.guardar.mockResolvedValue(
        '/uploads/negocios/7/productos/new.png',
      );
      repository.tieneOtraReferenciaAImagen.mockResolvedValue(true);

      await facade.actualizar(1, {}, archivo);

      expect(almacenamiento.eliminar).not.toHaveBeenCalled();
    });

    it('elimina la imagen nueva si la base de datos falla', async () => {
      productoService.validarImagen.mockReturnValue({
        contenido: Buffer.from('nueva'),
        extension: 'png',
      });
      almacenamiento.guardar.mockResolvedValue(
        '/uploads/negocios/7/productos/new.png',
      );
      repository.actualizar.mockRejectedValue(new Error('BD caída'));

      await expect(facade.actualizar(1, {}, archivo)).rejects.toThrow(
        'BD caída',
      );
      expect(almacenamiento.eliminar).toHaveBeenCalledWith(
        7,
        '/uploads/negocios/7/productos/new.png',
      );
    });

    it('no convierte en 500 un fallo al limpiar la imagen anterior', async () => {
      productoService.validarImagen.mockReturnValue({
        contenido: Buffer.from('nueva'),
        extension: 'png',
      });
      almacenamiento.guardar.mockResolvedValue(
        '/uploads/negocios/7/productos/new.png',
      );
      almacenamiento.eliminar.mockRejectedValue(new Error('sin permisos'));

      await expect(facade.actualizar(1, {}, archivo)).resolves.toEqual({
        mensaje: 'Producto actualizado correctamente',
        producto: { id: 1, nombre: 'Cera' },
      });
    });
  });
});
