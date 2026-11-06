import { ProductosController } from './productos.controller';
import { ProductosFacade } from '../facade/productos.facade';

describe('ProductosController', () => {
  const facade = { registrar: jest.fn() };
  const controller = new ProductosController(
    facade as unknown as ProductosFacade,
  );

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
