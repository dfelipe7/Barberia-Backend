import { Test, TestingModule } from '@nestjs/testing';
import {
  WhatsAppService,
  PLANTILLA_CONFIRMACION_DEFAULT,
  PLANTILLA_RECORDATORIO_DEFAULT,
  enmascararTelefono,
} from './whatsapp.service';
import { WhatsAppPlantillasRepository } from '../repository/whatsapp-plantillas.repository';
import { ConfiguracionService } from '../../configuracion/service/configuracion.service';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { NegociosRepository } from '../../negocios/repository/negocios.repository';
import { PerfilNegocioService } from '../../perfil-negocio/service/perfil-negocio.service';
import { PrismaService } from '../../../prisma/prisma.service';

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
    obtenerTextoDelNegocio: jest.fn(),
    obtenerNumero: jest.fn(),
    obtenerNumeroDelNegocio: jest.fn(),
    guardarTexto: jest.fn(),
    guardarNumero: jest.fn(),
  };
  const contextoServiceMock = {
    obtenerContexto: jest.fn(),
  };
  const perfilNegocioServiceMock = {
    obtenerDireccionComercial: jest.fn(),
  };
  const negociosRepositoryMock = {
    buscarPorId: jest.fn(),
    listar: jest.fn(),
  };

  const prismaMock = {
    whatsappPlantilla: {},
    reservation: {
      findUnique: jest.fn(),
    },
  };

  const NEGOCIO_A = { id: 7, slug: 'negocio-a' };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Valores por defecto de los dobles: sin contexto de negocio.
    prismaMock.reservation.findUnique.mockResolvedValue(null);
    plantillasRepositoryMock.obtenerPlantillas.mockResolvedValue([]);
    plantillasRepositoryMock.guardarPlantilla.mockResolvedValue(undefined);
    plantillasRepositoryMock.eliminarPlantillas.mockResolvedValue(0);
    configuracionServiceMock.obtenerTexto.mockResolvedValue('');
    configuracionServiceMock.obtenerTextoDelNegocio.mockResolvedValue('');
    configuracionServiceMock.obtenerNumero.mockResolvedValue(0);
    configuracionServiceMock.guardarTexto.mockResolvedValue(undefined);
    configuracionServiceMock.guardarNumero.mockResolvedValue(undefined);
    contextoServiceMock.obtenerContexto.mockReturnValue(undefined);
    perfilNegocioServiceMock.obtenerDireccionComercial.mockResolvedValue('');
    negociosRepositoryMock.buscarPorId.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppService,
        { provide: PrismaService, useValue: prismaMock },
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
          useValue: negociosRepositoryMock,
        },
        {
          provide: PerfilNegocioService,
          useValue: perfilNegocioServiceMock,
        },
      ],
    }).compile();

    service = module.get<WhatsAppService>(WhatsAppService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('formatearNumeroAJid', () => {
    it.each([
      [
        'números colombianos de 10 dígitos (3001234567) con prefijo 57',
        '3001234567',
        '573001234567@s.whatsapp.net',
      ],
      [
        'números con prefijo 57 ya incluido',
        '573001234567',
        '573001234567@s.whatsapp.net',
      ],
      [
        'caracteres especiales como guiones, espacios y paréntesis',
        '+57 (300) 123-4567',
        '573001234567@s.whatsapp.net',
      ],
    ])('debe formatear a JID para %s', (_, entrada, esperado) => {
      expect(service.formatearNumeroAJid(entrada)).toBe(esperado);
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

    it('hayAlgunaSesionConectada debe devolver false si no hay sesiones conectadas', () => {
      expect(service.hayAlgunaSesionConectada()).toBe(false);
    });

    it('hayAlgunaSesionConectada debe devolver true si al menos una sesion esta conectada', () => {
      (service as any).sesiones.set(1, { isConnected: true });
      expect(service.hayAlgunaSesionConectada()).toBe(true);
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
      // El nombre del negocio se resuelve con el del CONTEXTO. SIN contexto
      // NO se inventa una identidad comercial: el nombre queda vacío (nunca
      // el de otro negocio, nunca un nombre por defecto).
      expect(spy).toHaveBeenCalledWith(
        '3001234567',
        expect.not.stringContaining('Barbería'),
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

    it('usa el NOMBRE y la DIRECCIÓN del negocio del CONTEXTO', async () => {
      const spy = jest.spyOn(service, 'enviarMensaje').mockResolvedValue(true);

      contextoServiceMock.obtenerContexto.mockReturnValue(NEGOCIO_A);
      negociosRepositoryMock.buscarPorId.mockResolvedValue({
        id: NEGOCIO_A.id,
        slug: NEGOCIO_A.slug,
        nombre: 'KYRIOS STUDIO',
      });
      perfilNegocioServiceMock.obtenerDireccionComercial.mockResolvedValue(
        'Vía al Bosque, Tv 9A Norte, Popayán',
      );
      configuracionServiceMock.obtenerTexto.mockResolvedValue('');

      await service.enviarConfirmacionReserva({
        telefono: '3001234567',
        clienteNombre: 'Carlos',
        servicioNombre: 'Corte Clásico',
        barberoNombre: 'Duvan',
        fecha: '2026-11-01',
        hora: '14:00',
        precio: 25000,
      });

      // El nombre comercial viene del negocio del contexto.
      expect(spy).toHaveBeenCalledWith(
        '3001234567',
        expect.stringContaining('KYRIOS STUDIO'),
      );
      // Y la dirección, del PERFIL de ese mismo negocio.
      expect(spy).toHaveBeenCalledWith(
        '3001234567',
        expect.stringContaining('Vía al Bosque'),
      );
    });

    it('usa la dirección HISTÓRICA solo como respaldo', async () => {
      const spy = jest.spyOn(service, 'enviarMensaje').mockResolvedValue(true);

      contextoServiceMock.obtenerContexto.mockReturnValue(NEGOCIO_A);
      negociosRepositoryMock.buscarPorId.mockResolvedValue({
        id: NEGOCIO_A.id,
        slug: NEGOCIO_A.slug,
        nombre: 'KYRIOS STUDIO',
      });
      // El perfil no tiene dirección: se consulta la clave histórica.
      perfilNegocioServiceMock.obtenerDireccionComercial.mockResolvedValue('');
      configuracionServiceMock.obtenerTextoDelNegocio.mockResolvedValue(
        'Dirección Antigua, Popayán',
      );

      await service.enviarConfirmacionReserva({
        telefono: '3001234567',
        clienteNombre: 'Carlos',
        servicioNombre: 'Corte Clásico',
        barberoNombre: 'Duvan',
        fecha: '2026-11-01',
        hora: '14:00',
      });

      expect(spy).toHaveBeenCalledWith(
        '3001234567',
        expect.stringContaining('Dirección Antigua'),
      );
      // El respaldo histórico solo se consulta cuando el perfil no tiene
      // dirección, y únicamente en el negocio del contexto.
      expect(
        configuracionServiceMock.obtenerTextoDelNegocio,
      ).toHaveBeenCalledWith('negocio_direccion', '');
      // El respaldo histórico se lee SOLO del ámbito del negocio: nunca se
      // consulta el ámbito global de plataforma.
      expect(configuracionServiceMock.obtenerTexto).not.toHaveBeenCalled();
    });

    it('no inventa una dirección si el negocio no tiene ninguna', async () => {
      const spy = jest.spyOn(service, 'enviarMensaje').mockResolvedValue(true);

      contextoServiceMock.obtenerContexto.mockReturnValue(NEGOCIO_A);
      perfilNegocioServiceMock.obtenerDireccionComercial.mockResolvedValue('');
      configuracionServiceMock.obtenerTexto.mockResolvedValue('');

      await service.enviarConfirmacionReserva({
        telefono: '3001234567',
        clienteNombre: 'Carlos',
        servicioNombre: 'Corte Clásico',
        barberoNombre: 'Duvan',
        fecha: '2026-11-01',
        hora: '14:00',
      });

      expect(spy).toHaveBeenCalledWith(
        '3001234567',
        expect.not.stringContaining('Ubicación'),
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

  describe('Aislamiento Multi-Tenant de Sesiones de WhatsApp', () => {
    const NEGOCIO_B = { id: 2, slug: 'barberia-demo-2' };

    it('debe asignar directorios de sesión independientes para cada barbería', () => {
      const dirNegocio1 = service.obtenerDirectorioSesion(1);
      const dirNegocio2 = service.obtenerDirectorioSesion(2);

      expect(dirNegocio1).not.toBe(dirNegocio2);
      expect(dirNegocio2).toContain('negocio_2');
    });

    it('el estado de conexión de un negocio no debe afectar al otro (aislamiento de sockets)', () => {
      contextoServiceMock.obtenerContexto.mockReturnValue({
        id: 1,
        slug: 'kyrios-studio',
      });
      const sesion1 = (service as any).obtenerOCrearSesion(1);
      sesion1.isConnected = true;
      sesion1.qrDataUrl = null;

      const statusNegocio1 = service.getStatus();
      expect(statusNegocio1.conectado).toBe(true);
      expect(statusNegocio1.qr).toBeNull();

      contextoServiceMock.obtenerContexto.mockReturnValue(NEGOCIO_B);
      const statusNegocio2 = service.getStatus();
      expect(statusNegocio2.conectado).toBe(false);
    });

    it('resolverNegocioId debe respetar el parámetro explícito sobre el contexto', () => {
      contextoServiceMock.obtenerContexto.mockReturnValue({
        id: 1,
        slug: 'kyrios-studio',
      });
      expect(service.resolverNegocioId(2)).toBe(2);
      expect(service.resolverNegocioId()).toBe(1);
    });

    it('enviarMensaje aísla los envíos según el negocio', async () => {
      const sesion1 = (service as any).obtenerOCrearSesion(1);
      sesion1.isConnected = true;
      sesion1.sock = {
        sendMessage: jest.fn().mockResolvedValue({ key: { id: 'msg-1' } }),
      };

      const sesion2 = (service as any).obtenerOCrearSesion(2);
      sesion2.isConnected = false;
      sesion2.sock = null;

      contextoServiceMock.obtenerContexto.mockReturnValue({
        id: 1,
        slug: 'kyrios-studio',
      });
      const enviado1 = await service.enviarMensaje(
        '3001234567',
        'Mensaje de Kyrios',
      );
      expect(enviado1).toBe(true);
      expect(sesion1.sock.sendMessage).toHaveBeenCalled();

      contextoServiceMock.obtenerContexto.mockReturnValue(NEGOCIO_B);
      const enviado2 = await service.enviarMensaje(
        '3001234567',
        'Mensaje de Demo 2',
      );
      expect(enviado2).toBe(false);
    });
  });

  describe('obtenerMinutosAnticipacion y ciclo de vida', () => {
    it('devuelve el valor parseado cuando la plantilla global contiene un número válido', async () => {
      jest.spyOn(service as any, 'obtenerPlantillaGlobal').mockResolvedValue({
        tipo: 'CONFIG_RECORDATORIO_MINUTOS',
        mensaje: '45',
      });

      const minutos = await service.obtenerMinutosAnticipacion();
      expect(minutos).toBe(45);
    });

    it('devuelve el default cuando la plantilla global contiene texto inválido o número <= 0', async () => {
      jest.spyOn(service as any, 'obtenerPlantillaGlobal').mockResolvedValue({
        tipo: 'CONFIG_RECORDATORIO_MINUTOS',
        mensaje: 'invalido',
      });
      expect(await service.obtenerMinutosAnticipacion()).toBe(120);

      jest.spyOn(service as any, 'obtenerPlantillaGlobal').mockResolvedValue({
        tipo: 'CONFIG_RECORDATORIO_MINUTOS',
        mensaje: '-10',
      });
      expect(await service.obtenerMinutosAnticipacion()).toBe(120);

      jest
        .spyOn(service as any, 'obtenerPlantillaGlobal')
        .mockResolvedValue(null);
      expect(await service.obtenerMinutosAnticipacion()).toBe(120);
    });

    it('onModuleDestroy destruye las sesiones activas', () => {
      const destruirSpy = jest
        .spyOn(service as any, 'destruirSocket')
        .mockImplementation(() => {});
      (service as any).sesiones.set(99, { id: 99 });

      service.onModuleDestroy();
      expect(destruirSpy).toHaveBeenCalled();
    });
  });

  describe('Cola en Memoria y Antisolapamiento de Notificaciones', () => {
    const payloadPrueba = {
      telefono: '3001234567',
      clienteNombre: 'Pedro Gómez',
      servicioNombre: 'Corte Clásico',
      barberoNombre: 'Carlos Barbero',
      fecha: '2026-11-20',
      hora: '15:00',
      negocioId: 7,
    };

    it('encola un mensaje y reemplaza mensaje previo de la misma reserva', () => {
      const ahora = Date.now();
      service.encolarMensaje({
        reservaId: 101,
        negocioId: 7,
        tipo: 'CONFIRMACION',
        telefono: '3001234567',
        payload: payloadPrueba,
        creadoEn: ahora,
        caducaEn: ahora + 3600_000,
        horaInicioCitaMs: ahora + 7200_000,
      });

      const colaAntes = (service as any).colasPendientes.get(7);
      expect(colaAntes).toHaveLength(1);
      expect(colaAntes[0].tipo).toBe('CONFIRMACION');

      // Reemplazo por reprogramación
      service.encolarMensaje({
        reservaId: 101,
        negocioId: 7,
        tipo: 'REPROGRAMACION',
        telefono: '3001234567',
        payload: { ...payloadPrueba, hora: '17:00' },
        creadoEn: ahora + 1000,
        caducaEn: ahora + 3601_000,
        horaInicioCitaMs: ahora + 10800_000,
      });

      const colaDespues = (service as any).colasPendientes.get(7);
      expect(colaDespues).toHaveLength(1);
      expect(colaDespues[0].tipo).toBe('REPROGRAMACION');
      expect(colaDespues[0].payload.hora).toBe('17:00');
    });

    it('cancela y purga mensajes de una reserva al cancelar', () => {
      const ahora = Date.now();
      service.encolarMensaje({
        reservaId: 102,
        negocioId: 7,
        tipo: 'CONFIRMACION',
        telefono: '3001234567',
        payload: payloadPrueba,
        creadoEn: ahora,
        caducaEn: ahora + 3600_000,
        horaInicioCitaMs: ahora + 7200_000,
      });

      expect((service as any).colasPendientes.get(7)).toHaveLength(1);

      service.cancelarMensajesPendientesDeReserva(102, 7);

      expect((service as any).colasPendientes.get(7)).toHaveLength(0);
    });

    it('despacha cola descartando mensajes con TTL expirado o cita ya iniciada', async () => {
      const ahora = Date.now();
      // Mensaje 1: TTL expirado
      service.encolarMensaje({
        reservaId: 201,
        negocioId: 7,
        tipo: 'CONFIRMACION',
        telefono: '3001234567',
        payload: payloadPrueba,
        creadoEn: ahora - 4000_000,
        caducaEn: ahora - 1000,
        horaInicioCitaMs: ahora + 7200_000,
      });

      // Mensaje 2: Cita ya iniciada
      service.encolarMensaje({
        reservaId: 202,
        negocioId: 7,
        tipo: 'CONFIRMACION',
        telefono: '3001234567',
        payload: payloadPrueba,
        creadoEn: ahora,
        caducaEn: ahora + 3600_000,
        horaInicioCitaMs: ahora - 500,
      });

      const enviarSpy = jest
        .spyOn(service, 'enviarConfirmacionReserva')
        .mockResolvedValue(true);

      await service.despacharColaPendiente(7);

      expect(enviarSpy).not.toHaveBeenCalled();
    });

    it('descarta mensaje en cola si la reserva fue cancelada en BD', async () => {
      const ahora = Date.now();
      service.encolarMensaje({
        reservaId: 203,
        negocioId: 7,
        tipo: 'CONFIRMACION',
        telefono: '3001234567',
        payload: payloadPrueba,
        creadoEn: ahora,
        caducaEn: ahora + 3600_000,
        horaInicioCitaMs: ahora + 7200_000,
      });

      prismaMock.reservation.findUnique.mockResolvedValue({
        status: 'CANCELLED',
      });
      const enviarSpy = jest
        .spyOn(service, 'enviarConfirmacionReserva')
        .mockResolvedValue(true);

      await service.despacharColaPendiente(7);

      expect(prismaMock.reservation.findUnique).toHaveBeenCalledWith({
        where: { id: 203 },
        select: { status: true },
      });
      expect(enviarSpy).not.toHaveBeenCalled();
    });

    it('despacha exitosamente mensaje válido en cola cuando la reserva sigue activa', async () => {
      const ahora = Date.now();
      service.encolarMensaje({
        reservaId: 204,
        negocioId: 7,
        tipo: 'CONFIRMACION',
        telefono: '3001234567',
        payload: payloadPrueba,
        creadoEn: ahora,
        caducaEn: ahora + 3600_000,
        horaInicioCitaMs: ahora + 7200_000,
      });

      prismaMock.reservation.findUnique.mockResolvedValue({
        status: 'PENDING',
      });
      const enviarSpy = jest
        .spyOn(service, 'enviarConfirmacionReserva')
        .mockResolvedValue(true);

      await service.despacharColaPendiente(7);

      expect(enviarSpy).toHaveBeenCalledWith(payloadPrueba);
    });

    it('despacha exitosamente mensaje de tipo REPROGRAMACION en cola', async () => {
      const ahora = Date.now();
      service.encolarMensaje({
        reservaId: 205,
        negocioId: 7,
        tipo: 'REPROGRAMACION',
        telefono: '3001234567',
        payload: payloadPrueba,
        creadoEn: ahora,
        caducaEn: ahora + 3600_000,
        horaInicioCitaMs: ahora + 7200_000,
      });

      prismaMock.reservation.findUnique.mockResolvedValue({
        status: 'CONFIRMED',
      });
      const reprogramarSpy = jest
        .spyOn(service, 'enviarReprogramacionReserva')
        .mockResolvedValue(true);

      await service.despacharColaPendiente(7);

      expect(reprogramarSpy).toHaveBeenCalledWith(payloadPrueba);
    });

    it('maneja errores en BD y fallos de envío durante el despacho sin interrumpir', async () => {
      const ahora = Date.now();
      service.encolarMensaje({
        reservaId: 206,
        negocioId: 7,
        tipo: 'CONFIRMACION',
        telefono: '3001234567',
        payload: payloadPrueba,
        creadoEn: ahora,
        caducaEn: ahora + 3600_000,
        horaInicioCitaMs: ahora + 7200_000,
      });

      prismaMock.reservation.findUnique.mockRejectedValue(
        new Error('DB connection lost'),
      );
      const enviarSpy = jest
        .spyOn(service, 'enviarConfirmacionReserva')
        .mockRejectedValue(new Error('Send socket error'));

      await service.despacharColaPendiente(7);

      expect(enviarSpy).toHaveBeenCalled();
    });

    it('enviarReprogramacionReserva envía mensaje formateado con datos del negocio', async () => {
      jest
        .spyOn(service as any, 'datosComercialesDelNegocio')
        .mockResolvedValue({
          nombre: 'Barbería VIP',
          direccion: 'Calle 10 # 20-30',
          telefono: '3001112233',
        });
      const enviarMensajeSpy = jest
        .spyOn(service, 'enviarMensaje')
        .mockResolvedValue(true);

      const resultado =
        await service.enviarReprogramacionReserva(payloadPrueba);

      expect(resultado).toBe(true);
      expect(enviarMensajeSpy).toHaveBeenCalledWith(
        payloadPrueba.telefono,
        expect.stringContaining('CITA REPROGRAMADA - Barbería VIP'),
        payloadPrueba.negocioId,
      );
    });

    it('no hace nada si la cola de la sede esta vacia o no existe', async () => {
      await expect(service.despacharColaPendiente(99)).resolves.not.toThrow();
      expect(() =>
        service.cancelarMensajesPendientesDeReserva(123, 99),
      ).not.toThrow();
    });
  });

  describe('Cobertura adicional de ramas y casos extremos', () => {
    const payloadTest = {
      clienteNombre: 'Carlos',
      barberoNombre: 'Mateo',
      servicioNombre: 'Corte Clásico',
      fecha: '2026-11-20',
      hora: '10:00',
      telefono: '3001234567',
      negocioId: 3,
    };

    it('onModuleInit conecta negocios con sesion guardada', async () => {
      negociosRepositoryMock.listar.mockResolvedValue([
        { id: 1, nombre: 'Kyrios' },
        { id: 2, nombre: 'Sede 2' },
      ]);
      jest
        .spyOn(service, 'tieneSesionGuardada')
        .mockImplementation((id) => id === 1);
      const iniciarSocketSpy = jest
        .spyOn(service, 'iniciarSocket')
        .mockResolvedValue(undefined);

      await service.onModuleInit();
      expect(iniciarSocketSpy).toHaveBeenCalledWith(1);
    });

    it('onModuleInit maneja error al listar negocios con fallback a negocio 1', async () => {
      negociosRepositoryMock.listar.mockRejectedValue(new Error('DB down'));
      jest.spyOn(service, 'tieneSesionGuardada').mockReturnValue(true);
      const iniciarSocketSpy = jest
        .spyOn(service, 'iniciarSocket')
        .mockResolvedValue(undefined);

      await service.onModuleInit();
      expect(iniciarSocketSpy).toHaveBeenCalledWith(1);
    });

    it('enviarMensaje retorna false si el teléfono no es válido', async () => {
      const sesion = (service as any).obtenerOCrearSesion(1);
      sesion.isConnected = true;
      sesion.sock = { sendMessage: jest.fn() };

      const res = await service.enviarMensaje('abc', 'Hola', 1);
      expect(res).toBe(false);
      expect(sesion.sock.sendMessage).not.toHaveBeenCalled();
    });

    it('enviarMensaje retorna false si sendMessage arroja excepción', async () => {
      const sesion = (service as any).obtenerOCrearSesion(1);
      sesion.isConnected = true;
      sesion.sock = {
        sendMessage: jest.fn().mockRejectedValue(new Error('Network drop')),
      };

      const res = await service.enviarMensaje('3001234567', 'Hola', 1);
      expect(res).toBe(false);
    });

    it('enviarCancelacionReserva envía mensaje formateado al cliente con y sin negocioId explícito', async () => {
      const spy = jest.spyOn(service, 'enviarMensaje').mockResolvedValue(true);
      await service.enviarCancelacionReserva(payloadTest);
      expect(spy).toHaveBeenCalledWith(
        payloadTest.telefono,
        expect.stringContaining('CITA CANCELADA'),
        payloadTest.negocioId,
      );

      const sinNegocio = { ...payloadTest, negocioId: undefined };
      await service.enviarCancelacionReserva(sinNegocio);
      expect(spy).toHaveBeenCalledWith(
        sinNegocio.telefono,
        expect.stringContaining('CITA CANCELADA'),
      );
    });

    it('enviarCompletadoReserva envía mensaje de agradecimiento con y sin negocioId explícito', async () => {
      const spy = jest.spyOn(service, 'enviarMensaje').mockResolvedValue(true);
      await service.enviarCompletadoReserva(payloadTest);
      expect(spy).toHaveBeenCalledWith(
        payloadTest.telefono,
        expect.stringContaining('¡Gracias por tu visita!'),
        payloadTest.negocioId,
      );

      const sinNegocio = { ...payloadTest, negocioId: undefined };
      await service.enviarCompletadoReserva(sinNegocio);
      expect(spy).toHaveBeenCalledWith(
        sinNegocio.telefono,
        expect.stringContaining('¡Gracias por tu visita!'),
      );
    });

    it('enviarConfirmacionReserva y enviarRecordatorioReserva respetan negocioId explícito', async () => {
      const spy = jest.spyOn(service, 'enviarMensaje').mockResolvedValue(true);
      await service.enviarConfirmacionReserva(payloadTest);
      expect(spy).toHaveBeenCalledWith(
        payloadTest.telefono,
        expect.any(String),
        payloadTest.negocioId,
      );

      await service.enviarRecordatorioReserva(payloadTest);
      expect(spy).toHaveBeenCalledWith(
        payloadTest.telefono,
        expect.any(String),
        payloadTest.negocioId,
      );
    });

    it('retorna minutos de configuración de negocio cuando valor > 0', async () => {
      configuracionServiceMock.obtenerNumero.mockResolvedValue(60);
      contextoServiceMock.obtenerContexto.mockReturnValue({
        id: 5,
        slug: 'test',
      });

      const minutos = await service.obtenerMinutosAnticipacion();
      expect(minutos).toBe(60);
    });

    it('maneja error cuando falla la lectura de anticipación del negocio', async () => {
      configuracionServiceMock.obtenerNumero.mockRejectedValue(
        new Error('fail'),
      );
      contextoServiceMock.obtenerContexto.mockReturnValue({
        id: 5,
        slug: 'test',
      });
      plantillasRepositoryMock.obtenerPlantillas.mockRejectedValue(
        new Error('repo fail'),
      );

      const minutos = await service.obtenerMinutosAnticipacion();
      expect(minutos).toBe(120);
    });

    it('guardarPlantillas guarda CONFIG_RECORDATORIO_MINUTOS en repositorio cuando no hay contexto', async () => {
      contextoServiceMock.obtenerContexto.mockReturnValue(undefined);
      await service.guardarPlantillas({ minutosAnticipacion: 90 });

      expect(plantillasRepositoryMock.guardarPlantilla).toHaveBeenCalledWith(
        null,
        'CONFIG_RECORDATORIO_MINUTOS',
        '90',
      );
    });

    it('resetPlantillas elimina CONFIG_RECORDATORIO_MINUTOS cuando no hay contexto de negocio', async () => {
      contextoServiceMock.obtenerContexto.mockReturnValue(undefined);
      await service.resetPlantillas();

      expect(plantillasRepositoryMock.eliminarPlantillas).toHaveBeenCalledWith(
        null,
        ['CONFIRMACION', 'RECORDATORIO', 'CONFIG_RECORDATORIO_MINUTOS'],
      );
    });

    it('maneja error al obtener dirección comercial del perfil', async () => {
      contextoServiceMock.obtenerContexto.mockReturnValue({
        id: 1,
        slug: 'kyrios',
      });
      perfilNegocioServiceMock.obtenerDireccionComercial.mockRejectedValue(
        new Error('perfil error'),
      );
      configuracionServiceMock.obtenerTextoDelNegocio.mockRejectedValue(
        new Error('cfg error'),
      );

      const datos = await (service as any).datosComercialesDelNegocio();
      expect(datos.direccion).toBe('');
    });
  });
});
