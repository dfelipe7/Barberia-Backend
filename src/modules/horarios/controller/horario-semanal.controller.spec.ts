import { Test, TestingModule } from '@nestjs/testing';
import { HorarioSemanalController } from './horario-semanal.controller';
import { HorarioSemanalService } from '../service/horario-semanal.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

jest.mock('../../../../generated/prisma/enums', () => ({
  WeekDay: {
    MONDAY: 'MONDAY',
    TUESDAY: 'TUESDAY',
    WEDNESDAY: 'WEDNESDAY',
    THURSDAY: 'THURSDAY',
    FRIDAY: 'FRIDAY',
    SATURDAY: 'SATURDAY',
    SUNDAY: 'SUNDAY',
  },
}));

import { WeekDay } from '../../../../generated/prisma/enums';

describe('HorarioSemanalController', () => {
  let controller: HorarioSemanalController;
  let horarioSemanalServiceMock: any;

  beforeEach(async () => {
    horarioSemanalServiceMock = {
      obtenerMiHorarioSemanal: jest
        .fn()
        .mockResolvedValue({ barberoId: 7, franjas: [] }),
      reemplazarMiHorarioSemanal: jest
        .fn()
        .mockResolvedValue({ barberoId: 7, franjas: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HorarioSemanalController],
      providers: [
        { provide: HorarioSemanalService, useValue: horarioSemanalServiceMock },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<HorarioSemanalController>(HorarioSemanalController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('debe delegar la consulta al servicio con el usuario autenticado', async () => {
    const request = { user: { id: 10 } };

    const resultado = await controller.obtenerMiHorarioSemanal(request);

    expect(
      horarioSemanalServiceMock.obtenerMiHorarioSemanal,
    ).toHaveBeenCalledWith(request.user);
    expect(resultado).toEqual({ barberoId: 7, franjas: [] });
  });

  it('debe delegar el reemplazo al servicio con el usuario y el dto', async () => {
    const request = { user: { id: 10 } };
    const dto = {
      franjas: [
        { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
      ],
    };

    const resultado = await controller.reemplazarMiHorarioSemanal(request, dto);

    expect(
      horarioSemanalServiceMock.reemplazarMiHorarioSemanal,
    ).toHaveBeenCalledWith(request.user, dto);
    expect(resultado).toEqual({ barberoId: 7, franjas: [] });
  });
});
