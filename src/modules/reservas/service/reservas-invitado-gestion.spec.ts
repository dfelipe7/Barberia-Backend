import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { ReservationStatus, WeekDay } from '../../../../generated/prisma/enums';
import {
  ReservasService,
  MENSAJE_RESERVA_MODIFICADA,
  MENSAJE_RESERVA_CANCELADA,
  MENSAJE_HORARIO_NO_DISPONIBLE,
  MENSAJE_RESERVA_NO_DISPONIBLE,
} from './reservas.service';
import { EstadoFranja } from '../../horarios/common/estado-franja';
/** Token de gestión fijo: el hash guardado y el token devuelto deben ser el mismo. */
const TOKEN_GESTION_PRUEBA = 'a'.repeat(64);

describe('HE-04 Seguridad: Gestión de Reservas de Invitados (Fase 5)', () => {
  let service: ReservasService;

  const mockReservasRepository = {
    crearConBloqueo: jest.fn(),
    existeReservaActivaDeClienteEnFranja: jest.fn(),
    obtenerReservaParaGestionInvitado: jest.fn(),
    obtenerReservaDeCliente: jest.fn(),
    modificarConBloqueo: jest.fn(),
    cancelar: jest.fn(),
  };

  const mockClientesRepository = {
    obtenerPorId: jest.fn(),
  };

  const mockDisponibilidadService = {
    calcularDisponibilidad: jest.fn(),
  };

  const mockServiciosRepository = {
    obtenerServicioActivoPorId: jest.fn(),
    listarBarberosActivosPorServicio: jest.fn(),
    existeAsignacionBarbero: jest.fn(),
  };

  const mockFechaBogotaService = {
    esFechaCalendarioValida: jest.fn().mockReturnValue(true),
    obtenerDiaSemana: jest.fn().mockReturnValue(WeekDay.SUNDAY),
    obtenerFechaHoyBogota: jest.fn().mockReturnValue('2026-10-31'),
    obtenerHoraActualBogota: jest.fn().mockReturnValue('10:00'),
    obtenerFechaBogota: jest.fn().mockReturnValue('2026-10-31'),
    obtenerHoraBogota: jest.fn().mockReturnValue('10:00'),
  };

  const mockBarberosRepository = {
    obtenerBarberoActivoPorId: jest.fn(),
  };

  const mockConfiguracionService = {
    obtenerNumero: jest.fn((_clave: string, porDefecto: number) =>
      Promise.resolve(porDefecto),
    ),
  };

  const FECHA = '2026-11-01';
  const HORA = '14:00';
  const HORA_FIN = '15:00';

  const servicioMock = {
    id: 2,
    nombre: 'Corte de cabello',
    precio: 50000,
    duracionMinutos: 60,
  };

  const barberoMock = {
    id: 3,
    usuario: { id: 10, nombre: 'Carlos', apellido: 'Gómez' },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new ReservasService(
      mockReservasRepository as any,
      mockClientesRepository as any,
      mockDisponibilidadService as any,
      mockServiciosRepository as any,
      mockFechaBogotaService as any,
      mockBarberosRepository as any,
      mockConfiguracionService as any,
    );

    mockServiciosRepository.obtenerServicioActivoPorId.mockResolvedValue(
      servicioMock,
    );
    mockServiciosRepository.listarBarberosActivosPorServicio.mockResolvedValue([
      barberoMock,
    ]);
    mockServiciosRepository.existeAsignacionBarbero.mockResolvedValue(true);
    mockBarberosRepository.obtenerBarberoActivoPorId.mockResolvedValue(
      barberoMock,
    );
    mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([
      { startTime: HORA, endTime: HORA_FIN, estado: EstadoFranja.AVAILABLE },
      { startTime: '16:00', endTime: '17:00', estado: EstadoFranja.AVAILABLE },
    ]);

    // El token de la respuesta es el PERSISTIDO (descifrado): se simula el
    // descifrado para no depender de la clave real en una prueba unitaria.
    jest
      .spyOn(service, 'descifrarTokenGestion')
      .mockImplementation((cifrado) => (cifrado ? TOKEN_GESTION_PRUEBA : null));

    // El token que se guarda (hash) y el que se devuelve deben ser el
    // MISMO: por eso se fija tambien el token generado.
    jest
      .spyOn(service, 'generarTokenGestion')
      .mockReturnValue(TOKEN_GESTION_PRUEBA);
  });

  // 1. Crear una reserva de invitado genera una credencial de gestión.
  it('1. Crear una reserva de invitado genera una credencial de gestión de alta entropía', async () => {
    mockReservasRepository.crearConBloqueo.mockResolvedValue({
      id: 42,
      barberoId: 3,
      servicioId: 2,
      clienteId: 99,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: 'hash',
      gestionTokenCifrado: 'cifrado',
    });

    const respuesta = await service.crearReserva({
      barberoId: 3,
      servicioId: 2,
      fecha: FECHA,
      hora: HORA,
      nombre: 'Juan Invitado',
      telefono: '3001234567',
    });

    expect(respuesta.tokenGestion).toBeDefined();
    expect(typeof respuesta.tokenGestion).toBe('string');
    // 32 bytes hex = 64 caracteres
    expect(respuesta.tokenGestion).toHaveLength(64);
    expect(respuesta.tokenGestion).toMatch(/^[0-9a-f]{64}$/);
  });

  // 2. La base de datos guarda el hash y no el token original.
  it('2. La base de datos guarda el hash SHA-256 y nunca el token original', async () => {
    let hashEnviadoARepo: string | undefined;

    mockReservasRepository.crearConBloqueo.mockImplementation(
      async (datos: any) => {
        hashEnviadoARepo = datos.gestionTokenHash;
        return {
          id: 42,
          barberoId: 3,
          servicioId: 2,
          clienteId: 99,
          date: new Date(`${FECHA}T00:00:00.000Z`),
          dayOfWeek: WeekDay.SUNDAY,
          startTime: HORA,
          endTime: HORA_FIN,
          status: ReservationStatus.PENDING,
          precioReservado: 50000,
          gestionTokenHash: hashEnviadoARepo,
          gestionTokenCifrado: 'cifrado',
        };
      },
    );

    const respuesta = await service.crearReserva({
      barberoId: 3,
      servicioId: 2,
      fecha: FECHA,
      hora: HORA,
      nombre: 'Juan Invitado',
      telefono: '3001234567',
    });

    const tokenOriginal = respuesta.tokenGestion!;
    expect(hashEnviadoARepo).toBeDefined();
    // El hash NO es igual al token original
    expect(hashEnviadoARepo).not.toBe(tokenOriginal);
    // El hash coincide con el SHA-256 del token original
    const hashEsperado = crypto
      .createHash('sha256')
      .update(tokenOriginal)
      .digest('hex');
    expect(hashEnviadoARepo).toBe(hashEsperado);
  });

  // 3. El invitado puede modificar su reserva con el token correcto.
  it('3. El invitado puede modificar su reserva con el token correcto', async () => {
    const tokenValido = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(tokenValido)
      .digest('hex');

    const reservaExistente = {
      id: 42,
      barberoId: 3,
      servicioId: 2,
      clienteId: 99,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: tokenHash,
      barbero: barberoMock,
      servicio: servicioMock,
    };

    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue(
      reservaExistente,
    );
    mockReservasRepository.existeReservaActivaDeClienteEnFranja.mockResolvedValue(
      false,
    );
    mockReservasRepository.modificarConBloqueo.mockResolvedValue({
      ...reservaExistente,
      startTime: '16:00',
      endTime: '17:00',
    });

    const respuesta = await service.modificarReservaInvitado(42, tokenValido, {
      hora: '16:00',
    });

    expect(respuesta.mensaje).toBe(MENSAJE_RESERVA_MODIFICADA);
    expect(respuesta.id).toBe(42);
    expect(respuesta.hora).toBe('16:00');
    expect(mockReservasRepository.modificarConBloqueo).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 42,
        startTime: '16:00',
        endTime: '17:00',
      }),
    );
  });

  // 4. El invitado puede cancelar su reserva con el token correcto.
  it('4. El invitado puede cancelar su reserva con el token correcto', async () => {
    const tokenValido = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(tokenValido)
      .digest('hex');

    const reservaExistente = {
      id: 42,
      barberoId: 3,
      servicioId: 2,
      clienteId: 99,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: tokenHash,
      barbero: barberoMock,
      servicio: servicioMock,
    };

    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue(
      reservaExistente,
    );
    mockReservasRepository.cancelar.mockResolvedValue({
      ...reservaExistente,
      status: ReservationStatus.CANCELLED,
    });

    const respuesta = await service.cancelarReservaInvitado(42, tokenValido);

    expect(respuesta.mensaje).toBe(MENSAJE_RESERVA_CANCELADA);
    expect(respuesta.id).toBe(42);
    expect(respuesta.estado).toBe(ReservationStatus.CANCELLED);
    expect(mockReservasRepository.cancelar).toHaveBeenCalledWith(42);
  });

  // 5. La modificación conserva la reserva original cuando falla la validación o la disponibilidad.
  it('5. La modificación conserva la reserva original cuando falla la disponibilidad', async () => {
    const tokenValido = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(tokenValido)
      .digest('hex');

    const reservaExistente = {
      id: 42,
      barberoId: 3,
      servicioId: 2,
      clienteId: 99,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: tokenHash,
      barbero: barberoMock,
      servicio: servicioMock,
    };

    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue(
      reservaExistente,
    );
    // Simular que el horario solicitado está ocupado en DisponibilidadService
    mockDisponibilidadService.calcularDisponibilidad.mockResolvedValue([
      { startTime: '16:00', endTime: '17:00', estado: EstadoFranja.RESERVED },
    ]);

    await expect(
      service.modificarReservaInvitado(42, tokenValido, { hora: '16:00' }),
    ).rejects.toThrow(ConflictException);

    // No se ejecutó modificarConBloqueo
    expect(mockReservasRepository.modificarConBloqueo).not.toHaveBeenCalled();
  });

  // 6. Un token incorrecto o ausente no permite modificar ni cancelar (404 idéntico a inexistente).
  it('6. Un token incorrecto o ausente produce exactamente el mismo error 404 que una reserva inexistente', async () => {
    const tokenReal = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(tokenReal)
      .digest('hex');

    const reservaExistente = {
      id: 42,
      barberoId: 3,
      servicioId: 2,
      clienteId: 99,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: tokenHash,
      barbero: barberoMock,
      servicio: servicioMock,
    };

    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue(
      reservaExistente,
    );

    // Token ausente / vacío -> 404 (La reserva no se encuentra disponible)
    await expect(
      service.modificarReservaInvitado(42, '', { hora: '16:00' }),
    ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

    await expect(service.cancelarReservaInvitado(42, '')).rejects.toThrow(
      new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE),
    );

    // Token incorrecto -> 404 (La reserva no se encuentra disponible)
    const tokenFalso = crypto.randomBytes(32).toString('hex');
    await expect(
      service.modificarReservaInvitado(42, tokenFalso, { hora: '16:00' }),
    ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

    await expect(
      service.cancelarReservaInvitado(42, tokenFalso),
    ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

    expect(mockReservasRepository.modificarConBloqueo).not.toHaveBeenCalled();
    expect(mockReservasRepository.cancelar).not.toHaveBeenCalled();
  });

  // 7. El token de una reserva no permite gestionar otra (responde 404 idéntico a inexistente).
  it('7. El token de una reserva A no permite gestionar una reserva B (responde 404 idéntico a inexistente)', async () => {
    const tokenReservaA = crypto.randomBytes(32).toString('hex');
    const hashReservaA = crypto
      .createHash('sha256')
      .update(tokenReservaA)
      .digest('hex');

    const tokenReservaB = crypto.randomBytes(32).toString('hex');
    const hashReservaB = crypto
      .createHash('sha256')
      .update(tokenReservaB)
      .digest('hex');

    // Reserva B en base de datos
    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue({
      id: 100, // Reserva B
      barberoId: 3,
      servicioId: 2,
      clienteId: 88,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: hashReservaB,
      barbero: barberoMock,
      servicio: servicioMock,
    });

    // Intenta modificar reserva B usando el token de la reserva A -> 404
    await expect(
      service.modificarReservaInvitado(100, tokenReservaA, { hora: '16:00' }),
    ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

    // Intenta cancelar reserva B usando el token de la reserva A -> 404
    await expect(
      service.cancelarReservaInvitado(100, tokenReservaA),
    ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

    expect(mockReservasRepository.modificarConBloqueo).not.toHaveBeenCalled();
    expect(mockReservasRepository.cancelar).not.toHaveBeenCalled();
  });

  // 8. Un cliente autenticado sigue utilizando los endpoints existentes y no necesita un token de invitado.
  it('8. Un cliente autenticado sigue utilizando endpoints /me y no genera ni requiere token de gestión', async () => {
    mockClientesRepository.obtenerPorId.mockResolvedValue({ id: 55 });
    mockReservasRepository.existeReservaActivaDeClienteEnFranja.mockResolvedValue(
      false,
    );
    mockReservasRepository.crearConBloqueo.mockResolvedValue({
      id: 50,
      barberoId: 3,
      servicioId: 2,
      clienteId: 55,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: null, // Sin token para autenticados
    });

    const respuestaCreacion = await service.crearReserva(
      { barberoId: 3, servicioId: 2, fecha: FECHA, hora: HORA },
      { clienteId: 55 },
    );

    // No se genera tokenGestion para cliente autenticado
    expect(respuestaCreacion.tokenGestion).toBeUndefined();
    expect(mockReservasRepository.crearConBloqueo).toHaveBeenCalledWith(
      expect.objectContaining({ gestionTokenHash: null }),
      expect.objectContaining({ revalidar: expect.any(Function) }),
    );

    // Modificar mediante endpoint autenticado (utiliza IdentidadClienteAutenticado)
    const reservaClienteAutenticado = {
      id: 50,
      barberoId: 3,
      servicioId: 2,
      clienteId: 55,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: null,
      barbero: barberoMock,
      servicio: servicioMock,
    };

    mockReservasRepository.obtenerReservaDeCliente.mockResolvedValue(
      reservaClienteAutenticado,
    );
    mockReservasRepository.modificarConBloqueo.mockResolvedValue({
      ...reservaClienteAutenticado,
      startTime: '16:00',
      endTime: '17:00',
    });

    const respuestaMod = await service.modificarReserva({ clienteId: 55 }, 50, {
      hora: '16:00',
    });

    expect(respuestaMod.mensaje).toBe(MENSAJE_RESERVA_MODIFICADA);
    expect(mockReservasRepository.obtenerReservaDeCliente).toHaveBeenCalledWith(
      55,
      50,
    );
  });

  // 9. Un invitado no puede acceder a las reservas privadas de un cliente autenticado mediante token de gestión.
  it('9. Una reserva de cliente autenticado (sin hash de gestión) no puede ser gestionada por endpoints de invitado', async () => {
    // La reserva de un cliente autenticado tiene gestionTokenHash = null
    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue({
      id: 50,
      barberoId: 3,
      servicioId: 2,
      clienteId: 55,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: null, // Cliente autenticado
      barbero: barberoMock,
      servicio: servicioMock,
    });

    const tokenCualquiera = crypto.randomBytes(32).toString('hex');

    await expect(
      service.modificarReservaInvitado(50, tokenCualquiera, { hora: '16:00' }),
    ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

    await expect(
      service.cancelarReservaInvitado(50, tokenCualquiera),
    ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

    expect(mockReservasRepository.modificarConBloqueo).not.toHaveBeenCalled();
    expect(mockReservasRepository.cancelar).not.toHaveBeenCalled();
  });

  // 10. Cancelar libera correctamente la franja y conserva el historial.
  it('10. Cancelar transiciona a CANCELLED (sin borrado físico) y es idempotente', async () => {
    const tokenValido = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(tokenValido)
      .digest('hex');

    const reservaExistente = {
      id: 42,
      barberoId: 3,
      servicioId: 2,
      clienteId: 99,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: tokenHash,
      barbero: barberoMock,
      servicio: servicioMock,
    };

    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue(
      reservaExistente,
    );
    mockReservasRepository.cancelar.mockResolvedValue({
      ...reservaExistente,
      status: ReservationStatus.CANCELLED,
    });

    // Primera cancelación
    const resp1 = await service.cancelarReservaInvitado(42, tokenValido);
    expect(resp1.estado).toBe(ReservationStatus.CANCELLED);
    expect(mockReservasRepository.cancelar).toHaveBeenCalledTimes(1);

    // Cancelación repetida (idempotente)
    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue({
      ...reservaExistente,
      status: ReservationStatus.CANCELLED,
    });

    const resp2 = await service.cancelarReservaInvitado(42, tokenValido);
    expect(resp2.estado).toBe(ReservationStatus.CANCELLED);
    // No se llama nuevamente al repositorio
    expect(mockReservasRepository.cancelar).toHaveBeenCalledTimes(1);
  });

  // 11. La concurrencia continúa protegida por los mecanismos existentes.
  it('11. Traduce colisiones de concurrencia P2002 a 409 con el mensaje de negocio', async () => {
    const tokenValido = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(tokenValido)
      .digest('hex');

    const reservaExistente = {
      id: 42,
      barberoId: 3,
      servicioId: 2,
      clienteId: 99,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: tokenHash,
      barbero: barberoMock,
      servicio: servicioMock,
    };

    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue(
      reservaExistente,
    );
    mockReservasRepository.existeReservaActivaDeClienteEnFranja.mockResolvedValue(
      false,
    );

    // Simula fallo P2002 en base de datos al competir con otra transacción
    mockReservasRepository.modificarConBloqueo.mockRejectedValue({
      code: 'P2002',
      message: 'Unique constraint failed',
    });

    await expect(
      service.modificarReservaInvitado(42, tokenValido, { hora: '16:00' }),
    ).rejects.toThrow(new ConflictException(MENSAJE_HORARIO_NO_DISPONIBLE));
  });

  // 12. Los datos sensibles no aparecen en logs ni en mensajes de error.
  it('12. El token secreto y su hash nunca se exponen en logs ni mensajes de error', async () => {
    const loggerSpy = jest.spyOn((service as any).logger, 'log');

    const tokenValido = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(tokenValido)
      .digest('hex');

    const reservaExistente = {
      id: 42,
      barberoId: 3,
      servicioId: 2,
      clienteId: 99,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: tokenHash,
      barbero: barberoMock,
      servicio: servicioMock,
    };

    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue(
      reservaExistente,
    );
    mockReservasRepository.cancelar.mockResolvedValue({
      ...reservaExistente,
      status: ReservationStatus.CANCELLED,
    });

    await service.cancelarReservaInvitado(42, tokenValido);

    expect(loggerSpy).toHaveBeenCalled();
    const logCalls = loggerSpy.mock.calls.map((c) => c[0]);
    for (const logMsg of logCalls) {
      expect(logMsg).not.toContain(tokenValido);
      expect(logMsg).not.toContain(tokenHash);
    }

    // Comprobar mensaje de error ante token inválido
    try {
      await service.cancelarReservaInvitado(42, 'token-erroneo-secreto');
    } catch (error: any) {
      expect(error.message).toBe(MENSAJE_RESERVA_NO_DISPONIBLE);
      expect(error.getStatus()).toBe(404);
      expect(error.message).not.toContain('token-erroneo-secreto');
    }
  });

  // 13. Prevención de oráculo de inferencia: reserva inexistente vs reserva con credencial incorrecta
  it('13. Prevención de canal encubierto: reserva inexistente y reserva con credencial incorrecta devuelven respuesta idéntica (404 Not Found)', async () => {
    const tokenValido = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(tokenValido)
      .digest('hex');
    const tokenIncorrecto = crypto.randomBytes(32).toString('hex');

    const reservaReal = {
      id: 77,
      barberoId: 3,
      servicioId: 2,
      clienteId: 99,
      date: new Date(`${FECHA}T00:00:00.000Z`),
      dayOfWeek: WeekDay.SUNDAY,
      startTime: HORA,
      endTime: HORA_FIN,
      status: ReservationStatus.PENDING,
      precioReservado: 50000,
      gestionTokenHash: tokenHash,
      barbero: barberoMock,
      servicio: servicioMock,
    };

    // Caso A: Reserva inexistente (id 9999)
    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue(
      null,
    );

    let errorModificarInexistente: any;
    try {
      await service.modificarReservaInvitado(9999, tokenIncorrecto, {
        hora: '16:00',
      });
    } catch (err) {
      errorModificarInexistente = err;
    }

    let errorCancelarInexistente: any;
    try {
      await service.cancelarReservaInvitado(9999, tokenIncorrecto);
    } catch (err) {
      errorCancelarInexistente = err;
    }

    // Caso B: Reserva existente (id 77) con token incorrecto
    mockReservasRepository.obtenerReservaParaGestionInvitado.mockResolvedValue(
      reservaReal,
    );

    let errorModificarExistenteTokenMalo: any;
    try {
      await service.modificarReservaInvitado(77, tokenIncorrecto, {
        hora: '16:00',
      });
    } catch (err) {
      errorModificarExistenteTokenMalo = err;
    }

    let errorCancelarExistenteTokenMalo: any;
    try {
      await service.cancelarReservaInvitado(77, tokenIncorrecto);
    } catch (err) {
      errorCancelarExistenteTokenMalo = err;
    }

    // Caso C: Reserva existente (id 77) con token vacío o ausente
    let errorModificarExistenteTokenVacio: any;
    try {
      await service.modificarReservaInvitado(77, '', { hora: '16:00' });
    } catch (err) {
      errorModificarExistenteTokenVacio = err;
    }

    // Validar equivalencia estricta para MODIFICACIÓN
    expect(errorModificarInexistente).toBeInstanceOf(NotFoundException);
    expect(errorModificarExistenteTokenMalo).toBeInstanceOf(NotFoundException);
    expect(errorModificarExistenteTokenVacio).toBeInstanceOf(NotFoundException);
    expect(errorModificarInexistente.getStatus()).toBe(404);
    expect(errorModificarExistenteTokenMalo.getStatus()).toBe(404);
    expect(errorModificarExistenteTokenVacio.getStatus()).toBe(404);
    expect(errorModificarInexistente.message).toBe(
      MENSAJE_RESERVA_NO_DISPONIBLE,
    );
    expect(errorModificarExistenteTokenMalo.message).toBe(
      MENSAJE_RESERVA_NO_DISPONIBLE,
    );
    expect(errorModificarExistenteTokenVacio.message).toBe(
      MENSAJE_RESERVA_NO_DISPONIBLE,
    );
    expect(errorModificarInexistente.getResponse()).toEqual(
      errorModificarExistenteTokenMalo.getResponse(),
    );
    expect(errorModificarInexistente.getResponse()).toEqual(
      errorModificarExistenteTokenVacio.getResponse(),
    );

    // Validar equivalencia estricta para CANCELACIÓN
    expect(errorCancelarInexistente).toBeInstanceOf(NotFoundException);
    expect(errorCancelarExistenteTokenMalo).toBeInstanceOf(NotFoundException);
    expect(errorCancelarInexistente.getStatus()).toBe(404);
    expect(errorCancelarExistenteTokenMalo.getStatus()).toBe(404);
    expect(errorCancelarInexistente.message).toBe(
      MENSAJE_RESERVA_NO_DISPONIBLE,
    );
    expect(errorCancelarExistenteTokenMalo.message).toBe(
      MENSAJE_RESERVA_NO_DISPONIBLE,
    );
    expect(errorCancelarInexistente.getResponse()).toEqual(
      errorCancelarExistenteTokenMalo.getResponse(),
    );
  });
});
