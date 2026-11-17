import { ForbiddenException } from '@nestjs/common';
import { crearExtensionAislamientoNegocio } from './prisma-extension-aislamiento';
import { ejecutarEnContextoNegocio } from './negocio-almacenamiento';

describe('crearExtensionAislamientoNegocio (Unit)', () => {
  const ext = crearExtensionAislamientoNegocio() as unknown as {
    query: {
      $allModels: {
        $allOperations: (params: {
          model: string;
          operation: string;
          args: Record<string, unknown>;
          query: jest.Mock;
        }) => Promise<unknown>;
      };
    };
  };

  const ejecutar = (
    model: string,
    operation: string,
    args: Record<string, unknown> = {},
  ) => {
    const query = jest.fn((a: unknown) => Promise.resolve(a));
    return ext.query.$allModels.$allOperations({
      model,
      operation,
      args,
      query,
    });
  };

  const enNegocio = <T>(id: number, fn: () => Promise<T>): Promise<T> =>
    ejecutarEnContextoNegocio({ id, slug: `negocio-${id}` }, fn);

  it('deja pasar modelos globales sin exigir contexto', async () => {
    const res = await ejecutar('Negocio', 'findMany', { where: { id: 1 } });
    expect(res).toEqual({ where: { id: 1 } });
  });

  it('lanza ForbiddenException en modelo tenant-scoped sin contexto activo', async () => {
    await expect(ejecutar('Servicio', 'findMany', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe('Operaciones de lectura', () => {
    it('inyecta negocioId en el where de lecturas', async () => {
      const res = await enNegocio(5, () =>
        ejecutar('Servicio', 'findMany', { where: { estado: 'ACTIVO' } }),
      );
      expect(res).toEqual({ where: { estado: 'ACTIVO', negocioId: 5 } });
    });

    it('rechaza lectura que declara un negocioId ajeno en where', async () => {
      await expect(
        enNegocio(5, () =>
          ejecutar('Servicio', 'findUnique', {
            where: { id: 1, negocioId: 9 },
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('Operación upsert', () => {
    it('acota where y create al negocio del contexto', async () => {
      const res = await enNegocio(3, () =>
        ejecutar('Servicio', 'upsert', {
          where: { id: 10 },
          create: { nombre: 'Corte' },
          update: { nombre: 'Corte VIP' },
        }),
      );
      expect(res).toEqual({
        where: { id: 10, negocioId: 3 },
        create: { nombre: 'Corte', negocioId: 3 },
        update: { nombre: 'Corte VIP' },
      });
    });

    it('rechaza upsert con negocioId ajeno en where o create', async () => {
      await expect(
        enNegocio(3, () =>
          ejecutar('Servicio', 'upsert', {
            where: { id: 10, negocioId: 8 },
            create: { nombre: 'Corte' },
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await expect(
        enNegocio(3, () =>
          ejecutar('Servicio', 'upsert', {
            where: { id: 10 },
            create: { nombre: 'Corte', negocioId: 8 },
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('Operaciones de escritura (forzarNegocioEnEscritura)', () => {
    it('asigna negocioId en create con objeto data', async () => {
      const res = await enNegocio(4, () =>
        ejecutar('Producto', 'create', { data: { nombre: 'Cera' } }),
      );
      expect(res).toEqual({ data: { nombre: 'Cera', negocioId: 4 } });
    });

    it('asigna negocioId a cada elemento en createMany con arreglo data', async () => {
      const res = await enNegocio(4, () =>
        ejecutar('Producto', 'createMany', {
          data: [{ nombre: 'A' }, { nombre: 'B', negocioId: 4 }],
        }),
      );
      expect(res).toEqual({
        data: [
          { nombre: 'A', negocioId: 4 },
          { nombre: 'B', negocioId: 4 },
        ],
      });
    });

    it('rechaza createMany cuando un item del arreglo declara negocioId ajeno', async () => {
      await expect(
        enNegocio(4, () =>
          ejecutar('Producto', 'createMany', {
            data: [{ nombre: 'A' }, { nombre: 'B', negocioId: 99 }],
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('remueve negocioId plano de data en update e inyecta negocioId en where', async () => {
      const res = await enNegocio(4, () =>
        ejecutar('Producto', 'update', {
          where: { id: 1 },
          data: { nombre: 'Nuevo', negocioId: 4 },
        }),
      );
      expect(res).toEqual({
        where: { id: 1, negocioId: 4 },
        data: { nombre: 'Nuevo' },
      });
    });

    it('conserva data intacto en update cuando no trae negocioId plano', async () => {
      const res = await enNegocio(4, () =>
        ejecutar('Producto', 'update', {
          where: { id: 1 },
          data: { nombre: 'SinNegocioId' },
        }),
      );
      expect(res).toEqual({
        where: { id: 1, negocioId: 4 },
        data: { nombre: 'SinNegocioId' },
      });
    });

    it('inyecta negocioId en delete (sin data) y rechaza where o data ajenos', async () => {
      const res = await enNegocio(4, () =>
        ejecutar('Producto', 'delete', { where: { id: 2 } }),
      );
      expect(res).toEqual({ where: { id: 2, negocioId: 4 } });

      await expect(
        enNegocio(4, () =>
          ejecutar('Producto', 'delete', { where: { id: 2, negocioId: 7 } }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await expect(
        enNegocio(4, () =>
          ejecutar('Producto', 'update', {
            where: { id: 2 },
            data: { nombre: 'X', negocioId: 7 },
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('deja pasar operaciones no catalogadas cuando hay contexto válido', async () => {
      const res = await enNegocio(4, () =>
        ejecutar('Producto', 'customOp', { foo: 'bar' }),
      );
      expect(res).toEqual({ foo: 'bar' });
    });
  });
});
