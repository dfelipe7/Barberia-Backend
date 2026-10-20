import {
  CLAVES_CONFIGURACION_OPERATIVA,
  MODELOS_CON_NEGOCIO,
  REGEX_SLUG_NEGOCIO,
} from './migracion-negocio.constants';

/**
 * Lógica de la migración de datos al modelo multitenant (Fase 2), separada de
 * Prisma para poder PROBARLA SIN BASE DE DATOS.
 *
 * Las funciones son puras (no tocan la base de datos): reciben el estado
 * necesario y devuelven la decisión. El script `prisma/multitenant/
 * migrar-negocio.ts` las aplica sobre Prisma real.
 */

/** Estado de un negocio ya existente en la plataforma. */
export interface NegocioExistente {
  id: number;
  slug: string;
  nombre: string;
}

/** Resultado de decidir la inicialización del primer negocio. */
export type DecisionInicializacion =
  | { accion: 'crear'; nombre: string; slug: string }
  | { accion: 'reutilizar'; negocioId: number; slug: string }
  | { accion: 'rechazar'; motivo: string };

/**
 * Decide qué hacer con el primer negocio.
 *
 * - Si el `slug` ya existe: se REUTILIZA. No se duplica ni se sobrescribe
 *   su nombre o estado (pueden estar personalizados).
 * - Si no existe pero ya hay otros negocios: se RECHAZA. Este mecanismo es
 *   solo para el primer negocio de una plataforma nueva; aplicarlo sobre una
 *   plataforma con varios negocios asignaría registros al negocio equivocado.
 * - Si no existe ninguno: se CREA.
 */
export function decidirInicializacion(
  entrada: { nombre: string; slug: string },
  estado: {
    negocioConSlug?: NegocioExistente;
    totalNegocios: number;
  },
): DecisionInicializacion {
  const nombre = entrada.nombre.trim();
  const slug = entrada.slug.trim().toLowerCase();

  if (!nombre) {
    return {
      accion: 'rechazar',
      motivo: 'El nombre del primer negocio es obligatorio',
    };
  }

  if (!slug) {
    return {
      accion: 'rechazar',
      motivo: 'El slug del primer negocio es obligatorio',
    };
  }

  if (!REGEX_SLUG_NEGOCIO.test(slug)) {
    return {
      accion: 'rechazar',
      motivo:
        'El slug solo admite a-z, 0-9 y guiones, no puede empezar ni terminar en guion, y admite hasta 63 caracteres',
    };
  }

  if (estado.negocioConSlug) {
    return {
      accion: 'reutilizar',
      negocioId: estado.negocioConSlug.id,
      slug,
    };
  }

  if (estado.totalNegocios > 0) {
    return {
      accion: 'rechazar',
      motivo: `La plataforma ya tiene ${estado.totalNegocios} negocio(s) y ninguno usa el slug '${slug}'`,
    };
  }

  return { accion: 'crear', nombre, slug };
}

/** Valor inicial de una configuración operativa en el ámbito del negocio. */
export interface ValorConfiguracionGlobal {
  valor: string;
  tipo: string;
  descripcion: string | null;
}

/** Resultado de decidir el valor inicial de una configuración operativa. */
export type DecisionConfiguracion =
  | { accion: 'crear'; valor: string; tipo: string; descripcion: string }
  | { accion: 'conservar'; valor: string };

/**
 * Decide el valor inicial de una configuración operativa en el negocio.
 *
 * Si la clave YA existe en el ámbito del negocio, se CONSERVA su valor: puede
 * estar personalizado por un administrador y no debe sobrescribirse. Si no
 * existe, se crea con el valor vigente en el ámbito global (o el valor por
 * defecto conocido).
 */
export function decidirConfiguracionOperativa(
  config: { clave: string; valorPorDefecto: string; descripcion: string },
  estado: {
    valorEnNegocio?: { valor: string };
    valorGlobal?: ValorConfiguracionGlobal;
  },
): DecisionConfiguracion {
  if (estado.valorEnNegocio) {
    return { accion: 'conservar', valor: estado.valorEnNegocio.valor };
  }

  const global = estado.valorGlobal;

  return {
    accion: 'crear',
    valor: global?.valor ?? config.valorPorDefecto,
    tipo: global?.tipo ?? 'NUMERO',
    descripcion: global?.descripcion ?? config.descripcion,
  };
}

/** Resultado de una ejecución del backfill. */
export interface ResultadoBackfill {
  /** Filas actualizadas por modelo. */
  actualizadasPorModelo: Array<{
    modelo: string;
    tabla: string;
    actualizadas: number;
  }>;
  /** Total de filas actualizadas. */
  total: number;
  /** Modelos que aún conservan filas sin negocio. */
  pendientes: Array<{ modelo: string; tabla: string; sinNegocio: number }>;
}

/**
 * Ejecuta el backfill por lotes.
 *
 * `ejecutarLote` aplica un `UPDATE ... WHERE negocioId IS NULL LIMIT n` sobre
 * una tabla y devuelve cuántas filas afectan. Como el filtro es
 * `negocioId IS NULL`, la operación es IDEMPOTENTE: la segunda ejecución no
 * encuentra filas y no cambia nada.
 *
 * `contarSinNegocio` comprueba, al final, que no queda ninguna fila sin
 * negocio en los modelos por negocio.
 */
export async function ejecutarBackfill(
  ejecutarLote: (
    tabla: string,
    lote: number,
    negocioId: number,
  ) => Promise<number>,
  contarSinNegocio: (tabla: string) => Promise<number>,
  negocioId: number,
  lote: number,
): Promise<ResultadoBackfill> {
  if (!Number.isInteger(lote) || lote <= 0) {
    throw new Error('El tamaño de lote debe ser un entero positivo');
  }

  const actualizadasPorModelo: ResultadoBackfill['actualizadasPorModelo'] = [];
  const pendientes: ResultadoBackfill['pendientes'] = [];
  let total = 0;

  for (const modelo of MODELOS_CON_NEGOCIO) {
    let actualizadas = 0;

    for (;;) {
      const afectadas = await ejecutarLote(modelo.tabla, lote, negocioId);
      actualizadas += afectadas;

      // Si el lote vino incompleto, ya no hay más filas que asignar.
      if (afectadas < lote) {
        break;
      }
    }

    actualizadasPorModelo.push({
      modelo: modelo.modelo,
      tabla: modelo.tabla,
      actualizadas,
    });

    total += actualizadas;

    const sinNegocio = await contarSinNegocio(modelo.tabla);
    if (sinNegocio > 0) {
      pendientes.push({
        modelo: modelo.modelo,
        tabla: modelo.tabla,
        sinNegocio,
      });
    }
  }

  return { actualizadasPorModelo, total, pendientes };
}

/**
 * Verifica la reconciliación: no debe quedar ningún registro sin negocio en
 * los modelos por negocio.
 */
export function reconciliar(resultado: ResultadoBackfill): {
  correcto: boolean;
  mensaje: string;
} {
  if (resultado.pendientes.length > 0) {
    const detalle = resultado.pendientes
      .map((p) => `${p.tabla}: ${p.sinNegocio}`)
      .join(', ');

    return {
      correcto: false,
      mensaje: `La migración dejó registros sin negocio: ${detalle}`,
    };
  }

  return {
    correcto: true,
    mensaje: `No queda ningún registro sin negocio (${resultado.total} asignados)`,
  };
}

/** Claves operativas que deben existir en el ámbito del negocio. */
export const CLAVES_A_VERIFICAR = CLAVES_CONFIGURACION_OPERATIVA.map(
  (config) => config.clave,
);
