import { Test, TestingModule } from '@nestjs/testing';
import { AlertsService } from './alerts.service';
import { MailerService } from '@nestjs-modules/mailer';

describe('AlertsService', () => {
  let service: AlertsService;
  let mailerService: any;

  beforeEach(async () => {
    mailerService = {
      sendMail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: MailerService, useValue: mailerService },
      ],
    }).compile();

    service = module.get<AlertsService>(AlertsService);
    (service as any).logger = {
      error: jest.fn(),
      log: jest.fn(),
    };
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe enviar alerta de seguridad exitosamente', async () => {
    mailerService.sendMail.mockResolvedValue(true);
    
    await service.sendSecurityAlert(403, { ip: '127.0.0.1', path: '/test', method: 'GET', timestamp: '2026' });
    
    expect(mailerService.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: '⚠️ ALERTA DE SEGURIDAD - Barbería VIP [Error 403]',
    }));
  });

  it('no debe explotar si enviar correo falla (manejo de excepciones interno)', async () => {
    mailerService.sendMail.mockRejectedValue(new Error('SMTP Error'));
    await expect(service.sendSecurityAlert(500, {})).resolves.not.toThrow();
    expect((service as any).logger.error).toHaveBeenCalled();
  });

  it('debe manejar errores que no son instancia de Error', async () => {
    mailerService.sendMail.mockRejectedValue('String Error');
    await expect(service.sendSecurityAlert(500, {})).resolves.not.toThrow();
    expect((service as any).logger.error).toHaveBeenCalled();
  });
});
