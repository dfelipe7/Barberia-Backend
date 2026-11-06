import { ProductosFacade } from './productos.facade';
import { ProductoService } from '../service/producto.service';
import { AlmacenamientoProductosService } from '../service/almacenamiento-productos.service';
import { ProductoRepository } from '../repository/producto.repository';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';

describe('ProductosFacade', () => {
  const productoService = {
    validarRegistro: jest.fn(),
    validarImagen: jest.fn(),
    mapear: jest.fn(),
  };
  const almacenamiento = {
    guardar: jest.fn(),
    eliminar: jest.fn(),
  };
  const repository = { crear: jest.fn() };
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
    productoService.mapear.mockReturnValue({ id: 1, nombre: 'Cera' });
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
});
