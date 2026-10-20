import {
  EstadoNegocio,
  TipoConfiguracion,
} from '../../../../generated/prisma/enums';
import {
  CLAVES_CONFIGURACION_OPERATIVA,
  MODELOS_CON_NEGOCIO,
  REGEX_SLUG_NEGOCIO,
  LONGITUD_MAXIMA_SLUG,
  ZONA_HORARIA_POR_DEFECTO,
} from './migracion-negocio.constants';

/**
 * Contrato mínimo de acceso a datos que necesita la migración.
 *
 * Se declara como interfaz propia, y no como el `PrismaClient` concreto, para
 * que las pruebas puedan ejercitar la lógica de idempotencia sin base de datos
 * y para que el CLI pueda inyectar el cliente real.
 */
export interface ClienteMigracion {
  negocio: {
    findUnique(args: {
      where: { slug: string };
      select?: { id: true; slug: true; nombre: true };
    }): Promise<{ id: number; slug: string; nombre: string } | null>;
    create(args: {
      data: {
        slug: string;
        nombre: string;
        estado: typeof EstadoNegocio.ACTIVO;
        zonaHoraria: string;
      };
    }): Promise<{ id: number; slug: string; nombre: string }>;
    count(): Promise<number>;
  };
  configuracionNegocio: {
    findUnique(args: {
      where: { negocioId_clave: { negocioId: number; clave: string } };
      select?: { valor: true };
    }): Promise<{ valor: string } | null>;
    upsert(args: {
      where: { negocioId_clave: { negocioId: number; clave: string } };
      update: Record<string, never>;
      create: {
        negocioId: number;
        clave: string;
        valor: string;
        tipo: (typeof TipoConfiguracion)[keyof typeof TipoConfiguracion];
        descripcion: string;
        editable: boolean;
      };
    }): Promise<unknown>;
  };
  configuracionSistema: {
    findUnique(args: {
      where: { clave: string };
      select?: { valor: true; tipo: true; descripcion: true };
    }): Promise<{
      valor: string;
      tipo: string;
      descripcion: string | null;
    } | null>;
  };
}

/** Datos de entrada para la inicialización del primer negocio. */
export interface EntradaInicializacion {
  nombre: string;
  slug: string;
  zonaHoraria?: string;
}

/** Resultado de la inicialización del primer negocio. */
export interface ResultadoInicializacion {
  /** Identificador del negocio inicial. */
  negocioId: number;
  /** Slug del negocio inicial. */
  slug: string;
  /** `true` si el negocio se creó en esta ejecución. */
  creado: boolean;
  /** Claves de configuración copiadas al ámbito del negocio en esta ejecución. */
  configuracionesCopiadas: string[];
  /** Claves que ya existían en el ámbito del negocio y se conservaron. */
  configuracionesConservadas: string[];
}

/** Desglose de filas de un modelo según su pertenencia al negocio. */
export interface ConteoModelo {
  modelo: string;
  etiqueta: string;
  total: number;
  delNegocio: number;
  sinNegocio: number;
  enOtroNegocio: number;
}

/** Resultado del backfill de `negocioId`. */
export interface ResultadoBackfill {
  negocioId: number;
  conteos: ConteoModelo[];
  /** Filas actualizadas en total. */
  actualizadas: number;
}

/**
 * Inicialización IDEMPOTENTE del primer negocio.
 *
 * Garantías:
 *  - Si el negocio con ese `slug` ya existe, NO se duplica y NO se
 *    sobrescribe su nombre ni su estado: se conservan las personalizaciones.
 *  - Si ya existen OTROS negocios con distinto `slug`, la inicialización se
 *    rechaza: este mecanismo es exclusivamente para el primer negocio de una
 *    plataforma recién creada, y aplicarlo sobre una plataforma con varios
 *    negocios asignaría registros al negocio equivocado.
 *  - Las configuraciones operativas solo se crean si faltan; las existentes se
 *    conservan con su valor (posiblemente personalizado por un administrador).
 */
export async function inicializarPrimerNegocio(
  cliente: ClienteMigracion,
  entrada: EntradaInicializacion,
): Promise<ResultadoInicializacion> {
  const nombre = entrada.nombre.trim();
  const slug = entrada.slug.trim().toLowerCase();
  const zonaHoraria = entrada.zonaHoraria?.trim() || ZONA_HORARIA_POR_DEFECTO;

  if (!nombre) {
    throw new Error(
      'El nombre del primer negocio es obligatorio: no puede inventarse',
    );
  }

  const errorSlug = validarSlug(slug);
  if (errorSlug) {
    throw new Error(errorSlug);
  }

  const existente = await cliente.negocio.findUnique({
    where: { slug },
    select: { id: true, slug: true, nombre: true },
  });

  let negocioId: number;
  let creado: boolean;

  if (existente) {
    negocioId = existente.id;
    creado = false;
  } else {
    // El mecanismo es para el PRIMER negocio: si ya hay negocios con otro
    // slug, asignarles registros sería un error silencioso grave.
    const totalNegocios = await cliente.negocio.count();

    if (totalNegocios > 0) {
      throw new Error(
        `La plataforma ya tiene ${totalNegocios} negocio(s) y ninguno usa el slug '${slug}'. ` +
          'Este mecanismo es solo para el primer negocio de una plataforma nueva.',
      );
    }

    const creado_ = await cliente.negocio.create({
      data: {
        slug,
        nombre,
        estado: EstadoNegocio.ACTIVO,
        zonaHoraria,
      },
    });

    negocioId = creado_.id;
    creado = true;
  }

  const configuracionesCopiadas: string[] = [];
  const configuracionesConservadas: string[] = [];

  for (const config of CLAVES_CONFIGURACION_OPERATIVA) {
    // Se consulta ANTES de escribir para poder distinguir "copiada" de
    // "conservada": el `upsert` con `update: {}` no revela si la fila ya
    // existía, y el informe de la migración debe saberlo.
    const yaExistia = await cliente.configuracionNegocio.findUnique({
      where: { negocioId_clave: { negocioId, clave: config.clave } },
      select: { valor: true },
    });

    if (yaExistia) {
      // Se conserva el valor existente: puede estar personalizado.
      configuracionesConservadas.push(config.clave);
      continue;
    }

    // El valor de partida es el que la plataforma tenga vigente (global o por
    // defecto); nunca se inventa uno distinto al ya conocido.
    const global = await cliente.configuracionSistema.findUnique({
      where: { clave: config.clave },
      select: { valor: true, tipo: true, descripcion: true },
    });

    const valor = global?.valor ?? config.valorPorDefecto;
    const tipo =
      (global?.tipo as
        | (typeof TipoConfiguracion)[keyof typeof TipoConfiguracion]
        | undefined) ?? TipoConfiguracion.NUMERO;
    const descripcion = global?.descripcion ?? config.descripcion;

    await cliente.configuracionNegocio.upsert({
      where: { negocioId_clave: { negocioId, clave: config.clave } },
      update: {},
      create: {
        negocioId,
        clave: config.clave,
        valor,
        tipo,
        descripcion,
        editable: true,
      },
    });

    configuracionesCopiadas.push(config.clave);
  }

  return {
    negocioId,
    slug,
    creado,
    configuracionesCopiadas,
    configuracionesConservadas,
  };
}

/**
 * Asigna el negocio a los registros preexistentes que aún no lo tienen.
 *
 * Se ejecuta por lotes: cada sentencia es un `UPDATE ... WHERE negocioId IS
 * NULL LIMIT n`, que es idempotente por construcción (la segunda ejecución
 * no encuentra filas) y no bloquea la tabla entera.
 *
 * El statement se construye con el nombre de tabla de una lista cerrada y
 * con el tamaño de lote ya validado como entero; el ÚNICO valor que llega
 * desde fuera (el id del negocio) se envía como PARÁMETRO, nunca
 * interpolado en el texto SQL.
 */
export async function ejecutarBackfillNegocio(
  ejecutarLote: (
    tabla: string,
    lote: number,
    negocioId: number,
  ) => Promise<number>,
  contar: (
    tabla: string,
    negocioId: number,
  ) => Promise<{ total: number; delNegocio: number; sinNegocio: number }>,
  negocioId: number,
  lote: number,
): Promise<ResultadoBackfill> {
  if (!Number.isInteger(lote) || lote <= 0) {
    throw new Error('El tamaño de lote debe ser un entero positivo');
  }

  const conteos: ConteoModelo[] = [];
  let actualizadas = 0;

  for (const modelo of MODELOS_CON_NEGOCIO) {
    let filasDelModelo = 0;

    for (;;) {
      const afectadas = await ejecutarLote(modelo.tabla, lote, negocioId);
      filasDelModelo += afectadas;

      if (afectadas < lote) {
        break;
      }
    }

    const conteo = await contar(modelo.tabla, negocioId);

    conteos.push({
      modelo: modelo.modelo,
      etiqueta: modelo.etiqueta,
      total: conteo.total,
      delNegocio: conteo.delNegocio,
      sinNegocio: conteo.sinNegocio,
      enOtroNegocio: Math.max(
        0,
        conteo.total - conteo.delNegocio - conteo.sinNegocio,
      ),
    });

    actualizadas += filasDelModelo;
  }

  return { negocioId, conteos, actualizadas };
}

/**
 * Valida el slug del negocio.
 *
 * Formato: exclusivamente `a-z`, `0-9` y guiones, longitud máxima 63, sin
 * empezar ni terminar en guion (compatibilidad con una etiqueta DNS, que es el
 * uso previsto como subdominio).
 */
export function validarSlug(slug: string): string | null {
  if (!slug) {
    return 'El slug del negocio es obligatorio';
  }

  if (slug.length > LONGITUD_MAXIMA_SLUG) {
    return `El slug del negocio no puede superar ${LONGITUD_MAXIMA_SLUG} caracteres`;
  }

  if (!REGEX_SLUG_NEGOCIO.test(slug)) {
    return 'El slug del negocio solo admite a-z, 0-9 y guiones, y no puede empezar ni terminar en guion';
  }

  return null;
}
