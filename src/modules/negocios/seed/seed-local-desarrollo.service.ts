import { Prisma, PrismaClient } from '../../../../generated/prisma/client';
import { WeekDay } from '../../../../generated/prisma/enums';
import { enSerie } from '../../../common/utils/en-serie';
import {
  CLAVES_CONFIGURACION_OPERATIVA,
  TipoConfiguracion,
} from '../../configuracion/configuracion.constants';
import {
  decidirConfiguracionOperativa,
  decidirCreacionNegocioAdicional,
  decidirInicializacion,
} from '../migracion/migracion-negocio.service';
import {
  BASES_DATOS_PROHIBIDAS,
  BASE_DATOS_PERMITIDA,
  horarioSemanalLocal,
  HOSTS_LOCALES_PERMITIDOS,
  MIGRACION_SUPERADMIN_POR_NEGOCIO,
  NEGOCIOS_LOCALES,
  PersonaLocalSpec,
  REGEX_HOST_RAILWAY,
  SERVICIOS_LOCALES,
} from './seed-local-desarrollo.constants';

/**
 * SEMILLA DE DESARROLLO LOCAL MULTITENANT (Fase 13).
 *
 * Provisiona el escenario de prueba inicial de las DOS barberías del entorno
 * local (`bd_barberia_multitenant_dev`):
 *
 * - Dos negocios: `KYRIOS STUDIO` y `BARBERÍA DEMO 2`.
 * - La configuración operativa PROPIA de cada negocio (ámbitos separados del
 *   global), con los valores por defecto de la implementación actual.
 * - Dos superadministradores por negocio, como MEMBRESÍAS
 *   (`Administrador.superadmin = true`). NO se asigna ningún SUPERADMIN global.
 * - Dos barberos y tres servicios por negocio, con sus relaciones y su
 *   horario semanal.
 *
 * GARANTÍAS
 * ---------
 * - IDEMPOTENTE: se puede ejecutar tantas veces como se quiera; no duplica
 *   negocios, personas, membresías, barberos, servicios, relaciones ni
 *   franjas, y NO sobrescribe lo que ya estuviera personalizado.
 * - CONSERVADORA: no borra ni reemplaza datos. Si un servicio ya existe con
 *   otro precio, conserva su precio; si una configuración del negocio ya
 *   existe, conserva su valor.
 * - CONFLICTO = ERROR: ante una identidad ambigua o un negocio ajeno al
 *   escenario, se DETIENE con un error claro. No repara datos arbitrariamente.
 * - SIN PRIVILEGIOS GLOBALES: los roles efectivos salen de las MEMBRESÍAS.
 *   `Usuario.rol` se deja en `PERSONAL` (informativo) y no se usa para
 *   autorizar nada.
 */

/** Veredicto de una comprobación previa. */
export interface Verificacion {
  ok: boolean;
  motivo?: string;
}

/** Acción aplicada sobre una entidad. */
export type AccionSeed =
  'creado' | 'reutilizado' | 'actualizado' | 'sin-cambios';

/** Resultado del provisionamiento de un negocio. */
export interface ReporteNegocio {
  slug: string;
  nombre: string;
  negocioId: number;
  accion: AccionSeed;
  superadmins: Array<{
    email: string;
    usuarioId: number;
    membresiaId: number;
    superadmin: boolean;
    accion: AccionSeed;
  }>;
  barberos: Array<{
    clave: string;
    email: string;
    usuarioId: number;
    barberoId: number;
    accion: AccionSeed;
  }>;
  servicios: Array<{ nombre: string; servicioId: number; accion: AccionSeed }>;
  relaciones: number;
  franjas: number;
}

/** Conteos verificados contra la base de datos tras el provisionamiento. */
export interface ConteosNegocio {
  slug: string;
  administradores: number;
  superadmins: number;
  barberos: number;
  servicios: number;
  relaciones: number;
  franjas: number;
}

/** Informe completo del seed. */
export interface ReporteSeed {
  negocios: ReporteNegocio[];
  conteos: ConteosNegocio[];
  avisos: string[];
}

/** Cliente transaccional de Prisma. */
type Cliente = Prisma.TransactionClient;

/**
 * Comprueba que la URL de conexión apunta al entorno LOCAL permitido.
 *
 * Rechaza:
 * - Cualquier base de datos que no sea `bd_barberia_multitenant_dev`.
 * - La base legada `bd_barberia`.
 * - Los hosts de Railway (por patrón) y cualquier host que no sea local.
 */
export function verificarDestinoDeSeed(url: string): Verificacion {
  let destino: URL;

  try {
    destino = new URL(url);
  } catch {
    return { ok: false, motivo: `DATABASE_URL no es una URL válida: "${url}"` };
  }

  const base = decodeURIComponent(destino.pathname.replace(/^\//, ''));

  if (BASES_DATOS_PROHIBIDAS.includes(base)) {
    return {
      ok: false,
      motivo:
        `La base "${base}" tiene datos que deben conservarse y NUNCA es destino ` +
        'de esta semilla. Usa la base multitenant de desarrollo.',
    };
  }

  if (base !== BASE_DATOS_PERMITIDA) {
    return {
      ok: false,
      motivo:
        `La semilla de desarrollo local solo se ejecuta sobre "${BASE_DATOS_PERMITIDA}". ` +
        `La URL apunta a "${base || '(sin base)'}".`,
    };
  }

  const host = destino.hostname.toLowerCase();

  if (REGEX_HOST_RAILWAY.test(host)) {
    return {
      ok: false,
      motivo:
        `El host "${host}" pertenece a Railway: esta semilla es EXCLUSIVA del ` +
        'entorno local de desarrollo.',
    };
  }

  if (!HOSTS_LOCALES_PERMITIDOS.includes(host)) {
    return {
      ok: false,
      motivo:
        `El host "${host}" no es un host local admitido ` +
        `(${HOSTS_LOCALES_PERMITIDOS.join(', ')}).`,
    };
  }

  return { ok: true };
}

/**
 * Comprueba que el historial de migraciones está completo y sano.
 *
 * - La tabla `_prisma_migrations` debe existir (la base se construyó con
 *   `prisma migrate deploy`).
 * - No debe haber migraciones a medias (`finished_at` nulo).
 * - Las migraciones aplicadas deben ser EXACTAMENTE las del repositorio.
 * - La migración que añade `Administrador.superadmin` debe estar aplicada.
 */
export async function verificarHistorialDeMigraciones(
  prisma: PrismaClient,
  esperadas: readonly string[],
): Promise<Verificacion & { aplicadas?: string[] }> {
  let filas: Array<{
    migration_name: string;
    finished_at: Date | null;
    rolled_back_at: Date | null;
  }>;

  try {
    filas = await prisma.$queryRaw<
      Array<{
        migration_name: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
      }>
    >`SELECT migration_name, finished_at, rolled_back_at FROM \`_prisma_migrations\``;
  } catch {
    return {
      ok: false,
      motivo:
        'La base no tiene historial de migraciones (`_prisma_migrations`). ' +
        'Aplica primero las migraciones (`npm run db:migrate:dev`).',
    };
  }

  const aMedias = filas.filter(
    (fila) => fila.finished_at === null && fila.rolled_back_at === null,
  );

  if (aMedias.length > 0) {
    return {
      ok: false,
      motivo:
        'Hay migraciones a medias (ni aplicadas ni revertidas): ' +
        `${aMedias.map((f) => f.migration_name).join(', ')}. ` +
        'Resuélvelas con `prisma migrate resolve` antes de sembrar.',
    };
  }

  const aplicadas = filas
    .filter((fila) => fila.finished_at !== null && fila.rolled_back_at === null)
    .map((fila) => fila.migration_name);

  const faltantes = esperadas.filter((m) => !aplicadas.includes(m));

  if (faltantes.length > 0) {
    return {
      ok: false,
      motivo: `Faltan migraciones por aplicar: ${faltantes.join(', ')}.`,
    };
  }

  const desconocidas = aplicadas.filter((m) => !esperadas.includes(m));

  if (desconocidas.length > 0) {
    return {
      ok: false,
      motivo:
        'La base tiene migraciones que el repositorio no conoce: ' +
        `${desconocidas.join(', ')}.`,
    };
  }

  if (!aplicadas.includes(MIGRACION_SUPERADMIN_POR_NEGOCIO)) {
    return {
      ok: false,
      motivo:
        `La migración "${MIGRACION_SUPERADMIN_POR_NEGOCIO}" (columna ` +
        '`Administrador.superadmin`) no está aplicada: el modelo de ' +
        'privilegios no sería el esperado y la semilla no debe escribir.',
    };
  }

  return { ok: true, aplicadas };
}

/**
 * Resuelve la persona de un correo canónico.
 *
 * - Si existe: se reutiliza su `id` y NO se toca nada (ni correo, ni nombre,
 *   ni `googleId`, ni rol, ni estado).
 * - Si no existe y hay una cuenta "parecida" (mismo alias local en otro
 *   dominio): CONFLICTO. No se crea ni se corrige nada.
 * - Si no existe: se crea en la base de desarrollo con el nombre que ya
 *   figura en el código para ese correo, rol informativo `PERSONAL` y SIN
 *   `googleId` (se enlaza en su primer acceso con Google).
 */
async function resolverPersona(
  tx: Cliente,
  persona: PersonaLocalSpec,
): Promise<{ id: number; accion: AccionSeed }> {
  const existente = await tx.usuario.findUnique({
    where: { email: persona.email },
    select: { id: true },
  });

  if (existente) {
    return { id: existente.id, accion: 'reutilizado' };
  }

  const alias = (persona.email.split('@')[0] ?? '').toLowerCase();
  const similares = await tx.usuario.findMany({
    where: { email: { contains: alias } },
    select: { email: true },
  });

  if (similares.length > 0) {
    throw new Error(
      `Conflicto de identidad: no existe "${persona.email}", pero sí hay cuentas ` +
        `parecidas (${similares.map((c) => c.email).join(', ')}). No se crea ni se ` +
        'modifica nada: confirma la identidad y repite la ejecución.',
    );
  }

  const creado = await tx.usuario.create({
    data: {
      email: persona.email,
      nombre: persona.nombre,
      apellido: persona.apellido,
      // Valor global INFORMATIVO. El carácter SUPERADMIN vive en la
      // membresía (`Administrador.superadmin`), nunca aquí.
      rol: 'PERSONAL',
      estado: 'ACTIVO',
      googleId: null,
    },
    select: { id: true },
  });

  return { id: creado.id, accion: 'creado' };
}

type SpecNegocio = (typeof NEGOCIOS_LOCALES)[number];
type SpecBarbero = SpecNegocio['barberos'][number];
type SpecServicio = (typeof SERVICIOS_LOCALES)[number];
type ConfigOperativa = (typeof CLAVES_CONFIGURACION_OPERATIVA)[number];

/**
 * Paso 1: crea o reutiliza el negocio.
 *
 * El primer negocio de una plataforma nueva usa el mecanismo de
 * inicialización de la Fase 2; los siguientes, el mecanismo explícito de
 * negocio adicional. Ambos validan nombre y slug igual.
 */
async function resolverNegocio(
  tx: Cliente,
  spec: SpecNegocio,
): Promise<{ negocioId: number; accion: AccionSeed }> {
  const [negocioConSlug, totalNegocios] = await Promise.all([
    tx.negocio.findUnique({
      where: { slug: spec.slug },
      select: { id: true, slug: true, nombre: true },
    }),
    tx.negocio.count(),
  ]);

  const datos = { nombre: spec.nombre, slug: spec.slug };
  const decision =
    totalNegocios === 0
      ? decidirInicializacion(datos, { totalNegocios })
      : decidirCreacionNegocioAdicional(datos, {
          negocioConSlug: negocioConSlug ?? undefined,
        });

  if (decision.accion === 'rechazar') {
    throw new Error(decision.motivo);
  }

  if (decision.accion === 'reutilizar') {
    return { negocioId: decision.negocioId, accion: 'reutilizado' };
  }

  const creado = await tx.negocio.create({
    data: { slug: decision.slug, nombre: decision.nombre, estado: 'ACTIVO' },
    select: { id: true },
  });

  return { negocioId: creado.id, accion: 'creado' };
}

/** Paso 2: una clave de configuración operativa PROPIA del negocio. */
async function provisionarConfiguracion(
  tx: Cliente,
  negocioId: number,
  slug: string,
  config: ConfigOperativa,
  avisos: string[],
): Promise<void> {
  const whereNegocio = { negocioId_clave: { negocioId, clave: config.clave } };

  const [global, enNegocio] = await Promise.all([
    tx.configuracionSistema.findUnique({
      where: { clave: config.clave },
      select: { valor: true, tipo: true, descripcion: true },
    }),
    tx.configuracionNegocio.findUnique({
      where: whereNegocio,
      select: { valor: true },
    }),
  ]);

  const decisionConfig = decidirConfiguracionOperativa(config, {
    valorEnNegocio: enNegocio ?? undefined,
    valorGlobal: global ?? undefined,
  });

  if (decisionConfig.accion === 'conservar') {
    // El VALOR se conserva: puede estar personalizado por un administrador.
    // El `tipo` y la `descripcion` son METADATOS de la clave: se alinean con
    // la definición de la implementación (un tipo equivocado hace que la
    // aplicación descarte el valor al leerlo).
    await tx.configuracionNegocio.update({
      where: whereNegocio,
      data: { tipo: config.tipo, descripcion: config.descripcion },
    });

    avisos.push(
      `Configuración '${config.clave}' de '${slug}' ya existe ` +
        `(valor='${decisionConfig.valor}'): se conserva su valor; se alinean ` +
        'tipo y descripción con la definición de la clave.',
    );
    return;
  }

  await tx.configuracionNegocio.upsert({
    where: whereNegocio,
    update: {},
    create: {
      negocioId,
      clave: config.clave,
      valor: decisionConfig.valor,
      tipo: decisionConfig.tipo as TipoConfiguracion,
      descripcion: decisionConfig.descripcion,
      editable: true,
    },
  });
}

/** Crea, reactiva o conserva la membresía SUPERADMIN de una persona. */
async function asegurarMembresiaSuperadmin(
  tx: Cliente,
  negocioId: number,
  usuarioId: number,
): Promise<{ membresiaId: number; accion: AccionSeed }> {
  const membresia = await tx.administrador.findUnique({
    where: { negocioId_usuarioId: { negocioId, usuarioId } },
    select: { id: true, superadmin: true, estado: true },
  });

  if (!membresia) {
    const creada = await tx.administrador.create({
      data: { usuarioId, negocioId, estado: 'ACTIVO', superadmin: true },
      select: { id: true },
    });
    return { membresiaId: creada.id, accion: 'creado' };
  }

  if (membresia.superadmin && membresia.estado === 'ACTIVO') {
    return { membresiaId: membresia.id, accion: 'sin-cambios' };
  }

  await tx.administrador.update({
    where: { id: membresia.id },
    data: { superadmin: true, estado: 'ACTIVO' },
  });
  return { membresiaId: membresia.id, accion: 'actualizado' };
}

/** Paso 3: un superadministrador (MEMBRESÍA, no rol global). */
async function provisionarSuperadmin(
  tx: Cliente,
  negocioId: number,
  persona: PersonaLocalSpec,
  avisos: string[],
): Promise<ReporteNegocio['superadmins'][number]> {
  const usuario = await resolverPersona(tx, persona);

  if (usuario.accion === 'creado') {
    avisos.push(
      `Usuario "${persona.email}" creado en la base de desarrollo (rol informativo ` +
        'PERSONAL, sin googleId: se enlaza en su primer acceso con Google).',
    );
  }

  const { membresiaId, accion } = await asegurarMembresiaSuperadmin(
    tx,
    negocioId,
    usuario.id,
  );

  // La persona NO debe tener membresía en OTROS negocios: no se crean
  // perfiles cruzados ni se revocan los que ya hubiera.
  const otras = await tx.administrador.findMany({
    where: { usuarioId: usuario.id, negocioId: { not: negocioId } },
    select: { negocio: { select: { slug: true } } },
  });

  if (otras.length > 0) {
    const slugsOtras = otras.map((o) => `'${o.negocio.slug}'`).join(', ');
    avisos.push(
      `"${persona.email}" ya tiene membresía en ${slugsOtras}: no se ha modificado nada allí.`,
    );
  }

  return {
    email: persona.email,
    usuarioId: usuario.id,
    membresiaId,
    superadmin: true,
    accion,
  };
}

/** Paso 4: un barbero de prueba. */
async function provisionarBarbero(
  tx: Cliente,
  negocioId: number,
  slug: string,
  barbero: SpecBarbero,
  dominioCorreoPrueba: string,
): Promise<ReporteNegocio['barberos'][number]> {
  const email = `${slug}.${barbero.clave}@${dominioCorreoPrueba}`;

  const usuario = await tx.usuario.upsert({
    where: { email },
    update: {},
    create: {
      email,
      nombre: barbero.nombre,
      apellido: barbero.apellido,
      rol: 'PERSONAL',
      estado: 'ACTIVO',
      googleId: null,
    },
    select: { id: true },
  });

  const claveBarbero = {
    negocioId_usuarioId: { negocioId, usuarioId: usuario.id },
  };

  const existente = await tx.barbero.findUnique({
    where: claveBarbero,
    select: { id: true },
  });

  const creado = await tx.barbero.upsert({
    where: claveBarbero,
    update: {},
    create: {
      usuarioId: usuario.id,
      negocioId,
      telefono: barbero.telefono,
      porcentajeComision: barbero.porcentajeComision,
      estado: 'ACTIVO',
    },
    select: { id: true },
  });

  return {
    clave: barbero.clave,
    email,
    usuarioId: usuario.id,
    barberoId: creado.id,
    accion: existente ? 'reutilizado' : 'creado',
  };
}

/** Paso 5: un servicio del catálogo. */
async function provisionarServicio(
  tx: Cliente,
  negocioId: number,
  servicio: SpecServicio,
): Promise<ReporteNegocio['servicios'][number]> {
  const clave = { negocioId_nombre: { negocioId, nombre: servicio.nombre } };

  const existente = await tx.servicio.findUnique({
    where: clave,
    select: { id: true },
  });

  const creado = await tx.servicio.upsert({
    where: clave,
    // `update: {}`: un precio ya personalizado NO se sobrescribe.
    update: {},
    create: {
      nombre: servicio.nombre,
      descripcion: servicio.descripcion,
      precio: servicio.precio,
      duracionMinutos: servicio.duracionMinutos,
      estado: 'ACTIVO',
      negocioId,
    },
    select: { id: true },
  });

  return {
    nombre: servicio.nombre,
    servicioId: creado.id,
    accion: existente ? 'reutilizado' : 'creado',
  };
}

/** Paso 6: relaciones barbero-servicio (dentro del MISMO negocio). */
async function provisionarRelaciones(
  tx: Cliente,
  negocioId: number,
  barberoIds: number[],
  servicioIds: number[],
): Promise<number> {
  const pares = barberoIds.flatMap((barberoId) =>
    servicioIds.map((servicioId) => ({ barberoId, servicioId })),
  );

  await enSerie(pares, ({ barberoId, servicioId }) =>
    tx.barberoServicio.upsert({
      where: { barberoId_servicioId: { barberoId, servicioId } },
      update: {},
      create: { barberoId, servicioId, negocioId },
    }),
  );

  return pares.length;
}

/** Paso 7: horario semanal de cada barbero. */
async function provisionarFranjas(
  tx: Cliente,
  negocioId: number,
  barberoIds: number[],
): Promise<number> {
  const franjas = barberoIds.flatMap((barberoId) =>
    horarioSemanalLocal().map((franja) => ({ barberoId, ...franja })),
  );

  await enSerie(franjas, (franja) => {
    const dayOfWeek = franja.dayOfWeek as WeekDay;
    return tx.barberWeeklySlot.upsert({
      where: {
        barberoId_dayOfWeek_startTime: {
          barberoId: franja.barberoId,
          dayOfWeek,
          startTime: franja.startTime,
        },
        negocioId,
      },
      update: { endTime: franja.endTime, active: true },
      create: {
        barberoId: franja.barberoId,
        negocioId,
        dayOfWeek,
        startTime: franja.startTime,
        endTime: franja.endTime,
        active: true,
      },
    });
  });

  return franjas.length;
}

/**
 * Provisiona un negocio completo.
 *
 * Los pasos se ejecutan EN SERIE dentro de la misma transacción: cada uno
 * puede depender de lo que dejó el anterior (p. ej. la detección de
 * identidades parecidas en `resolverPersona`).
 */
async function provisionarNegocio(
  tx: Cliente,
  spec: SpecNegocio,
  dominioCorreoPrueba: string,
  avisos: string[],
): Promise<ReporteNegocio> {
  const { negocioId, accion } = await resolverNegocio(tx, spec);

  await enSerie(CLAVES_CONFIGURACION_OPERATIVA, (config) =>
    provisionarConfiguracion(tx, negocioId, spec.slug, config, avisos),
  );

  const superadmins = await enSerie(spec.superadmins, (persona) =>
    provisionarSuperadmin(tx, negocioId, persona, avisos),
  );

  const barberos = await enSerie(spec.barberos, (barbero) =>
    provisionarBarbero(tx, negocioId, spec.slug, barbero, dominioCorreoPrueba),
  );

  const servicios = await enSerie(SERVICIOS_LOCALES, (servicio) =>
    provisionarServicio(tx, negocioId, servicio),
  );

  const barberoIds = barberos.map((b) => b.barberoId);
  const servicioIds = servicios.map((s) => s.servicioId);

  const relaciones = await provisionarRelaciones(
    tx,
    negocioId,
    barberoIds,
    servicioIds,
  );
  const franjas = await provisionarFranjas(tx, negocioId, barberoIds);

  return {
    slug: spec.slug,
    nombre: spec.nombre,
    negocioId,
    accion,
    superadmins,
    barberos,
    servicios,
    relaciones,
    franjas,
  };
}

/** Conteos verificados contra la base de datos de un negocio. */
async function contarNegocio(
  prisma: PrismaClient,
  report: ReporteNegocio,
): Promise<ConteosNegocio> {
  const negocioId = report.negocioId;
  const [
    administradores,
    superadmins,
    barberos,
    servicios,
    relaciones,
    franjas,
  ] = await Promise.all([
    prisma.administrador.count({ where: { negocioId } }),
    prisma.administrador.count({ where: { negocioId, superadmin: true } }),
    prisma.barbero.count({ where: { negocioId } }),
    prisma.servicio.count({ where: { negocioId } }),
    prisma.barberoServicio.count({ where: { negocioId } }),
    prisma.barberWeeklySlot.count({ where: { negocioId } }),
  ]);

  return {
    slug: report.slug,
    administradores,
    superadmins,
    barberos,
    servicios,
    relaciones,
    franjas,
  };
}

/**
 * Provisiona el escenario completo de las dos barberías.
 *
 * @param prisma Cliente de Prisma sobre la base de desarrollo local.
 * @param opciones `dominioCorreoPrueba`: dominio de las cuentas de barbero de
 *   prueba (por defecto, un TLD reservado `.invalid`).
 */
export async function sembrarDesarrolloLocal(
  prisma: PrismaClient,
  opciones: { dominioCorreoPrueba?: string } = {},
): Promise<ReporteSeed> {
  const avisos: string[] = [];

  // --- Comprobación previa: el escenario debe ser EXACTAMENTE el esperado --
  const slugsEsperados = new Set<string>(NEGOCIOS_LOCALES.map((n) => n.slug));

  const existentes = await prisma.negocio.findMany({
    select: { slug: true, nombre: true },
  });

  const ajenos = existentes.filter((n) => !slugsEsperados.has(n.slug));

  if (ajenos.length > 0) {
    const descAjenos = ajenos
      .map((n) => `'${n.slug}' (${n.nombre})`)
      .join(', ');
    throw new Error(
      `La base ya contiene negocios ajenos al escenario de prueba local: ${descAjenos}. No se borra ni se modifica ningún negocio: revisa la base a mano.`,
    );
  }

  const dominio = opciones.dominioCorreoPrueba ?? 'local.invalid';

  // Una transacción por negocio, en serie: el primero puede ser el que
  // inicializa la plataforma y el segundo depende de que ya exista.
  const negocios = await enSerie(NEGOCIOS_LOCALES, (spec) =>
    prisma.$transaction(
      async (tx) => provisionarNegocio(tx, spec, dominio, avisos),
      { timeout: 120_000, maxWait: 20_000 },
    ),
  );

  const conteos = await Promise.all(
    negocios.map((report) => contarNegocio(prisma, report)),
  );

  return { negocios, conteos, avisos };
}
