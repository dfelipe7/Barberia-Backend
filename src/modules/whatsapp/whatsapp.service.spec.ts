import { Test, TestingModule } from '@nestjs/testing';
import {
  WhatsAppService,
  PLANTILLA_CONFIRMACION_DEFAULT,
  PLANTILLA_RECORDATORIO_DEFAULT,
  enmascararTelefono,
} from './whatsapp.service';
import { WhatsAppPlantillasRepository } from './whatsapp-plantillas.repository';
import { ConfiguracionService } from '../configuracion/service/configuracion.service';
import { NegocioContextoService } from '../negocios/negocio-contexto.service';
import { NegociosRepository } from '../negocios/repository/negocios.repository';
import { PrismaService } from '../../prisma/prisma.service';

describe('WhatsAppService', () => {
  let service: WhatsAppService;

  /** Dobles de las dependencias con las que se comprueba el AISLAMIENTO. */
  const plantillasRepositoryMock = {
    obtenerPlantillas: jest.fn(),
    guardarPlantilla: jest.fn(),
    eliminarPlantillas: jest.fn(),
  };
  const configuracionServiceMock = {
    obtenerTexto: jest.fn(),
    obtenerNumero: jest.fn(),
    guardarTexto: jest.fn(),
    guardarNumero: jest.fn(),
  };
  const contextoServiceMock = {
    obtenerContexto: jest.fn(),
  };

  const NEGOCIO_A = { id: 7, slug: 'negocio-a' };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Valores por defecto de los dobles: sin contexto de negocio.
    plantillasRepositoryMock.obtenerPlantillas.mockResolvedValue([]);
    plantillasRepositoryMock.guardarPlantilla.mockResolvedValue(undefined);
    plantillasRepositoryMock.eliminarPlantillas.mockResolvedValue(0);
    configuracionServiceMock.obtenerTexto.mockResolvedValue('');
    configuracionServiceMock.obtenerNumero.mockResolvedValue(0);
    configuracionServiceMock.guardarTexto.mockResolvedValue(undefined);
    configuracionServiceMock.guardarNumero.mockResolvedValue(undefined);
    contextoServiceMock.obtenerContexto.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppService,
        { provide: PrismaService, useValue: { whatsappPlantilla: {} } },
        {
          provide: WhatsAppPlantillasRepository,
          useValue: plantillasRepositoryMock,
        },
        {
          provide: ConfiguracionService,
          useValue: configuracionServiceMock,
        },
        {
          provide: NegocioContextoService,
          useValue: contextoServiceMock,
        },
        {
          provide: NegociosRepository,
          useValue: { buscarPorId: jest.fn().mockResolvedValue(null) },
        },
      ],
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
    it('debe retornar las plantillas por defecto si el repositorio no devuelve ninguna', async () => {
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
      // El nombre del negocio se resuelve con el del CONTEXTO; sin contexto
      // se usa el valor por defecto (nunca el de otro negocio).
      expect(spy).toHaveBeenCalledWith(
        '3001234567',
        expect.stringContaining('Barbería'),
      );
      // Sin dirección configurada, el mensaje NO incluye la línea de ubicación
      // (no se usa una dirección ajena).
      expect(spy).toHaveBeenCalledWith(
        '3001234567',
        expect.not.stringContaining('Ubicación'),
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

  describe('resolución de plantillas por negocio (HU-11)', () => {
    it('gana la plantilla del NEGOCIO sobre la global del mismo tipo', async () => {
      contextoServiceMock.obtenerContexto.mockReturnValue(NEGOCIO_A);
      plantillasRepositoryMock.obtenerPlantillas.mockResolvedValue([
        {
          tipo: 'CONFIRMACION',
          mensaje: 'Propia de A',
          negocioId: NEGOCIO_A.id,
        },
        {
          tipo: 'CONFIRMACION',
          mensaje: 'Global de plataforma',
          negocioId: null,
        },
      ]);

      const plantillas = await service.obtenerPlantillas();

      expect(plantillas.confirmacion).toBe('Propia de A');
      // La consulta se hace EN EL ÁMBITO del negocio del contexto.
      expect(plantillasRepositoryMock.obtenerPlantillas).toHaveBeenCalledWith(
        NEGOCIO_A.id,
      );
    });

    it('sin plantilla propia, gana la GLOBAL antes que el texto por defecto', async () => {
      contextoServiceMock.obtenerContexto.mockReturnValue(NEGOCIO_A);
      plantillasRepositoryMock.obtenerPlantillas.mockResolvedValue([
        {
          tipo: 'CONFIRMACION',
          mensaje: 'Global de plataforma',
          negocioId: null,
        },
      ]);

      const plantillas = await service.obtenerPlantillas();

      expect(plantillas.confirmacion).toBe('Global de plataforma');
      expect(plantillas.confirmacion).not.toBe(PLANTILLA_CONFIRMACION_DEFAULT);
    });

    it('guardar plantillas persiste ÚNICAMENTE en el negocio del contexto', async () => {
      contextoServiceMock.obtenerContexto.mockReturnValue(NEGOCIO_A);

      await service.guardarPlantillas({
        confirmacion: '  Confirmación de A  ',
        recordatorio: 'Recordatorio de A',
        minutosAnticipacion: 45,
      });

      expect(plantillasRepositoryMock.guardarPlantilla).toHaveBeenCalledWith(
        NEGOCIO_A.id,
        'CONFIRMACION',
        'Confirmación de A',
      );
      expect(plantillasRepositoryMock.guardarPlantilla).toHaveBeenCalledWith(
        NEGOCIO_A.id,
        'RECORDATORIO',
        'Recordatorio de A',
      );
      // La anticipación es una política del negocio: va a SU configuración.
      expect(configuracionServiceMock.guardarNumero).toHaveBeenCalledWith(
        NEGOCIO_A.id,
        'recordatorio_minutos_anticipacion',
        45,
      );
      // NO se escribe en el ámbito global (ni en otro negocio).
      expect(
        plantillasRepositoryMock.guardarPlantilla,
      ).not.toHaveBeenCalledWith(null, expect.anything(), expect.anything());
      expect(configuracionServiceMock.guardarNumero).not.toHaveBeenCalledWith(
        null,
        expect.anything(),
        expect.anything(),
      );
    });

    it('reset de un negocio NO toca las plantillas globales ni las de otro', async () => {
      contextoServiceMock.obtenerContexto.mockReturnValue(NEGOCIO_A);

      await service.resetPlantillas();

      // Solo se borran las plantillas PROPIAS del negocio del contexto.
      expect(plantillasRepositoryMock.eliminarPlantillas).toHaveBeenCalledTimes(
        1,
      );
      expect(plantillasRepositoryMock.eliminarPlantillas).toHaveBeenCalledWith(
        NEGOCIO_A.id,
        ['CONFIRMACION', 'RECORDATORIO'],
      );
      expect(
        plantillasRepositoryMock.eliminarPlantillas,
      ).not.toHaveBeenCalledWith(null, expect.anything());
      // La anticipación del negocio se restablece a 120 (no la global).
      expect(configuracionServiceMock.guardarNumero).toHaveBeenCalledWith(
        NEGOCIO_A.id,
        'recordatorio_minutos_anticipacion',
        120,
      );
    });

    it('sin contexto (operación de plataforma) se escriben las plantillas GLOBALES', async () => {
      contextoServiceMock.obtenerContexto.mockReturnValue(undefined);

      await service.guardarPlantillas({ confirmacion: 'Global' });

      expect(plantillasRepositoryMock.guardarPlantilla).toHaveBeenCalledWith(
        null,
        'CONFIRMACION',
        'Global',
      );
      expect(configuracionServiceMock.guardarNumero).not.toHaveBeenCalled();
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
