import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles/roles.guard';

describe('WhatsAppController', () => {
  let controller: WhatsAppController;
  let whatsappService: Partial<WhatsAppService>;

  beforeEach(async () => {
    whatsappService = {
      getStatus: jest.fn().mockReturnValue({ conectado: true, qr: null }),
      desconectar: jest
        .fn()
        .mockResolvedValue({ mensaje: 'WhatsApp desvinculado con éxito.' }),
      obtenerPlantillas: jest.fn().mockResolvedValue({
        confirmacion: 'Plantilla confirmacion',
        recordatorio: 'Plantilla recordatorio',
      }),
      guardarPlantillas: jest.fn().mockResolvedValue({
        confirmacion: 'Nueva confirmacion',
        recordatorio: 'Nuevo recordatorio',
      }),
      resetPlantillas: jest.fn().mockResolvedValue({
        confirmacion: 'Default confirmacion',
        recordatorio: 'Default recordatorio',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsAppController],
      providers: [
        {
          provide: WhatsAppService,
          useValue: whatsappService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<WhatsAppController>(WhatsAppController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  describe('getStatus', () => {
    it('debe retornar el estado actual de la conexión y QR', () => {
      const resultado = controller.getStatus();
      expect(resultado).toEqual({ conectado: true, qr: null });
      expect(whatsappService.getStatus).toHaveBeenCalled();
    });
  });

  describe('plantillas', () => {
    it('debe obtener las plantillas activas', async () => {
      const plantillas = await controller.obtenerPlantillas();
      expect(plantillas).toEqual({
        confirmacion: 'Plantilla confirmacion',
        recordatorio: 'Plantilla recordatorio',
      });
      expect(whatsappService.obtenerPlantillas).toHaveBeenCalled();
    });

    it('debe guardar las plantillas actualizadas', async () => {
      const res = await controller.guardarPlantillas({
        confirmacion: 'Nueva confirmacion',
      });
      expect(res).toEqual({
        confirmacion: 'Nueva confirmacion',
        recordatorio: 'Nuevo recordatorio',
      });
      expect(whatsappService.guardarPlantillas).toHaveBeenCalled();
    });

    it('debe restablecer las plantillas por defecto', async () => {
      const res = await controller.resetPlantillas();
      expect(res).toEqual({
        confirmacion: 'Default confirmacion',
        recordatorio: 'Default recordatorio',
      });
      expect(whatsappService.resetPlantillas).toHaveBeenCalled();
    });
  });

  describe('desconectar', () => {
    it('debe llamar al servicio para desvincular y retornar el mensaje', async () => {
      const resultado = await controller.desconectar();
      expect(resultado).toEqual({
        mensaje: 'WhatsApp desvinculado con éxito.',
      });
      expect(whatsappService.desconectar).toHaveBeenCalled();
    });
  });
});
