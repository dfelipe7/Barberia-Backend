import {
  ClienteMigracion,
  EntradaInicializacion,
  ResultadoInicializacion,
  ejecutarBackfillNegocio,
  inicializarPrimerNegocio,
  validarSlug,
} from './migracion-negocio.service';
import {
  EstadoNegocio,
  TipoConfiguracion,
} from '../../../../generated/prisma/enums';
import { MODELOS_CON_NEGOCIO } from './migracion-negocio.constants';

/**
 * Cliente de migración simulado.
 *
 * Modela el comportamiento de la base de datos en lo que importa para la
 * idempotencia: `upsert` con `update: {}` no modifica una fila existente, y
 * un `create` de negocio falla si ya existe uno con el mismo slug.
 */
interface EstadoSimulado {
  negocios: Array<{
    id: number;
    slug: string;
    nombre: string;
    estado: string;
    zonaHoraria: string;
  }>;
  configuracionesNegocio: Map<
    string,
    {
      id: number;
      negocioId: number;
      clave: string;
      valor: string;
      tipo: string;
      descripcion: string;
      editable: boolean;
    }
  >;
  configuracionesSistema: Map<
    string,
    { valor: string; tipo: string; descripcion: string }
  >;
  siguienteId: number;
}

const crearClienteSimulado = (
  estadoInicial?: Partial<EstadoSimulado>,
): { cliente: ClienteMigracion; estado: EstadoSimulado } => {
  const estado: EstadoSimulado = {
    negocios: [],
    configuracionesNegocio: new Map(),
    configuracionesSistema: new Map([
      [
        'reserva_cancelacion_antelacion_minutos',
        {
          valor: '120',
          tipo: TipoConfiguracion.NUMERO,
          descripcion: 'Antelación de cancelación',
        },
      ],
      [
        'reserva_no_show_tolerancia_minutos',
        {
          valor: '15',
          tipo: TipoConfiguracion.NUMERO,
          descripcion: 'Tolerancia NO_SHOW',
        },
      ],
    ]),
    siguienteId: 1,
    ...estadoInicial,
  };

  const cliente: ClienteMigracion = {
    negocio: {
      findUnique: ({ where: { slug } }) => {
        const negocio = estado.negocios.find((n) => n.slug === slug);

        return Promise.resolve(
          negocio
            ? { id: negocio.id, slug: negocio.slug, nombre: negocio.nombre }
            : null,
        );
      },
      create: ({ data }) => {
        const negocio = {
          id: estado.siguienteId++,
          slug: data.slug,
          nombre: data.nombre,
          estado: data.estado,
          zonaHoraria: data.zonaHoraria,
        };

        estado.negocios.push(negocio);

        return Promise.resolve({
          id: negocio.id,
          slug: negocio.slug,
          nombre: negocio.nombre,
        });
      },
      count: () => Promise.resolve(estado.negocios.length),
    },
    configuracionNegocio: {
      findUnique: ({ where: { negocioId_clave } }) => {
        const clave = `${negocioId_clave.negocioId}:${negocioId_clave.clave}`;
        const fila = estado.configuracionesNegocio.get(clave);

        return Promise.resolve(fila ? { valor: fila.valor } : null);
      },
      upsert: ({ where, create }) => {
        const clave = `${where.negocioId_clave.negocioId}:${where.negocioId_clave.clave}`;

        // `update: {}` es idempotente: si existe, NO se toca.
        if (!estado.configuracionesNegocio.has(clave)) {
          estado.configuracionesNegocio.set(clave, {
            id: estado.siguienteId++,
            ...create,
          });
        }

        return Promise.resolve(undefined);
      },
    },
    configuracionSistema: {
      findUnique: ({ where: { clave } }) =>
        Promise.resolve(estado.configuracionesSistema.get(clave) ?? null),
    },
  };

  return { cliente, estado };
};

const ENTRADA: EntradaInicializacion = {
  nombre: 'Barbería de Prueba',
  slug: 'barberia-prueba',
};

describe('inicializarPrimerNegocio', () => {
  it('crea el negocio cuando no existe ninguno', async () => {
    const { cliente, estado } = crearClienteSimulado();

    const resultado = await inicializarPrimerNegocio(cliente, ENTRADA);

    expect(resultado.creado).toBe(true);
    expect(resultado.negocioId).toBe(1);
    expect(resultado.slug).toBe('barberia-prueba');
    expect(estado.negocios).toHaveLength(1);
    expect(estado.negocios[0]).toMatchObject({
      nombre: 'Barbería de Prueba',
      slug: 'barberia-prueba',
      estado: EstadoNegocio.ACTIVO,
      zonaHoraria: 'America/Bogota',
    });
  });

  it('copia las configuraciones operativas al ámbito del negocio', async () => {
    const { cliente, estado } = crearClienteSimulado();

    const resultado = await inicializarPrimerNegocio(cliente, ENTRADA);

    expect(resultado.configuracionesCopiadas).toEqual([
      'reserva_cancelacion_antelacion_minutos',
      'reserva_no_show_tolerancia_minutos',
    ]);
    expect(resultado.configuracionesConservadas).toEqual([]);

    const cancelacion = estado.configuracionesNegocio.get(
      '1:reserva_cancelacion_antelacion_minutos',
    );
    const noShow = estado.configuracionesNegocio.get(
      '1:reserva_no_show_tolerancia_minutos',
    );

    // Los valores iniciales son los conocidos: 120 y 15 minutos.
    expect(cancelacion?.valor).toBe('120');
    expect(noShow?.valor).toBe('15');
  });

  it('NO duplica el negocio al ejecutarse dos veces', async () => {
    const { cliente, estado } = crearClienteSimulado();

    const primera = await inicializarPrimerNegocio(cliente, ENTRADA);
    const segunda = await inicializarPrimerNegocio(cliente, ENTRADA);

    expect(primera.creado).toBe(true);
    expect(segunda.creado).toBe(false);
    expect(segunda.negocioId).toBe(primera.negocioId);
    expect(estado.negocios).toHaveLength(1);
  });

  it('NO sobrescribe el nombre ni el estado personalizados al repetirse', async () => {
    const { cliente, estado } = crearClienteSimulado();

    await inicializarPrimerNegocio(cliente, ENTRADA);

    // Personalización posterior, como haría un administrador.
    estado.negocios[0].nombre = 'Nombre Editado';
    estado.negocios[0].estado = EstadoNegocio.INACTIVO;

    const segunda = await inicializarPrimerNegocio(cliente, ENTRADA);

    expect(segunda.creado).toBe(false);
    expect(estado.negocios).toHaveLength(1);
    expect(estado.negocios[0].nombre).toBe('Nombre Editado');
    expect(estado.negocios[0].estado).toBe(EstadoNegocio.INACTIVO);
  });

  it('NO sobrescribe el valor de una configuración ya personalizada', async () => {
    const { cliente, estado } = crearClienteSimulado();

    await inicializarPrimerNegocio(cliente, ENTRADA);

    // El administrador personaliza el valor en el ámbito del negocio.
    estado.configuracionesNegocio.set(
      '1:reserva_cancelacion_antelacion_minutos',
      {
        id: 99,
        negocioId: 1,
        clave: 'reserva_cancelacion_antelacion_minutos',
        valor: '45',
        tipo: TipoConfiguracion.NUMERO,
        descripcion: 'Personalizado',
        editable: true,
      },
    );

    const segunda = await inicializarPrimerNegocio(cliente, ENTRADA);

    expect(segunda.configuracionesConservadas).toContain(
      'reserva_cancelacion_antelacion_minutos',
    );
    expect(segunda.configuracionesCopiadas).not.toContain(
      'reserva_cancelacion_antelacion_minutos',
    );
    expect(
      estado.configuracionesNegocio.get(
        '1:reserva_cancelacion_antelacion_minutos',
      )?.valor,
    ).toBe('45');
  });

  it('rechaza inicializar si ya hay negocios con otro slug', async () => {
    const { cliente } = crearClienteSimulado({
      negocios: [
        {
          id: 1,
          slug: 'otro-negocio',
          nombre: 'Otro',
          estado: EstadoNegocio.ACTIVO,
          zonaHoraria: 'America/Bogota',
        },
      ],
    });

    await expect(inicializarPrimerNegocio(cliente, ENTRADA)).rejects.toThrow(
      /ya tiene 1 negocio/,
    );
  });

  it('rechaza un nombre vacío', async () => {
    const { cliente } = crearClienteSimulado();

    await expect(
      inicializarPrimerNegocio(cliente, { nombre: '   ', slug: 'prueba' }),
    ).rejects.toThrow(/nombre del primer negocio es obligatorio/);
  });

  it('normaliza el slug a minúsculas', async () => {
    const { cliente, estado } = crearClienteSimulado();

    const resultado = await inicializarPrimerNegocio(cliente, {
      nombre: 'Prueba',
      slug: '  Barberia-Prueba  ',
    });

    expect(resultado.slug).toBe('barberia-prueba');
    expect(estado.negocios[0].slug).toBe('barberia-prueba');
  });
});

describe('validarSlug', () => {
  it('admite slugs con a-z, 0-9 y guiones', () => {
    expect(validarSlug('barberia-prueba')).toBeNull();
    expect(validarSlug('kyrios')).toBeNull();
    expect(validarSlug('barberia2')).toBeNull();
    expect(validarSlug('a-b-c-1-2')).toBeNull();
  });

  it('rechaza caracteres fuera del conjunto permitido', () => {
    expect(validarSlug('barberia_prueba')).not.toBeNull();
    expect(validarSlug('barbería')).not.toBeNull();
    expect(validarSlug('barberia prueba')).not.toBeNull();
    expect(validarSlug('barberia.abc')).not.toBeNull();
    expect(validarSlug('barberia/abc')).not.toBeNull();
  });

  it('rechaza guiones en los extremos', () => {
    expect(validarSlug('-barberia')).not.toBeNull();
    expect(validarSlug('barberia-')).not.toBeNull();
  });

  it('rechaza un slug vacío o demasiado largo', () => {
    expect(validarSlug('')).not.toBeNull();
    expect(validarSlug('a'.repeat(64))).not.toBeNull();
    expect(validarSlug('a'.repeat(63))).toBeNull();
  });
});

describe('ejecutarBackfillNegocio', () => {
  it('asigna el negocio a las filas que aún no lo tienen', async () => {
    const ejecutarLote = jest
      .fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValue(0);
    const contar = jest.fn().mockResolvedValue({
      total: 4,
      delNegocio: 4,
      sinNegocio: 0,
    });

    const resultado = await ejecutarBackfillNegocio(
      ejecutarLote,
      contar,
      7,
      1000,
    );

    expect(resultado.negocioId).toBe(7);
    expect(resultado.actualizadas).toBe(4);
    expect(resultado.conteos).toHaveLength(MODELOS_CON_NEGOCIO.length);
    expect(resultado.conteos[0]).toMatchObject({
      total: 4,
      delNegocio: 4,
      sinNegocio: 0,
    });
  });

  it('recorre TODOS los modelos por negocio', async () => {
    const ejecutarLote = jest.fn().mockResolvedValue(0);
    const contar = jest.fn().mockResolvedValue({
      total: 0,
      delNegocio: 0,
      sinNegocio: 0,
    });

    await ejecutarBackfillNegocio(ejecutarLote, contar, 1, 1000);

    const tablasRecorridas = ejecutarLote.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );

    expect(tablasRecorridas).toEqual(
      MODELOS_CON_NEGOCIO.map((modelo) => modelo.tabla),
    );
  });

  it('es idempotente: la segunda ejecución no actualiza filas', async () => {
    // Primera ejecución: 5 filas por modelo. Segunda: ninguna.
    const filasPorModelo = new Map<string, number>();
    const ejecutarLote = jest.fn((tabla: string, lote: number) => {
      const pendientes = filasPorModelo.get(tabla) ?? 5;
      const afectadas = Math.min(lote, pendientes);
      filasPorModelo.set(tabla, pendientes - afectadas);
      return Promise.resolve(afectadas);
    });
    const contar = jest.fn().mockResolvedValue({
      total: 5,
      delNegocio: 5,
      sinNegocio: 0,
    });

    const primera = await ejecutarBackfillNegocio(
      ejecutarLote,
      contar,
      1,
      1000,
    );
    const segunda = await ejecutarBackfillNegocio(
      ejecutarLote,
      contar,
      1,
      1000,
    );

    expect(primera.actualizadas).toBe(MODELOS_CON_NEGOCIO.length * 5);
    expect(segunda.actualizadas).toBe(0);
  });

  it('rechaza un tamaño de lote inválido', async () => {
    await expect(
      ejecutarBackfillNegocio(jest.fn(), jest.fn(), 1, 0),
    ).rejects.toThrow(/tamaño de lote/);

    await expect(
      ejecutarBackfillNegocio(jest.fn(), jest.fn(), 1, -5),
    ).rejects.toThrow(/tamaño de lote/);

    await expect(
      ejecutarBackfillNegocio(jest.fn(), jest.fn(), 1, 1.5),
    ).rejects.toThrow(/tamaño de lote/);
  });
});

describe('ResultadoInicializacion', () => {
  it('expone el contrato esperado', () => {
    const resultado: ResultadoInicializacion = {
      negocioId: 1,
      slug: 'prueba',
      creado: true,
      configuracionesCopiadas: [],
      configuracionesConservadas: [],
    };

    expect(resultado.negocioId).toBe(1);
    expect(resultado.creado).toBe(true);
  });
});
