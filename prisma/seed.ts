import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

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
