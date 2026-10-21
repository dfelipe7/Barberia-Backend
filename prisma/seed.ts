import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * =============================================================================
 * ESTE SEED **NO DEBE EJECUTARSE TODAVÍA** (Fase 12).
 * =============================================================================
 *
 * Escribe un aviso, no un comportamiento: el fichero sigue intacto. La
 * corrección llega en la siguiente fase de PROVISIONAMIENTO, como un cambio
 * independiente y probado. Ejecutarlo ahora sería contraproducente por tres
 * motivos concretos y VERIFICABLES:
 *
 * 1) CREA SUPERADMIN GLOBALES, que ya no significan nada.
 *    El bloque "Superadministradores Fundadores" inserta cuatro personas con
 *    `rol: 'SUPERADMIN'` en la columna GLOBAL `Usuario.rol`. Desde la Fase 10
 *    ese valor es INFORMATIVO: no concede ningún privilegio. Sin una
 *    membresía `Administrador` en un negocio concreto, esas personas no
 *    derivan NINGÚN rol efectivo y ni siquiera pueden iniciar sesión
 *    (`GoogleAuthService` rechaza la sesión si no hay perfil activo). Es decir:
 *    el seed crearía usuarios que no pueden hacer nada, con un rol que parece
 *    otorgar el máximo poder de la plataforma.
 *
 * 2) MUTA CORREOS Y ROLES DE PERSONAS QUE YA EXISTEN.
 *    El bloque "Corrección preventiva de posibles correos previos con typo"
 *    hace `UPDATE` sobre usuarios ya creados (cambia su correo y su nombre).
 *    Automatizar ese cambio de identidad es exactamente lo que esta fase
 *    prohíbe: una corrección de correo debe ser una decisión explícita y
 *    revisada, no un efecto secundario de una siembra.
 *
 * 3) USA CRITERIOS DE UNICIDAD OBSOLETOS: NO COMPILA.
 *    `servicio.upsert({ where: { nombre } })` usa la unicidad GLOBAL de
 *    `Servicio.nombre`, que la Fase 8 sustituyó por `@@unique([negocioId,
 *    nombre])`. Además `Servicio.negocioId` es OBLIGATORIO. Resultado, al
 *    compilar el seed contra el esquema actual:
 *
 *      prisma/seed.ts(124,7): error TS2322: Type '{ nombre: string; }' is not
 *        assignable to type 'ServicioWhereUniqueInput'.
 *      prisma/seed.ts(126,7): error TS2322: Property 'negocio' is missing in
 *        type '{ nombre: string; ... }' but required in type 'ServicioCreateInput'.
 *
 *    O sea: `npm run seed` falla en `tsc` ANTES de tocar la base. No es un
 *    seed que "cree mal": es un seed incompatible con el modelo multitenant.
 *
 * QUÉ DEBE HACER LA SIGUIENTE FASE (provisionamiento):
 *   - Resolver el negocio (slug) antes de crear nada: todo lo tenant-scoped
 *     necesita `negocioId`.
 *   - Crear las MEMBRESÍAS (`Administrador` con `superadmin` por negocio), no
 *     roles globales.
 *   - Usar los selectores compuestos reales (`negocioId_nombre`,
 *     `negocioId_usuarioId`, ...).
 *   - No reescribir correos ni roles de personas existentes.
 *
 * ESTO YA ESTÁ RESUELTO (Fase 13): el provisionamiento de las dos barberías
 * del entorno local se hace con el comando EXCLUSIVO y verificable
 *     npm run seed:local:multitenant
 * que crea las MEMBRESÍAS (`Administrador.superadmin`), los barberos, los
 * servicios y el horario semanal, con salvaguardas de destino (solo
 * `bd_barberia_multitenant_dev`) y sin tocar este fichero.
 * =============================================================================
 */

const url = new URL(process.env.DATABASE_URL!);
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: Number(url.port),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.substring(1),
  connectionLimit: 5,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Iniciando siembra de datos (Seed)...');

  // Corrección preventiva de posibles correos previos con typo
  const prevJavier = await prisma.usuario.findUnique({ where: { email: 'javieraceron@unicauca.edu' } });
  if (prevJavier) {
    const yaExisteJavier = await prisma.usuario.findUnique({ where: { email: 'javieraceron@unicauca.edu.co' } });
    if (!yaExisteJavier) {
      await prisma.usuario.update({
        where: { id: prevJavier.id },
        data: { email: 'javieraceron@unicauca.edu.co', nombre: 'Javier Alexis', apellido: 'Anacona' },
      });
      console.log('🔄 Corregido correo de Javier Alexis a javieraceron@unicauca.edu.co');
    }
  }

  const prevSantiago = await prisma.usuario.findUnique({ where: { email: 'santiago@unicauca.edu.co' } });
  if (prevSantiago) {
    const yaExisteSantiago = await prisma.usuario.findUnique({ where: { email: 'csbalcazar@unicauca.edu.co' } });
    if (!yaExisteSantiago) {
      await prisma.usuario.update({
        where: { id: prevSantiago.id },
        data: { email: 'csbalcazar@unicauca.edu.co', nombre: 'Santiago', apellido: 'Balcazar' },
      });
      console.log('🔄 Corregido correo de Santiago a csbalcazar@unicauca.edu.co');
    }
  }

  // Superadministradores Fundadores
  const superadmins = [
    {
      email: 'armeroduvan8@gmail.com',
      nombre: 'Felipe',
      apellido: 'Armero',
      rol: 'SUPERADMIN' as const,
      estado: 'ACTIVO' as const,
    },
    {
      email: 'csbalcazar@unicauca.edu.co',
      nombre: 'Santiago',
      apellido: 'Balcazar',
      rol: 'SUPERADMIN' as const,
      estado: 'ACTIVO' as const,
    },
    {
      email: 'javieraceron@unicauca.edu.co',
      nombre: 'Javier Alexis',
      apellido: 'Anacona',
      rol: 'SUPERADMIN' as const,
      estado: 'ACTIVO' as const,
    },
    {
      email: 'rromero@unicauca.edu.co',
      nombre: 'Rubeiro',
      apellido: 'Romero',
      rol: 'SUPERADMIN' as const,
      estado: 'ACTIVO' as const,
    },
  ];

  for (const admin of superadmins) {
    const usuario = await prisma.usuario.upsert({
      where: { email: admin.email },
      update: {
        nombre: admin.nombre,
        apellido: admin.apellido,
        rol: admin.rol,
        estado: admin.estado,
      },
      create: {
        email: admin.email,
        nombre: admin.nombre,
        apellido: admin.apellido,
        rol: admin.rol,
        estado: admin.estado,
      },
    });
    console.log(`✅ Superadmin asegurado: ${usuario.nombre} ${usuario.apellido} (${usuario.email}) - Rol: ${usuario.rol}`);
  }

  // Servicios iniciales de la barbería
  const serviciosIniciales = [
    {
      nombre: 'Corte Clásico y Barba',
      descripcion: 'Corte tradicional de cabello con perfilado de barba a navaja y toalla caliente.',
      precio: 45000,
      duracionMinutos: 45,
      estado: 'ACTIVO' as const,
    },
    {
      nombre: 'Corte de Cabello Clásico',
      descripcion: 'Corte personalizado con tijera o máquina y peinado profesional.',
      precio: 30000,
      duracionMinutos: 30,
      estado: 'ACTIVO' as const,
    },
    {
      nombre: 'Perfilado y Afeitado de Barba',
      descripcion: 'Afeitado tradicional con navaja y tratamiento hidratante para barba.',
      precio: 20000,
      duracionMinutos: 25,
      estado: 'ACTIVO' as const,
    },
  ];

  for (const serv of serviciosIniciales) {
    await prisma.servicio.upsert({
      where: { nombre: serv.nombre },
      update: {},
      create: serv,
    });
  }
  console.log('✅ Servicios de la barbería listos.');

  // Configuración funcional GLOBAL de plataforma (parámetros editables en base
  // de datos).
  //
  // Desde la Fase 5, las políticas operativas de cada barbería viven en
  // `configuraciones_negocio` (las crea el `BootstrapService` de forma
  // idempotente, con estos mismos valores por defecto). Estas filas globales
  // se conservan como VALOR DE RESPALDO para los negocios que todavía no
  // tengan la clave (compatibilidad temporal).
  //
  // El upsert con `update: {}` es idempotente: crea la clave si falta y, si ya
  // existe, respeta el valor editado (no lo sobrescribe).
  const configuracionesPorDefecto = [
    {
      clave: 'reserva_cancelacion_antelacion_minutos',
      valor: '120',
      tipo: 'NUMERO' as const,
      descripcion:
        'Minutos mínimos de antelación para que un cliente cancele su reserva en línea.',
      editable: true,
    },
    {
      clave: 'reserva_no_show_tolerancia_minutos',
      valor: '15',
      tipo: 'NUMERO' as const,
      descripcion:
        'Minutos de tolerancia tras la hora de inicio antes de poder marcar una reserva como NO_SHOW.',
      editable: true,
    },
  ];

  for (const configuracion of configuracionesPorDefecto) {
    await prisma.configuracionSistema.upsert({
      where: { clave: configuracion.clave },
      update: {},
      create: configuracion,
    });
  }
  console.log('✅ Parámetros de configuración del sistema listos.');

  console.log('🎉 Siembra completada con éxito.');
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
