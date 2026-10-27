import 'dotenv/config';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { WeekDay } from '../../generated/prisma/enums';

const DIAS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

const FRANJAS = [
  { startTime: '09:00', endTime: '10:00' },
  { startTime: '10:00', endTime: '11:00' },
  { startTime: '11:00', endTime: '12:00' },
  { startTime: '12:00', endTime: '13:00' },
  { startTime: '14:00', endTime: '15:00' },
  { startTime: '15:00', endTime: '16:00' },
  { startTime: '16:00', endTime: '17:00' },
  { startTime: '17:00', endTime: '18:00' },
];

const SERVICIOS_BASE = [
  {
    nombre: 'Corte clásico',
    descripcion: 'Corte clásico con lavado y peinado',
    precio: 25000,
    duracionMinutos: 30,
  },
  {
    nombre: 'Degradado',
    descripcion: 'Degradado con acabado y perfilado',
    precio: 30000,
    duracionMinutos: 45,
  },
  {
    nombre: 'Arreglo de barba',
    descripcion: 'Arreglo de barba con toalla caliente',
    precio: 15000,
    duracionMinutos: 20,
  },
  {
    nombre: 'Corte + barba',
    descripcion: 'Combo corte y arreglo de barba',
    precio: 38000,
    duracionMinutos: 50,
  },
];

function crearPrisma(): PrismaClient {
  const url = new URL(process.env.DATABASE_URL!);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.substring(1),
    connectionLimit: 5,
  });
  return new PrismaClient({ adapter });
}

function derivarCorreo(base: string, sufijo: string): string {
  const [local, dominio] = base.split('@');
  if (!local || !dominio) return `${sufijo}@gmail.com`.toLowerCase();
  // Usar estilo google-like con +tag para facilitar identificación/cambio posterior
  return `${local}+${sufijo}@${dominio}`.toLowerCase();
}

async function main() {
  const prisma = crearPrisma();
  try {
    console.log('🌱 Seed completo multitenant (admins/barberos/servicios/franjas)...');

    const negocios = await prisma.negocio.findMany({
      where: { estado: 'ACTIVO' },
      orderBy: { id: 'asc' },
    });

    if (negocios.length === 0) {
      throw new Error('No hay negocios ACTIVO. Ejecuta primero multitenant:fundadores o crea los negocios.');
    }

    for (const negocio of negocios) {
      console.log(`\n🏪 [${negocio.slug}] ${negocio.nombre}`);

      // Superadmins existentes
      const superadmins = await prisma.administrador.findMany({
        where: { negocioId: negocio.id, superadmin: true, estado: 'ACTIVO' },
        include: { usuario: true },
        orderBy: { id: 'asc' },
      });

      if (superadmins.length === 0) {
        console.log('   ⚠️  Sin superadmin activo. Se recomienda ejecutar multitenant:fundadores primero.');
      } else {
        for (const s of superadmins) {
          console.log(`   👑 superadmin: ${s.usuario.email}`);
        }
      }

      const baseEmail = superadmins[0]?.usuario.email ?? `admin-${negocio.slug}@unicauca.edu.co`;

      // 2 administradores adicionales (no superadmin)
      const adminSpecs = [
        { sufijo: 'admin1', nombre: 'Admin', apellido: 'Uno' },
        { sufijo: 'admin2', nombre: 'Admin', apellido: 'Dos' },
      ];

      for (const spec of adminSpecs) {
        const email = derivarCorreo(baseEmail, spec.sufijo);
        let usuario = await prisma.usuario.findUnique({ where: { email } });
        if (!usuario) {
          usuario = await prisma.usuario.create({
            data: {
              email,
              nombre: spec.nombre,
              apellido: spec.apellido,
              rol: 'PERSONAL',
              estado: 'ACTIVO',
              googleId: `dev-${negocio.slug}-${spec.sufijo}-${Date.now()}`,
            },
          });
          console.log(`   + usuario creado: ${email}`);
        }
        const existente = await prisma.administrador.findUnique({
          where: { negocioId_usuarioId: { negocioId: negocio.id, usuarioId: usuario.id } },
        });
        if (!existente) {
          await prisma.administrador.create({
            data: { usuarioId: usuario.id, negocioId: negocio.id, estado: 'ACTIVO', superadmin: false },
          });
          console.log(`   + administrador añadido (no superadmin): ${email}`);
        } else {
          console.log(`   = administrador ya existe: ${email}`);
        }
      }

      // 2 barberos con comisiones distintas
      const barberoSpecs = [
        { sufijo: 'barbero1', nombre: 'Barbero', apellido: 'Uno', telefono: '+57-300-000-0001', comision: 35.0 },
        { sufijo: 'barbero2', nombre: 'Barbero', apellido: 'Dos', telefono: '+57-300-000-0002', comision: 45.0 },
      ];

      const barberoIds: number[] = [];
      for (const spec of barberoSpecs) {
        const email = derivarCorreo(baseEmail, spec.sufijo);
        let usuario = await prisma.usuario.findUnique({ where: { email } });
        if (!usuario) {
          usuario = await prisma.usuario.create({
            data: {
              email,
              nombre: spec.nombre,
              apellido: spec.apellido,
              rol: 'PERSONAL',
              estado: 'ACTIVO',
              googleId: `dev-${negocio.slug}-${spec.sufijo}-${Date.now()}`,
            },
          });
          console.log(`   + usuario creado: ${email}`);
        }
        const existente = await prisma.barbero.findUnique({
          where: { negocioId_usuarioId: { negocioId: negocio.id, usuarioId: usuario.id } },
        });
        if (!existente) {
          const b = await prisma.barbero.create({
            data: {
              usuarioId: usuario.id,
              negocioId: negocio.id,
              telefono: spec.telefono,
              porcentajeComision: spec.comision,
              estado: 'ACTIVO',
            },
          });
          barberoIds.push(b.id);
          console.log(`   + barbero creado: ${email} | comisión ${spec.comision}%`);
        } else {
          // asegurar comisión distinta si se desea, actualizar
          await prisma.barbero.update({
            where: { id: existente.id },
            data: { porcentajeComision: spec.comision, estado: 'ACTIVO', telefono: spec.telefono },
          });
          barberoIds.push(existente.id);
          console.log(`   = barbero actualizado: ${email} | comisión ${spec.comision}%`);
        }
      }

      // 4 servicios
      const servicioIds: number[] = [];
      for (const s of SERVICIOS_BASE) {
        const existente = await prisma.servicio.findUnique({
          where: { negocioId_nombre: { negocioId: negocio.id, nombre: s.nombre } },
        });
        if (!existente) {
          const creado = await prisma.servicio.create({
            data: {
              nombre: s.nombre,
              descripcion: s.descripcion,
              precio: s.precio,
              duracionMinutos: s.duracionMinutos,
              estado: 'ACTIVO',
              negocioId: negocio.id,
            },
          });
          servicioIds.push(creado.id);
          console.log(`   + servicio: ${s.nombre} ($${s.precio} / ${s.duracionMinutos}min)`);
        } else {
          await prisma.servicio.update({
            where: { id: existente.id },
            data: { precio: s.precio, duracionMinutos: s.duracionMinutos, estado: 'ACTIVO' },
          });
          servicioIds.push(existente.id);
          console.log(`   = servicio actualizado: ${s.nombre}`);
        }
      }

      // Asociar todos los servicios a ambos barberos
      for (const barberoId of barberoIds) {
        for (const servicioId of servicioIds) {
          await prisma.barberoServicio.upsert({
            where: { barberoId_servicioId: { barberoId, servicioId } },
            update: {},
            create: { barberoId, servicioId, negocioId: negocio.id },
          });
        }
      }
      console.log(`   🔗 BarberoServicio: ${barberoIds.length * servicioIds.length} relaciones`);

      // Franjas semanales completas (Lunes-Sábado) 09:00-18:00 por hora
      let franjas = 0;
      for (const barberoId of barberoIds) {
        for (const dia of DIAS) {
          for (const f of FRANJAS) {
            await prisma.barberWeeklySlot.upsert({
              where: {
                barberoId_dayOfWeek_startTime: {
                  barberoId,
                  dayOfWeek: dia as WeekDay,
                  startTime: f.startTime,
                },
              },
              update: { endTime: f.endTime, active: true },
              create: {
                barberoId,
                negocioId: negocio.id,
                dayOfWeek: dia as WeekDay,
                startTime: f.startTime,
                endTime: f.endTime,
                active: true,
              },
            });
            franjas++;
          }
        }
      }
      console.log(`   🗓️  Franjas semanales activas: ${franjas} (Lun-Sáb 09:00-18:00)`);
    }

    // Verificación final: los conteos deben cuadrar por negocio.
    console.log('\n🔎 Verificando conteos por negocio...');
    const esperado = { administradores: 4, superadmins: 2, barberos: 2, servicios: 4, relaciones: 8, franjas: 96 };
    let fallos = 0;
    for (const negocio of negocios) {
      const [administradores, superadmins, barberos, servicios, relaciones, franjas] = await Promise.all([
        prisma.administrador.count({ where: { negocioId: negocio.id } }),
        prisma.administrador.count({ where: { negocioId: negocio.id, superadmin: true } }),
        prisma.barbero.count({ where: { negocioId: negocio.id } }),
        prisma.servicio.count({ where: { negocioId: negocio.id } }),
        prisma.barberoServicio.count({ where: { negocioId: negocio.id } }),
        prisma.barberWeeklySlot.count({ where: { negocioId: negocio.id } }),
      ]);
      const real = { administradores, superadmins, barberos, servicios, relaciones, franjas };
      const mal = Object.entries(esperado).filter(([k, v]) => real[k as keyof typeof real] < v);
      if (mal.length > 0) {
        fallos++;
        console.error(`   ❌ ${negocio.slug}: ${JSON.stringify(real)} (esperado >= ${JSON.stringify(esperado)})`);
      } else {
        console.log(`   ✅ ${negocio.slug}: ${JSON.stringify(real)}`);
      }
    }
    if (fallos > 0) {
      throw new Error(`Verificación fallida en ${fallos} negocio(s). Revisa los conteos anteriores.`);
    }

    console.log('\n✅ Seed completo finalizado');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
