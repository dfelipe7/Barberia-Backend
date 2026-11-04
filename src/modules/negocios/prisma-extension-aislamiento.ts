import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { esModeloTenantScoped } from './aislamiento.constants';
import { obtenerContextoNegocio } from './negocio-almacenamiento';

/**
 * Extensión de Prisma que actúa como DEFENSA ADICIONAL del aislamiento por
 * negocio.
 *
 * QUÉ HACE Y QUÉ NO HACE
 * -----------------------
 * La CAPA PRINCIPAL del aislamiento son los filtros explícitos de cada
 * repositorio (`NegocioAislamientoService`). Esta extensión es la segunda
 * capa: si un repositorio olvidara un filtro, la extensión lo suple. Ninguna
 * de las dos capas sustituye a la otra.
 *
 * LÍMITES REALES, verificados empíricamente contra MariaDB 11:
 *
 *  1. **No intercepta escrituras anidadas.** Una operación como
 *     `servicio.create({ data: { barberos: { create: [...] } } })` produce
 *     UNA sola operación de Prisma (`Servicio.create`): las filas anidadas se
 *     crean dentro de la misma sentencia y NO pasan por la extensión. Para
 *     esas escrituras, el `negocioId` lo deben fijar los repositorios.
 *  2. **No intercepta `$queryRaw` / `$executeRaw` / variantes `Unsafe`.** El
 *     SQL crudo se ejecuta fuera del mecanismo de delegates, por lo que el
 *     filtro debe añadirse a mano en la consulta (ver
 *     `ReservasRepository.crearConBloqueo`).
 *  3. **No intercepta `$transaction`**: el filtrado se aplica dentro de
 *     cada operación de la transacción, que es el comportamiento buscado.
 *
 * OPERACIONES CUBIERTAS
 * ---------------------
 * Todas las operaciones de delegate sobre modelos tenant-scoped: `findUnique`,
 * `findUniqueOrThrow`, `findFirst`, `findFirstOrThrow`, `findMany`,
 * `create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`,
 * `deleteMany`, `aggregate`, `count`, `groupBy`.
 *
 * Para las operaciones de LECTURA, el filtro de negocio se integra en el
 * `where` de la consulta: la base de datos nunca llega a devolver filas de
 * otro negocio.
 *
 * Para las operaciones de ESCRITURA, el `negocioId` se fuerza al del
 * contexto, de modo que un cliente no pueda escribir en otro negocio.
 */

/** Operaciones que solo leen: en ellas el negocio va en el `where`. */
const OPERACIONES_DE_LECTURA = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'aggregate',
  'count',
  'groupBy',
]);

/**
 * Operaciones de escritura en las que el `negocioId` se fuerza en el `data`.
 */
const OPERACIONES_DE_ESCRITURA = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

/** `where` de una operación de Prisma, como objeto plano. */
type WherePrisma = Record<string, unknown>;

/** `data` de una operación de escritura de Prisma, como objeto plano. */
type DataPrisma = Record<string, unknown>;

/** Argumentos de una operación de delegate, en forma plana. */
interface ArgsOperacion {
  where?: WherePrisma;
  data?: DataPrisma;
  create?: DataPrisma;
  [clave: string]: unknown;
}

/**
 * Construye la extensión de Prisma de aislamiento por negocio.
 *
 * El negocio se obtiene del almacén compartido
 * (`ContextoNegocioAlmacenamiento`), que lo rellena exclusivamente con el
 * contexto validado por el servidor. NUNCA se toma del cuerpo de la
 * petición.
 */
export function crearExtensionAislamientoNegocio() {
  return Prisma.defineExtension({
    name: 'aislamiento-negocio',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!esModeloTenantScoped(model)) {
            // Modelos globales (Usuario, Negocio, ConfiguracionSistema,
            // WhatsAppPlantilla): NO se filtran.
            return query(args);
          }

          const contexto = obtenerContextoNegocio();

          if (!contexto) {
            // Fallo SEGURO: sin contexto no se puede saber a qué negocio
            // pertenece la fila, y aplicarlo sobre todos los negocios sería
            // una fuga. Se rechaza antes de tocar la base de datos.
            throw new ForbiddenException(
              `La operación sobre '${model}.${operation}' requiere un contexto de negocio autorizado`,
            );
          }

          const argumentos = args as ArgsOperacion;

          if (OPERACIONES_DE_LECTURA.has(operation)) {
            return query(inyectarFiltroLectura(argumentos, contexto.id));
          }

          if (operation === 'upsert') {
            return query(acotarUpsert(argumentos, contexto.id));
          }

          if (OPERACIONES_DE_ESCRITURA.has(operation)) {
            return query(
              forzarNegocioEnEscritura(argumentos, contexto.id, operation),
            );
          }

          return query(args);
        },
      },
    },
  });
}

/**
 * Devuelve el `negocioId` de un objeto cuando es un número, o `undefined`.
 *
 * Un valor `null` significa "sin negocio" (registro todavía no asignado) y no
 * se considera un conflicto.
 */
function negocioIdDeclarado(
  objeto: WherePrisma | DataPrisma,
): number | undefined {
  const valor = objeto.negocioId;

  return typeof valor === 'number' ? valor : undefined;
}

/**
 * Inyecta el filtro de negocio en el `where` de una lectura.
 *
 * `findUnique` acepta en Prisma 7 filtros adicionales junto a la clave
 * única (verificado contra MariaDB 11): el motor resuelve la clave única y
 * descarta la fila si no cumple el resto de condiciones. Para el resto de
 * lecturas, el filtro se aplica como una condición más del `where`.
 */
function inyectarFiltroLectura(
  args: ArgsOperacion,
  negocioId: number,
): ArgsOperacion {
  const where = args.where ?? {};

  // Un filtro de negocio ya presente y DISTINTO del contexto es un
  // intento de cruzar negocios: se rechaza en lugar de "corregirlo".
  const declarado = negocioIdDeclarado(where);

  if (declarado !== undefined && declarado !== negocioId) {
    throw new ForbiddenException(
      'La operación solicita datos de un negocio distinto del autorizado',
    );
  }

  return {
    ...args,
    where: { ...where, negocioId },
  };
}

/**
 * Acota un `upsert` al negocio activo.
 *
 * `upsert` localiza el registro existente por una clave ÚNICA, no por el
 * filtro de negocio: sin más, un `upsert` cuya clave no incluye el negocio
 * podría modificar el registro de otro negocio o CREAR uno sin negocio
 * (comprobado contra MariaDB 11: la fila creada quedaba con
 * `negocioId = null`).
 *
 * Se actúa en dos fronts:
 *  - el `where` recibe el filtro de negocio, de modo que solo se localiza un
 *    registro del negocio activo (comportamiento verificado en Prisma 7);
 *  - el `create` incluye el `negocioId` forzado, para que una fila NUEVA
 *    nazca dentro del ámbito.
 */
function acotarUpsert(args: ArgsOperacion, negocioId: number): ArgsOperacion {
  const where = args.where ?? {};

  const declaradoWhere = negocioIdDeclarado(where);

  if (declaradoWhere !== undefined && declaradoWhere !== negocioId) {
    throw new ForbiddenException(
      'La operación intenta modificar datos de un negocio distinto del autorizado',
    );
  }

  const create = args.create;

  if (create) {
    const declaradoCreate = negocioIdDeclarado(create);

    if (declaradoCreate !== undefined && declaradoCreate !== negocioId) {
      throw new ForbiddenException(
        'La operación intenta escribir en un negocio distinto del autorizado',
      );
    }
  }

  return {
    ...args,
    where: { ...where, negocioId },
    create: create === undefined ? create : { ...create, negocioId },
  };
}

/**
 * Fuerza el `negocioId` del contexto en una escritura.
 *
 * Principio de Inmutabilidad del Tenant:
 * - `create` / `createMany`: el `data` lleva el `negocioId` forzado para que el registro
 *   nazca asignado al negocio del contexto.
 * - `update` / `updateMany` / `delete` / `deleteMany`: el aislamiento se aplica estrictamente
 *   en el `where` (`where: { ...where, negocioId }`). En `update` NO se inyecta `negocioId`
 *   en `data` porque en Prisma los campos de relación son inmutables y no existen en los DTOs de
 *   actualización generados (evita el error 'Unknown argument negocioId').
 */
function forzarNegocioEnEscritura(
  args: ArgsOperacion,
  negocioId: number,
  operation?: string,
): ArgsOperacion {
  const where = args.where;

  if (where) {
    const declarado = negocioIdDeclarado(where);

    if (declarado !== undefined && declarado !== negocioId) {
      throw new ForbiddenException(
        'La operación intenta modificar datos de un negocio distinto del autorizado',
      );
    }
  }

  const data = args.data;

  if (data) {
    const declarado = negocioIdDeclarado(data);

    if (declarado !== undefined && declarado !== negocioId) {
      throw new ForbiddenException(
        'La operación intenta escribir en un negocio distinto del autorizado',
      );
    }
  }

  const resultado: ArgsOperacion = { ...args };
  const esCreacion = operation === 'create' || operation === 'createMany';

  if (data !== undefined) {
    if (esCreacion) {
      // Creación (INSERT): forzamos negocioId para que el nuevo registro nazca con su dueño
      if (Array.isArray(data)) {
        resultado.data = data.map((item) => ({ ...item, negocioId })) as any;
      } else {
        resultado.data = { ...data, negocioId };
      }
    } else if (
      // Actualización (UPDATE): el aislamiento vive en el WHERE. Si data traía negocioId plano,
      // lo removemos para evitar colisiones con el esquema de Prisma (Unknown argument negocioId).
      typeof data === 'object' &&
      !Array.isArray(data) &&
      'negocioId' in data
    ) {
      const dataLimpio = { ...(data as Record<string, unknown>) };
      delete dataLimpio.negocioId;
      resultado.data = dataLimpio;
    }
  }

  if (where !== undefined) {
    resultado.where = { ...where, negocioId };
  }

  return resultado;
}
