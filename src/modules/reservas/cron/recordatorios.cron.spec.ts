jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: { EVERY_10_MINUTES: '*/10 * * * *' },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { RecordatoriosCron } from './recordatorios.cron';
import { ReservasRepository } from '../repository/reservas.repository';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { FechaBogotaService } from '../../horarios/common/fecha-bogota.service';

describe('RecordatoriosCron (HU-11 - WhatsApp Recordatorios)', () => {
  let cron: RecordatoriosCron;
  let reservasRepo: {
    obtenerCitasPendientesRecordatorio: jest.Mock;
    marcarRecordatorioEnviado: jest.Mock;
  };
  let whatsappService: {
    getStatus: jest.Mock;
    enviarRecordatorioReserva: jest.Mock;
  };
  let fechaBogotaService: {
    obtenerComponentesBogota: jest.Mock;
  };

  beforeEach(async () => {
    reservasRepo = {
      obtenerCitasPendientesRecordatorio: jest.fn(),
      marcarRecordatorioEnviado: jest.fn(),
    };

    whatsappService = {
      getStatus: jest.fn(),
      enviarRecordatorioReserva: jest.fn(),
    };

    fechaBogotaService = {
      obtenerComponentesBogota: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordatoriosCron,
        { provide: ReservasRepository, useValue: reservasRepo },
        { provide: WhatsAppService, useValue: whatsappService },
        { provide: FechaBogotaService, useValue: fechaBogotaService },
      ],
    }).compile();

    cron = module.get<RecordatoriosCron>(RecordatoriosCron);
  });

  it('debe salir sin procesar si WhatsApp no está conectado', async () => {
    whatsappService.getStatus.mockReturnValue({
      conectado: false,
      qr: null,
      telefonoConectado: null,
    });

    await cron.procesarRecordatorios();

    expect(
      reservasRepo.obtenerCitasPendientesRecordatorio,
    ).not.toHaveBeenCalled();
    expect(whatsappService.enviarRecordatorioReserva).not.toHaveBeenCalled();
  });

  it('debe procesar citas dentro de la ventana de 120 minutos y marcar recordatorioEnviado', async () => {
    whatsappService.getStatus.mockReturnValue({
      conectado: true,
      qr: null,
      telefonoConectado: '573001234567',
    });
    fechaBogotaService.obtenerComponentesBogota.mockReturnValue({
      fecha: '2026-11-20',
      hora24: 10,
      minuto: 0,
      segundo: 0,
    } as any);

    // Cita a las 11:30 (dentro de 90 minutos)
    const mockReservaEnRango = {
      id: 42,
      startTime: '11:30',
      precioReservado: 25000,
      cliente: { nombre: 'Pedro', apellido: 'Pérez', telefono: '3001112233' },
      barbero: { usuario: { nombre: 'Duvan', apellido: 'Armero' } },
      servicio: { nombre: 'Corte Clásico', precio: '25000' },
    };

    // Cita a las 15:00 (dentro de 300 minutos, fuera de la ventana de 120)
    const mockReservaFueraDeRango = {
      id: 43,
      startTime: '15:00',
      precioReservado: 30000,
      cliente: { nombre: 'Luis', apellido: 'García', telefono: '3004445566' },
      barbero: { usuario: { nombre: 'Duvan', apellido: 'Armero' } },
      servicio: { nombre: 'Barba', precio: '30000' },
    };

    reservasRepo.obtenerCitasPendientesRecordatorio.mockResolvedValue([
      mockReservaEnRango,
      mockReservaFueraDeRango,
    ] as any);

    await cron.procesarRecordatorios();

    // Solo se debe enviar recordatorio para la cita en rango (id: 42)
    expect(whatsappService.enviarRecordatorioReserva).toHaveBeenCalledTimes(1);
    expect(whatsappService.enviarRecordatorioReserva).toHaveBeenCalledWith({
      telefono: '3001112233',
      clienteNombre: 'Pedro Pérez',
      servicioNombre: 'Corte Clásico',
      barberoNombre: 'Duvan Armero',
      fecha: '2026-11-20',
      hora: '11:30',
      precio: 25000,
    });
    expect(reservasRepo.marcarRecordatorioEnviado).toHaveBeenCalledWith(42);
    expect(reservasRepo.marcarRecordatorioEnviado).not.toHaveBeenCalledWith(43);
  });

  it('no debe lanzar excepción no controlada si ocurre un error en la ejecución', async () => {
    whatsappService.getStatus.mockImplementation(() => {
      throw new Error('Fallo de conexión');
    });

    await expect(cron.procesarRecordatorios()).resolves.toBeUndefined();
  });
});
