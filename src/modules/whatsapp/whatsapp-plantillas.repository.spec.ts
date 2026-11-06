import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppPlantillasRepository } from './whatsapp-plantillas.repository';
import { PrismaService } from '../../prisma/prisma.service';

describe('WhatsAppPlantillasRepository', () => {
  let repository: WhatsAppPlantillasRepository;
  let prisma: jest.Mocked<PrismaService>;

  const mockPlantilla = {
    id: 1,
    tipo: 'CONFIRMACION_RESERVA',
    mensaje: 'Hola {cliente}, tu cita está lista.',
    negocioId: 1,
    activo: true,
  };

  beforeEach(async () => {
    const mockPrisma = {
      whatsAppPlantilla: {
        findMany: jest.fn().mockResolvedValue([mockPlantilla]),
        upsert: jest.fn().mockResolvedValue(mockPlantilla),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppPlantillasRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get<WhatsAppPlantillasRepository>(
      WhatsAppPlantillasRepository,
    );
    prisma = module.get(PrismaService);
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  describe('obtenerPlantillas', () => {
    it('filtra solo globales cuando negocioId es null', async () => {
      const res = await repository.obtenerPlantillas(null);
      expect(prisma.whatsAppPlantilla.findMany).toHaveBeenCalledWith({
        where: { negocioId: null, activo: true },
        select: { tipo: true, mensaje: true, negocioId: true },
      });
      expect(res).toEqual([
        {
          tipo: 'CONFIRMACION_RESERVA',
          mensaje: 'Hola {cliente}, tu cita está lista.',
          negocioId: 1,
        },
      ]);
    });

    it('incluye propias y globales cuando negocioId es un numero', async () => {
      await repository.obtenerPlantillas(5);
      expect(prisma.whatsAppPlantilla.findMany).toHaveBeenCalledWith({
        where: { activo: true, OR: [{ negocioId: 5 }, { negocioId: null }] },
        select: { tipo: true, mensaje: true, negocioId: true },
      });
    });
  });

  describe('guardarPlantilla', () => {
    it('guarda plantilla global cuando negocioId es null', async () => {
      await repository.guardarPlantilla(null, 'RECORDATORIO', 'Texto global');
      expect(prisma.whatsAppPlantilla.upsert).toHaveBeenCalledWith({
        where: { claveGlobal: 'RECORDATORIO' },
        update: { mensaje: 'Texto global', activo: true },
        create: {
          tipo: 'RECORDATORIO',
          mensaje: 'Texto global',
          activo: true,
          negocioId: null,
        },
      });
    });

    it('guarda plantilla propia cuando negocioId es un numero', async () => {
      await repository.guardarPlantilla(3, 'RECORDATORIO', 'Texto negocio 3');
      expect(prisma.whatsAppPlantilla.upsert).toHaveBeenCalledWith({
        where: { negocioId_tipo: { negocioId: 3, tipo: 'RECORDATORIO' } },
        update: { mensaje: 'Texto negocio 3', activo: true },
        create: {
          tipo: 'RECORDATORIO',
          mensaje: 'Texto negocio 3',
          activo: true,
          negocioId: 3,
        },
      });
    });
  });

  describe('eliminarPlantillas', () => {
    it('elimina por tipos y negocioId retornando el conteo', async () => {
      const count = await repository.eliminarPlantillas(1, [
        'CONFIRMACION_RESERVA',
        'CANCELACION',
      ]);
      expect(prisma.whatsAppPlantilla.deleteMany).toHaveBeenCalledWith({
        where: {
          negocioId: 1,
          tipo: { in: ['CONFIRMACION_RESERVA', 'CANCELACION'] },
        },
      });
      expect(count).toBe(2);
    });
  });
});
