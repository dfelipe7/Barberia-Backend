import { ForbiddenException } from '@nestjs/common';
import { NegocioContextoService } from './negocio-contexto.service';

const esperar = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('NegocioContextoService', () => {
  let service: NegocioContextoService;

  beforeEach(() => {
    service = new NegocioContextoService();
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('obtenerContexto', () => {
    it('devuelve undefined fuera de cualquier contexto', () => {
      expect(service.obtenerContexto()).toBeUndefined();
      expect(service.tieneContexto()).toBe(false);
    });

    it('devuelve el contexto establecido dentro de la operación', () => {
      const resultado = service.ejecutarEnContexto(
        { id: 1, slug: 'kyrios' },
        () => service.obtenerContexto(),
      );

      expect(resultado).toEqual({ id: 1, slug: 'kyrios' });
    });

    it('el contexto no sobrevive a la salida de la operación', () => {
      service.ejecutarEnContexto({ id: 1, slug: 'kyrios' }, () => undefined);

      expect(service.obtenerContexto()).toBeUndefined();
    });
  });

  describe('propagación asíncrona', () => {
    it('el contexto se conserva a través de operaciones asíncronas', async () => {
      const resultado = await service.ejecutarEnContexto(
        { id: 7, slug: 'acme' },
        async () => {
          await esperar(5);
          const trasEspera = service.obtenerContexto();

          await Promise.resolve();
          const trasMicrotask = service.obtenerContexto();

          return { trasEspera, trasMicrotask };
        },
      );

      expect(resultado.trasEspera).toEqual({ id: 7, slug: 'acme' });
      expect(resultado.trasMicrotask).toEqual({ id: 7, slug: 'acme' });
    });

    it('el contexto se conserva dentro de una cadena de promesas encadenadas', async () => {
      const resultado = await service.ejecutarEnContexto(
        { id: 3, slug: 'barber' },
        () =>
          Promise.resolve()
            .then(() => Promise.resolve())
            .then(() => service.obtenerContexto()),
      );

      expect(resultado).toEqual({ id: 3, slug: 'barber' });
    });
  });

  describe('aislamiento entre contextos concurrentes', () => {
    it('dos ejecuciones concurrentes no comparten contexto', async () => {
      const observar = (id: number, slug: string) =>
        service.ejecutarEnContexto({ id, slug }, async () => {
          // Se intercalan las ejecuciones: el `await` permite que la otra
          // cadena avance mientras esta está suspendida.
          await esperar(10);
          const trasEspera = service.obtenerContexto();
          await esperar(5);
          const trasSegundaEspera = service.obtenerContexto();
          return { trasEspera, trasSegundaEspera };
        });

      const [primero, segundo] = await Promise.all([
        observar(1, 'kyrios'),
        observar(2, 'acme'),
      ]);

      expect(primero.trasEspera).toEqual({ id: 1, slug: 'kyrios' });
      expect(primero.trasSegundaEspera).toEqual({ id: 1, slug: 'kyrios' });
      expect(segundo.trasEspera).toEqual({ id: 2, slug: 'acme' });
      expect(segundo.trasSegundaEspera).toEqual({ id: 2, slug: 'acme' });
    });

    it('un contexto anidado sobrescribe al externo y se restaura al salir', () => {
      const resultado = service.ejecutarEnContexto(
        { id: 1, slug: 'externo' },
        () => {
          const antes = service.obtenerContexto();
          const interno = service.ejecutarEnContexto(
            { id: 2, slug: 'interno' },
            () => service.obtenerContexto(),
          );
          const despues = service.obtenerContexto();

          return { antes, interno, despues };
        },
      );

      expect(resultado.antes).toEqual({ id: 1, slug: 'externo' });
      expect(resultado.interno).toEqual({ id: 2, slug: 'interno' });
      expect(resultado.despues).toEqual({ id: 1, slug: 'externo' });
    });
  });

  describe('obtenerContextoRequerido', () => {
    it('devuelve el contexto cuando existe', () => {
      const resultado = service.ejecutarEnContexto(
        { id: 5, slug: 'kyrios' },
        () => service.obtenerContextoRequerido(),
      );

      expect(resultado).toEqual({ id: 5, slug: 'kyrios' });
    });

    it('falla de forma segura cuando no hay contexto', () => {
      expect(() => service.obtenerContextoRequerido()).toThrow(
        ForbiddenException,
      );
      expect(() => service.obtenerContextoRequerido()).toThrow(
        'La operación requiere un contexto de negocio autorizado',
      );
    });
  });
});
