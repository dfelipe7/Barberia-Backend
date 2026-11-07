import { ProductosController } from './productos.controller';
import { ProductosFacade } from '../facade/productos.facade';

describe('ProductosController', () => {
  const facade = {
    registrar: jest.fn(),
    listar: jest.fn(),
    obtenerPorId: jest.fn(),
  };
  const controller = new ProductosController(
    facade as unknown as ProductosFacade,
  );

  it('delega el listado en la fachada sin reglas de negocio', async () => {
    const respuesta = { productos: [], mensaje: 'No existen productos' };
    facade.listar.mockResolvedValue(respuesta);

    await expect(controller.listar()).resolves.toBe(respuesta);
    expect(facade.listar).toHaveBeenCalled();
  });

  it('delega el detalle en la fachada con el id recibido', async () => {
    const respuesta = { id: 3 };
    facade.obtenerPorId.mockResolvedValue(respuesta);

    await expect(controller.obtenerPorId(3)).resolves.toBe(respuesta);
    expect(facade.obtenerPorId).toHaveBeenCalledWith(3);
  });

  it('delega el registro en la fachada', async () => {
    const dto = { nombre: 'Cera', precio: 35000 };
    const archivo = { buffer: Buffer.from('imagen') } as Express.Multer.File;
    facade.registrar.mockResolvedValue({ mensaje: 'ok' });

    await expect(controller.registrar(dto, archivo)).resolves.toEqual({
      mensaje: 'ok',
    });
    expect(facade.registrar).toHaveBeenCalledWith(dto, archivo);
  });
});
