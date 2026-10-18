import { Test, TestingModule } from '@nestjs/testing';
import {
  WhatsAppService,
  PLANTILLA_CONFIRMACION_DEFAULT,
  PLANTILLA_RECORDATORIO_DEFAULT,
  enmascararTelefono,
} from './whatsapp.service';

describe('WhatsAppService', () => {
  let service: WhatsAppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WhatsAppService],
    }).compile();

    service = module.get<WhatsAppService>(WhatsAppService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('formatearNumeroAJid', () => {
    it('debe normalizar números colombianos de 10 dígitos (3001234567) con prefijo 57', () => {
      const jid = service.formatearNumeroAJid('3001234567');
      expect(jid).toBe('573001234567@s.whatsapp.net');
    });

    it('debe conservar números con prefijo 57 ya incluido', () => {
      const jid = service.formatearNumeroAJid('573001234567');
      expect(jid).toBe('573001234567@s.whatsapp.net');
    });

    it('debe limpiar caracteres especiales como guiones, espacios y paréntesis', () => {
      const jid = service.formatearNumeroAJid('+57 (300) 123-4567');
      expect(jid).toBe('573001234567@s.whatsapp.net');
    });

    it('debe retornar null para números vacíos o demasiado cortos', () => {
      expect(service.formatearNumeroAJid('')).toBeNull();
      expect(service.formatearNumeroAJid('123')).toBeNull();
    });
  });

  describe('getStatus', () => {
    it('debe devolver el estado inicial como no conectado', () => {
      const status = service.getStatus();
      expect(status.conectado).toBe(false);
    });
  });

  describe('pausar e iniciar', () => {
    it('pausar debe poner el servicio en modo reposo si no está conectado ni tiene sesión guardada', () => {
      jest.spyOn(service, 'tieneSesionGuardada').mockReturnValue(false);
      const res = service.pausar();
      expect(res).toEqual({ mensaje: 'WhatsApp en modo reposo.' });
    });

    it('pausar debe indicar que sigue activo si tiene sesión guardada', () => {
      jest.spyOn(service, 'tieneSesionGuardada').mockReturnValue(true);
      const res = service.pausar();
      expect(res).toEqual({ mensaje: 'WhatsApp activo con sesión guardada.' });
    });

    it('iniciar debe reactivar el servicio bajo demanda', () => {
      const res = service.iniciar();
      expect(res).toEqual({ mensaje: 'Iniciando WhatsApp...' });
    });
  });

  describe('enviarMensaje sin conexión', () => {
    it('debe retornar false si no hay socket o no está conectado', async () => {
      const enviado = await service.enviarMensaje('3001234567', 'Hola');
      expect(enviado).toBe(false);
    });
  });

  describe('plantillas y reemplazo de variables', () => {
    it('debe retornar plantillas por defecto si no hay base de datos inyectada', async () => {
      const plantillas = await service.obtenerPlantillas();
      expect(plantillas.confirmacion).toBe(PLANTILLA_CONFIRMACION_DEFAULT);
      expect(plantillas.recordatorio).toBe(PLANTILLA_RECORDATORIO_DEFAULT);
      expect(plantillas.minutosAnticipacion).toBe(120);
    });

    it('reemplazarVariables debe sustituir adecuadamente todas las etiquetas {cliente}, {fecha}, etc.', () => {
      const template =
        'Hola {cliente}, cita el {fecha} a las {hora} con {barbero} para {servicio}.';
      const resultado = service.reemplazarVariables(template, {
        telefono: '3001234567',
        clienteNombre: 'Felipe',
        servicioNombre: 'Corte',
        barberoNombre: 'Duvan',
        fecha: '2026-10-19',
        hora: '15:00',
      });

      expect(resultado).toBe(
        'Hola Felipe, cita el 2026-10-19 a las 15:00 con Duvan para Corte.',
      );
    });

    it('enviarConfirmacionReserva debe invocar enviarMensaje con la plantilla formateada', async () => {
      const spy = jest.spyOn(service, 'enviarMensaje').mockResolvedValue(true);

      const resultado = await service.enviarConfirmacionReserva({
        telefono: '3001234567',
        clienteNombre: 'Carlos',
        servicioNombre: 'Corte Clásico',
        barberoNombre: 'Duvan',
        fecha: '2026-11-01',
        hora: '14:00',
        precio: 25000,
      });

      expect(resultado).toBe(true);
      expect(spy).toHaveBeenCalledWith(
        '3001234567',
        expect.stringContaining('KYRIOS BARBER STUDIO'),
      );
      expect(spy).toHaveBeenCalledWith(
        '3001234567',
        expect.stringContaining('Carlos'),
      );
      expect(spy).toHaveBeenCalledWith(
        '3001234567',
        expect.stringContaining('Corte Clásico'),
      );
    });

    it('enviarRecordatorioReserva debe invocar enviarMensaje con la plantilla de recordatorio', async () => {
      const spy = jest.spyOn(service, 'enviarMensaje').mockResolvedValue(true);

      const resultado = await service.enviarRecordatorioReserva({
        telefono: '3001234567',
        clienteNombre: 'Andrés',
        servicioNombre: 'Barba Spa',
        barberoNombre: 'Duvan',
        fecha: '2026-11-01',
        hora: '16:00',
      });

      expect(resultado).toBe(true);
      expect(spy).toHaveBeenCalledWith(
        '3001234567',
        expect.stringContaining('RECORDATORIO DE TU CITA'),
      );
    });
  });

  describe('enmascararTelefono (Privacidad y OWASP)', () => {
    it('debe ocultar los dígitos centrales de un número telefónico', () => {
      expect(enmascararTelefono('3187594854')).toBe('318****854');
    });

    it('debe enmascarar correctamente un JID de WhatsApp preservando el dominio', () => {
      expect(enmascararTelefono('573187594854@s.whatsapp.net')).toBe(
        '573****854@s.whatsapp.net',
      );
    });

    it('debe responder de forma segura ante cadenas cortas, nulas o vacías', () => {
      expect(enmascararTelefono('')).toBe('***');
      expect(enmascararTelefono(null)).toBe('***');
      expect(enmascararTelefono(undefined)).toBe('***');
      expect(enmascararTelefono('123')).toBe('****');
    });
  });
});
