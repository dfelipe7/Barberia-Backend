/**
 * Trazabilidad:
 * - REQ: REQ-009
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: comprobar que el correo de alerta no arrastra credenciales del contexto.
 * - Responsabilidad: pruebas del servicio de alertas. No comprueba el filtro global.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AlertsService } from './alerts.service';
import { MailerService } from '@nestjs-modules/mailer';

describe('AlertsService', () => {
  let service: AlertsService;
  let mailerService: { sendMail: jest.Mock };

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

    await service.sendSecurityAlert(403, {
      ip: '127.0.0.1',
      path: '/test',
      method: 'GET',
      timestamp: '2026',
    });

    expect(mailerService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '⚠️ ALERTA DE SEGURIDAD - Barbería VIP [Error 403]',
      }),
    );
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

  it('H-02: el correo NO incluye el cuerpo de la petición aunque venga en el contexto', async () => {
    mailerService.sendMail.mockResolvedValue(true);

    const SECRETO = 'SECRETO-DE-PRUEBA-NO-DEBE-APARECER';

    await service.sendSecurityAlert(403, {
      ip: '127.0.0.1',
      path: '/auth/google',
      method: 'POST',
      timestamp: '2026',
      status: 403,
      requestId: 'req-1',
      codigoError: 'SLOT_TAKEN',
      body: { idToken: SECRETO, password: SECRETO },
      headers: { authorization: `Bearer ${SECRETO}` },
    });

    const llamadas = mailerService.sendMail.mock.calls as unknown[][];
    const correo = llamadas[0][0] as { text: string; html: string };

    expect(correo.text).not.toContain(SECRETO);
    expect(correo.html).not.toContain(SECRETO);
    expect(correo.text).toContain('/auth/google');
    expect(correo.html).toContain('req-1');
  });
});
